/**
 * DevPilot Rate Limiting Middleware (Sub-Phase 10B)
 *
 * Implements Step 13 & Security Architecture (pilot.pdf):
 * Protects compute-intensive, memory-heavy, and financial-metered endpoints:
 * 1. Scan Rate Limiter (/api/scan) - Prevents CPU exhaustion during AST parsing and vector indexing
 * 2. Chat Rate Limiter (/api/chat) - Limits LLM API querying and Pinecone semantic search
 * 3. Test Rate Limiter (/api/test) - Restricts sandboxed Docker/process execution
 * 4. Auth Rate Limiter (/api/auth) - Protects against credential brute-forcing
 * 5. General Rate Limiter - Global safeguard for all API endpoints
 */

import rateLimit from "express-rate-limit";

/**
 * Standard key generator resolving authenticated user ID when available,
 * otherwise falling back to remote IP address.
 */
export const resolveClientKey = (req) => {
    if (req.user?.id || req.user?._id) {
        return `user:${req.user.id || req.user._id}`;
    }
    const forwarded = req.headers?.["x-forwarded-for"];
    if (forwarded && typeof forwarded === "string") {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown-ip";
};

/**
 * Standardized rate limit error response handler
 */
export const createRateLimitHandler = (customMessage) => {
    return (req, res, next, options) => {
        const retryAfterSeconds = req.rateLimit?.resetTime
            ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
            : 60;

        res.setHeader("Retry-After", retryAfterSeconds);
        res.status(options.statusCode).json({
            statusCode: options.statusCode,
            data: null,
            message: customMessage || "Too many requests. Please slow down and try again later.",
            success: false,
            retryAfter: retryAfterSeconds,
        });
    };
};

/**
 * Global API Rate Limiter
 * 100 requests per 15 minutes per IP
 */
export const generalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: resolveClientKey,
    handler: createRateLimitHandler("Too many API requests. Please wait a few moments."),
});

/**
 * Repository Scanning & Indexing Rate Limiter
 * Heavy AST parsing + Pinecone embedding: 10 scans per 15 minutes
 */
export const scanRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: resolveClientKey,
    handler: createRateLimitHandler(
        "Too many repository scan requests. Repository parsing is compute-intensive; please wait before initiating another scan."
    ),
});

/**
 * AI Codebase Chat & LLM Retrieval Rate Limiter
 * LLM API querying & Pinecone search: 30 requests per minute
 */
export const chatRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: resolveClientKey,
    handler: createRateLimitHandler(
        "Too many AI chat queries. Please wait a moment before sending another message."
    ),
});

/**
 * Sandboxed Test Execution & Verification Rate Limiter
 * Docker container / Process sandbox execution: 15 test runs per 15 minutes
 */
export const testRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: resolveClientKey,
    handler: createRateLimitHandler(
        "Too many test execution requests. Sandboxed execution is resource-constrained; please wait before running more tests."
    ),
});

/**
 * Authentication Brute-Force Protection
 * Login & registration: 10 attempts per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => req.ip || "unknown-auth-ip",
    handler: createRateLimitHandler(
        "Too many login or registration attempts. For security, please wait 15 minutes before retrying."
    ),
});

export default {
    resolveClientKey,
    createRateLimitHandler,
    generalRateLimiter,
    scanRateLimiter,
    chatRateLimiter,
    testRateLimiter,
    authRateLimiter,
};
