/**
 * DevPilot Access Token Revocation & Blacklist Engine (Sub-Phase 10B)
 *
 * Implements Step 13 & Security Architecture (pilot.pdf):
 * 1. Hashes JWT tokens with SHA-256 for memory-efficient and secure blacklist storage.
 * 2. Primary storage in Redis with automatic TTL expiration matching the token's remaining lifetime.
 * 3. Graceful in-memory TTL map fallback for local development or during Redis reconnects.
 * 4. User-wide revocation (invalidates all active sessions issued before a given timestamp).
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { redisConnection } from "../config/redis.js";

// In-memory fallback cache: tokenHash -> expirationTimestampMs
const inMemoryBlacklist = new Map();

// In-memory fallback for user-level revocation: userId -> revokedBeforeTimestampMs
const inMemoryUserRevocations = new Map();

// Periodic cleanup of expired tokens from in-memory cache (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [hash, expiresAt] of inMemoryBlacklist.entries()) {
        if (expiresAt <= now) {
            inMemoryBlacklist.delete(hash);
        }
    }
}, 5 * 60 * 1000).unref();

/**
 * Computes SHA-256 hash of a JWT string to store in blacklist
 * @param {string} token
 * @returns {string} Hex hash string
 */
export const hashToken = (token) => {
    if (!token || typeof token !== "string") return "";
    return crypto.createHash("sha256").update(token.trim()).digest("hex");
};

/**
 * Revokes a specific access token until its natural expiration
 *
 * @param {object} params
 * @param {string} params.token - Raw JWT string
 * @param {number} [params.expirySeconds=900] - Fallback TTL in seconds (default: 15 min)
 * @returns {Promise<{ revoked: boolean, tokenHash: string, expiresAt: number }>}
 */
export const revokeToken = async ({ token, expirySeconds = 900 }) => {
    if (!token || typeof token !== "string") {
        throw new Error("[TokenRevocation] Valid token string is required to revoke");
    }

    const tokenHash = hashToken(token);
    let ttl = expirySeconds;

    // Decode token to extract exact expiration time (exp)
    try {
        const decoded = jwt.decode(token);
        if (decoded?.exp) {
            const remaining = decoded.exp - Math.floor(Date.now() / 1000);
            ttl = Math.max(1, remaining);
        }
    } catch {
        // Fallback to default expirySeconds
    }

    const expiresAt = Date.now() + ttl * 1000;

    // 1. In-memory storage (guaranteed availability)
    inMemoryBlacklist.set(tokenHash, expiresAt);

    // 2. Redis storage if ready
    try {
        if (redisConnection && redisConnection.status === "ready") {
            await redisConnection.set(`blacklist:token:${tokenHash}`, "revoked", "EX", ttl);
        }
    } catch (redisErr) {
        console.warn(`[TokenRevocation] Redis write failed, relying on in-memory fallback: ${redisErr.message}`);
    }

    return {
        revoked: true,
        tokenHash,
        expiresAt,
    };
};

/**
 * Checks whether an access token has been revoked or belongs to an invalidated session
 *
 * @param {string} token - Raw JWT string
 * @returns {Promise<boolean>} True if revoked, false if valid
 */
export const isTokenRevoked = async (token) => {
    if (!token || typeof token !== "string") return true;

    const tokenHash = hashToken(token);
    const now = Date.now();

    // 1. Check in-memory blacklist
    const inMemExpiresAt = inMemoryBlacklist.get(tokenHash);
    if (inMemExpiresAt && inMemExpiresAt > now) {
        return true;
    }

    // 2. Check Redis blacklist if connected
    try {
        if (redisConnection && redisConnection.status === "ready") {
            const exists = await redisConnection.exists(`blacklist:token:${tokenHash}`);
            if (exists) return true;
        }
    } catch {
        // Fallback continues
    }

    // 3. Check User-level session revocation (if user revoked all sessions)
    try {
        const decoded = jwt.decode(token);
        const userId = decoded?.user?.id || decoded?.user?._id || decoded?.id || decoded?._id;
        const iat = decoded?.iat ? decoded.iat * 1000 : null;

        if (userId && iat) {
            // Check in-memory user revocation
            const userRevokedBefore = inMemoryUserRevocations.get(String(userId));
            if (userRevokedBefore && iat < userRevokedBefore) {
                return true;
            }

            // Check Redis user revocation
            if (redisConnection && redisConnection.status === "ready") {
                const redisRevokedBefore = await redisConnection.get(`user_revoked_before:${userId}`);
                if (redisRevokedBefore && iat < parseInt(redisRevokedBefore, 10)) {
                    return true;
                }
            }
        }
    } catch {
        // Ignored
    }

    return false;
};

/**
 * Revokes all tokens issued before the current timestamp for a given user.
 * Used for "Log out of all devices" or password changes.
 *
 * @param {string} userId - MongoDB User ID
 * @returns {Promise<{ revokedBefore: number }>}
 */
export const revokeAllUserTokens = async (userId) => {
    if (!userId) {
        throw new Error("[TokenRevocation] Valid userId is required");
    }

    const cleanUserId = String(userId);
    const now = Date.now();

    // 1. Store in memory
    inMemoryUserRevocations.set(cleanUserId, now);

    // 2. Store in Redis with 7-day TTL (matching max refresh token expiry)
    try {
        if (redisConnection && redisConnection.status === "ready") {
            await redisConnection.set(`user_revoked_before:${cleanUserId}`, now, "EX", 7 * 24 * 60 * 60);
        }
    } catch (err) {
        console.warn(`[TokenRevocation] Redis user revocation failed: ${err.message}`);
    }

    return { revokedBefore: now };
};

/**
 * Clears the in-memory blacklist (used by test suites)
 */
export const clearBlacklist = () => {
    inMemoryBlacklist.clear();
    inMemoryUserRevocations.clear();
};

export default {
    hashToken,
    revokeToken,
    isTokenRevoked,
    revokeAllUserTokens,
    clearBlacklist,
};

