/**
 * DevPilot Token Encryption Service (AES-256-GCM)
 *
 * Implements authenticated symmetric encryption for sensitive stored credentials
 * such as GitHub Personal Access Tokens and OAuth secrets.
 *
 * Format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag

/**
 * Derives a 32-byte (256-bit) buffer key from TOKEN_ENCRYPTION_KEY
 * @returns {Buffer}
 */
export const getEncryptionKey = () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!rawKey || typeof rawKey !== "string" || rawKey.trim().length < 32) {
        throw new Error(
            "[TokenEncryption] Missing or invalid TOKEN_ENCRYPTION_KEY environment variable. Must be at least 32 characters."
        );
    }

    const trimmed = rawKey.trim();

    // If already a 64-char hex string (32 bytes), convert directly
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
        return Buffer.from(trimmed, "hex");
    }

    // Exactly 32 bytes UTF-8
    if (Buffer.byteLength(trimmed, "utf8") === 32) {
        return Buffer.from(trimmed, "utf8");
    }

    // Otherwise derive fixed 32-byte key via SHA-256
    return crypto.createHash("sha256").update(trimmed, "utf8").digest();
};

/**
 * Checks whether a token string is in AES-256-GCM encrypted format (iv:tag:data)
 * @param {string} token
 * @returns {boolean}
 */
export const isEncryptedToken = (token) => {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(":");
    if (parts.length !== 3) return false;
    const [ivHex, tagHex, cipherHex] = parts;
    return (
        ivHex.length === IV_LENGTH * 2 &&
        tagHex.length === AUTH_TAG_LENGTH * 2 &&
        cipherHex.length > 0 &&
        /^[0-9a-fA-F]+$/.test(ivHex) &&
        /^[0-9a-fA-F]+$/.test(tagHex) &&
        /^[0-9a-fA-F]+$/.test(cipherHex)
    );
};

/**
 * Encrypts a plaintext token string using AES-256-GCM
 *
 * @param {string} plainToken
 * @returns {string} iv:tag:ciphertext
 */
export const encryptToken = (plainToken) => {
    if (!plainToken || typeof plainToken !== "string") {
        return plainToken;
    }

    // Avoid double encryption
    if (isEncryptedToken(plainToken)) {
        return plainToken;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plainToken, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};

/**
 * Decrypts an AES-256-GCM encrypted token string back to plaintext
 *
 * @param {string} encryptedToken
 * @returns {string} Plaintext token
 */
export const decryptToken = (encryptedToken) => {
    if (!encryptedToken || typeof encryptedToken !== "string") {
        return encryptedToken;
    }

    // If not in encrypted format, return as-is
    if (!isEncryptedToken(encryptedToken)) {
        return encryptedToken;
    }

    const [ivHex, tagHex, cipherHex] = encryptedToken.split(":");
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
};

export default {
    getEncryptionKey,
    isEncryptedToken,
    encryptToken,
    decryptToken,
};
