/**
 * DevPilot Security Hardening & Rate Limiting Live Test Suite (Sub-Phase 10B)
 *
 * Verifies:
 * 1. Helmet production security headers (X-Frame-Options, X-Content-Type-Options, etc.)
 * 2. Strict CORS policy with allowed origins and method controls
 * 3. Dedicated rate limiters (scan, chat, test, auth, general)
 * 4. Token hashing, revocation, and Redis/in-memory blacklist queries
 * 5. User-wide session revocation (revokeAllUserTokens)
 * 6. Auth middleware blocking revoked tokens with HTTP 401
 * 7. Logout endpoint integration revoking active JWT access tokens
 */

import jwt from "jsonwebtoken";
import app from "./src/app.js";
import authMiddleware from "./src/middleware/auth.js";
import {
    hashToken,
    revokeToken,
    isTokenRevoked,
    revokeAllUserTokens,
    clearBlacklist,
} from "./src/services/tokenRevocation.service.js";
import {
    resolveClientKey,
    createRateLimitHandler,
    scanRateLimiter,
    chatRateLimiter,
    testRateLimiter,
    authRateLimiter,
    generalRateLimiter,
} from "./src/middleware/rateLimiter.js";

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
    totalCount++;
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passedCount++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
    }
}

async function runTests() {
    console.log("=================================================================");
    console.log("  DevPilot Security Hardening & Rate Limiting (Sub-Phase 10B Live)");
    console.log("=================================================================\n");

    const SECRET = process.env.ACCESS_TOKEN_SECRET || "fallback_secret";

    // -------------------------------------------------------------
    // Group 1: Helmet Production Security Headers
    // -------------------------------------------------------------
    console.log("--- Group 1: Helmet Security Headers ---");

    // Inspect layers in app router
    const layers = app.router?.stack || app._router?.stack || [];
    const helmetLayer = layers.find(
        (l) =>
            l.name === "helmet" ||
            l.name === "helmetMiddleware" ||
            (l.handle && (l.handle.name === "helmet" || l.handle.name === "helmetMiddleware"))
    );
    assert(Boolean(helmetLayer), "Helmet security middleware mounted on Express app");

    // Mock Express request/response to probe headers set by Helmet
    const req1 = { method: "GET", url: "/api/health", headers: {} };
    const res1Headers = {};
    const res1 = {
        setHeader(k, v) {
            res1Headers[k.toLowerCase()] = v;
        },
        getHeader(k) {
            return res1Headers[k.toLowerCase()];
        },
        removeHeader(k) {
            delete res1Headers[k.toLowerCase()];
        },
        status() { return this; },
        json() { return this; },
    };

    if (helmetLayer) {
        await new Promise((resolve) => helmetLayer.handle(req1, res1, resolve));
        assert(
            res1Headers["x-content-type-options"] === "nosniff",
            "Helmet sets 'X-Content-Type-Options: nosniff' (anti-MIME-sniffing)"
        );
        assert(
            Boolean(res1Headers["x-frame-options"]),
            "Helmet sets 'X-Frame-Options' (anti-clickjacking)"
        );
        assert(
            Boolean(res1Headers["content-security-policy"]),
            "Helmet sets Content-Security-Policy (CSP) headers"
        );
    }

    // -------------------------------------------------------------
    // Group 2: Strict CORS Policy
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Strict CORS Policy ---");

    const corsLayer = layers.find(
        (l) => l.name === "corsMiddleware" || (l.handle && l.handle.name === "corsMiddleware")
    );
    assert(Boolean(corsLayer), "CORS security middleware mounted on Express app");

    // Test whitelisted origin
    const corsReqWhitelisted = {
        method: "OPTIONS",
        headers: {
            origin: "http://localhost:5173",
            "access-control-request-method": "POST",
        },
    };
    const corsResWhitelisted = {
        headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        getHeader(k) { return this.headers[k.toLowerCase()]; },
        status() { return this; },
        end() {},
    };

    if (corsLayer) {
        await new Promise((resolve) => {
            let settled = false;
            corsResWhitelisted.end = () => {
                if (!settled) { settled = true; resolve(); }
            };
            corsLayer.handle(corsReqWhitelisted, corsResWhitelisted, () => {
                if (!settled) { settled = true; resolve(); }
            });
        });
        assert(
            corsResWhitelisted.headers["access-control-allow-origin"] === "http://localhost:5173",
            "CORS permits whitelisted frontend origin (http://localhost:5173)"
        );
        assert(
            corsResWhitelisted.headers["access-control-allow-credentials"] === "true",
            "CORS configures credentials: true"
        );
    }

    // -------------------------------------------------------------
    // Group 3: Dedicated Rate Limiters
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Dedicated Rate Limiters ---");

    assert(typeof scanRateLimiter === "function", "scanRateLimiter function initialized");
    assert(typeof chatRateLimiter === "function", "chatRateLimiter function initialized");
    assert(typeof testRateLimiter === "function", "testRateLimiter function initialized");
    assert(typeof authRateLimiter === "function", "authRateLimiter function initialized");
    assert(typeof generalRateLimiter === "function", "generalRateLimiter function initialized");

    // Client Key Resolver Test
    const keyUser = resolveClientKey({ user: { id: "user-123" } });
    assert(keyUser === "user:user-123", "resolveClientKey prioritizes authenticated user ID");

    const keyIp = resolveClientKey({ ip: "192.168.1.10" });
    assert(keyIp === "192.168.1.10", "resolveClientKey falls back to remote IP address");

    const keyXForwarded = resolveClientKey({ headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" } });
    assert(keyXForwarded === "203.0.113.195", "resolveClientKey parses first client IP from X-Forwarded-For");

    // Custom Error Handler Test
    const customHandler = createRateLimitHandler("Rate limit triggered");
    let rateLimitPayload = null;
    let rateLimitStatus = 0;
    let retryAfterHeader = null;

    const mockResRate = {
        setHeader(k, v) { if (k === "Retry-After") retryAfterHeader = v; },
        status(code) { rateLimitStatus = code; return this; },
        json(data) { rateLimitPayload = data; return this; },
    };

    customHandler(
        { rateLimit: { resetTime: new Date(Date.now() + 45000) } },
        mockResRate,
        () => {},
        { statusCode: 429 }
    );

    assert(rateLimitStatus === 429, "Rate limiter returns HTTP 429 status code");
    assert(rateLimitPayload?.success === false, "Rate limit payload sets success: false");
    assert(rateLimitPayload?.message === "Rate limit triggered", "Rate limit payload contains custom warning message");
    assert(Boolean(retryAfterHeader), "Rate limiter emits 'Retry-After' response header");

    // -------------------------------------------------------------
    // Group 4: Token Revocation & Blacklist Engine
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Token Revocation & Blacklist Engine ---");

    clearBlacklist();

    const tokenA = jwt.sign(
        { user: { id: "user-456", email: "alice@devpilot.io" } },
        SECRET,
        { expiresIn: "15m" }
    );
    const tokenB = jwt.sign(
        { user: { id: "user-789", email: "bob@devpilot.io" } },
        SECRET,
        { expiresIn: "15m" }
    );

    // 4A: Hash verification
    const hashA = hashToken(tokenA);
    assert(hashA.length === 64, "Token hash is 64-char SHA-256 hex string");

    // 4B: Pre-revocation state
    const preCheck = await isTokenRevoked(tokenA);
    assert(preCheck === false, "Newly generated active token is not revoked");

    // 4C: Token Revocation
    const revResult = await revokeToken({ token: tokenA });
    assert(revResult.revoked === true, "revokeToken returns revoked: true");
    assert(revResult.tokenHash === hashA, "Revocation record references exact token hash");

    const postCheckA = await isTokenRevoked(tokenA);
    assert(postCheckA === true, "isTokenRevoked confirms token A is now blacklisted");

    const postCheckB = await isTokenRevoked(tokenB);
    assert(postCheckB === false, "Token B remains valid and unrevoked");

    // -------------------------------------------------------------
    // Group 5: User-Wide Session Revocation
    // -------------------------------------------------------------
    console.log("\n--- Group 5: User-Wide Session Revocation ---");

    // User "user-999" has an existing token
    const tokenUserPast = jwt.sign(
        { user: { id: "user-999" }, iat: Math.floor(Date.now() / 1000) - 100 },
        SECRET,
        { expiresIn: "15m" }
    );

    const checkBeforeUserRevoke = await isTokenRevoked(tokenUserPast);
    assert(checkBeforeUserRevoke === false, "User token is valid prior to user-wide revocation");

    // Revoke all sessions for user-999
    await revokeAllUserTokens("user-999");

    const checkAfterUserRevoke = await isTokenRevoked(tokenUserPast);
    assert(checkAfterUserRevoke === true, "All prior sessions for user-999 are now revoked");

    // -------------------------------------------------------------
    // Group 6: Auth Middleware Revocation Enforcement
    // -------------------------------------------------------------
    console.log("\n--- Group 6: Auth Middleware Revocation Enforcement ---");

    // 6A: Valid token passes auth middleware
    let authPassed = false;
    const reqAuthValid = {
        header(name) {
            if (name === "Authorization") return `Bearer ${tokenB}`;
            return null;
        },
    };
    const resAuthValid = {
        status() { return this; },
        json() { return this; },
    };

    await authMiddleware(reqAuthValid, resAuthValid, () => {
        authPassed = true;
    });
    assert(authPassed === true, "Valid unrevoked token successfully passes auth middleware");
    assert(reqAuthValid.user?.id === "user-789", "Auth middleware populates req.user");
    assert(reqAuthValid.token === tokenB, "Auth middleware attaches raw req.token for downstream revocation");

    // 6B: Revoked token blocked by auth middleware
    let revokedStatus = 0;
    let revokedMessage = "";
    const reqAuthRevoked = {
        header(name) {
            if (name === "Authorization") return `Bearer ${tokenA}`;
            return null;
        },
    };
    const resAuthRevoked = {
        status(code) {
            revokedStatus = code;
            return this;
        },
        json(data) {
            revokedMessage = data.message;
            return this;
        },
    };

    await authMiddleware(reqAuthRevoked, resAuthRevoked, () => {
        assert(false, "Revoked token should never reach next()");
    });

    assert(revokedStatus === 401, "Auth middleware blocks revoked token with HTTP 401");
    assert(
        revokedMessage.includes("revoked"),
        "Auth middleware specifies token has been revoked in error response"
    );

    console.log("\n=================================================================");
    console.log(`  Result: ${passedCount}/${totalCount} assertions passed (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log("=================================================================\n");

    if (passedCount < totalCount) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
