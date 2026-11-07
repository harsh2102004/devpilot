/**
 * DevPilot Task 7: CORS, Error Handling, and Security Headers Live Test Suite
 *
 * Verifies:
 * 1. Origin: http://evil.com is rejected with HTTP 403 in dev and prod.
 * 2. Origin: http://localhost:5173 and CLIENT_URL are allowed.
 * 3. Helmet CSP header does NOT contain 'unsafe-inline' in script-src.
 * 4. app.get("trust proxy") is 1.
 * 5. Unexpected non-ApiErrors (like forced DB crashes) return generic "Internal Server Error"
 *    and NEVER leak sensitive internal messages or credentials to the client.
 */

process.env.ACCESS_TOKEN_SECRET = "super_secret_devpilot_access_key_2026_token_test_32chars!";
process.env.REFRESH_TOKEN_SECRET = "super_secret_devpilot_refresh_key_2026_token_test_32chars!";
process.env.MONGO_URI = "mongodb://localhost:27017/devpilot_test_db_placeholder_32chars!";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CLIENT_URL = "https://staging.devpilot.local";

import assert from "assert";
import http from "http";
import express from "express";
import { app } from "./src/app.js";
import { ApiError } from "./src/utils/ApiError.js";

async function runTests() {
    console.log("=== DEVPIILOT TASK 7: CORS, HEADERS & ERROR LEAK PREVENTION SUITE ===\n");

    // -------------------------------------------------------------
    // Test 1: Trust Proxy Setting
    // -------------------------------------------------------------
    console.log("--- 1. Testing Express Trust Proxy Setting ---");
    const trustProxy = app.get("trust proxy");
    assert.strictEqual(trustProxy, 1, 'app.get("trust proxy") must be set to 1');
    console.log("  [PASS] app.set('trust proxy', 1) is active");

    // -------------------------------------------------------------
    // Live Server Setup
    // -------------------------------------------------------------
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`\n--- 2. Live Express Server Listening on port ${port} ---`);

    try {
        // -------------------------------------------------------------
        // Test 2: Helmet CSP Script-Src (No 'unsafe-inline')
        // -------------------------------------------------------------
        console.log("\n--- 3. Testing Helmet CSP Headers ---");
        const healthRes = await fetch(`${baseUrl}/api/health`);
        const cspHeader = healthRes.headers.get("content-security-policy");
        console.log(`  CSP Header: ${cspHeader}`);
        assert.ok(cspHeader, "Response must include Content-Security-Policy header");
        assert.ok(cspHeader.includes("script-src 'self'"), "script-src must include 'self'");
        assert.ok(!cspHeader.includes("script-src 'self' 'unsafe-inline'"), "script-src must NOT contain 'unsafe-inline'");
        assert.ok(!cspHeader.includes("'unsafe-inline'") || !cspHeader.split("script-src")[1]?.split(";")[0]?.includes("'unsafe-inline'"), "script-src directive must not allow unsafe-inline");
        console.log("  [PASS] Helmet CSP script-src excludes 'unsafe-inline'");

        // -------------------------------------------------------------
        // Test 3: CORS - Origin: http://evil.com in Development & Production
        // -------------------------------------------------------------
        console.log("\n--- 4. Testing CORS Allow-List Strict Enforcement ---");

        // 3A: In Development environment
        process.env.NODE_ENV = "development";
        const evilDevRes = await fetch(`${baseUrl}/api/health`, {
            method: "GET",
            headers: { "Origin": "http://evil.com" }
        });
        const evilDevBody = await evilDevRes.json();
        console.log(`  Dev Origin http://evil.com -> Status: ${evilDevRes.status}, Body:`, evilDevBody);
        assert.strictEqual(evilDevRes.status, 403, "http://evil.com must be rejected with HTTP 403 in dev");
        assert.ok(evilDevBody.message.includes("CORS blocked"), "Error message must state CORS blocked");
        console.log("  [PASS] Origin http://evil.com rejected with 403 in development");

        // 3B: In Production environment
        process.env.NODE_ENV = "production";
        const evilProdRes = await fetch(`${baseUrl}/api/health`, {
            method: "GET",
            headers: { "Origin": "http://evil.com" }
        });
        const evilProdBody = await evilProdRes.json();
        console.log(`  Prod Origin http://evil.com -> Status: ${evilProdRes.status}, Body:`, evilProdBody);
        assert.strictEqual(evilProdRes.status, 403, "http://evil.com must be rejected with HTTP 403 in prod");
        assert.ok(evilProdBody.message.includes("CORS blocked"), "Error message must state CORS blocked");
        console.log("  [PASS] Origin http://evil.com rejected with 403 in production");

        // 3C: Legitimate Whitelisted Origin (Localhost 5173)
        const allowedRes = await fetch(`${baseUrl}/api/health`, {
            method: "GET",
            headers: { "Origin": "http://localhost:5173" }
        });
        console.log(`  Allowed Origin http://localhost:5173 -> Status: ${allowedRes.status}`);
        assert.strictEqual(allowedRes.status, 200, "http://localhost:5173 must return 200");
        assert.strictEqual(
            allowedRes.headers.get("access-control-allow-origin"),
            "http://localhost:5173",
            "access-control-allow-origin must match allowed origin"
        );
        console.log("  [PASS] Allowed origin http://localhost:5173 accepted with 200");

        // 3D: CLIENT_URL from environment
        const clientUrlRes = await fetch(`${baseUrl}/api/health`, {
            method: "GET",
            headers: { "Origin": "https://staging.devpilot.local" }
        });
        console.log(`  CLIENT_URL https://staging.devpilot.local -> Status: ${clientUrlRes.status}`);
        assert.strictEqual(clientUrlRes.status, 200, "CLIENT_URL must return 200");
        assert.strictEqual(
            clientUrlRes.headers.get("access-control-allow-origin"),
            "https://staging.devpilot.local",
            "access-control-allow-origin must match CLIENT_URL"
        );
        console.log("  [PASS] CLIENT_URL from environment accepted with 200");

        // -------------------------------------------------------------
        // Test 4: Error Handling & Internal Leak Prevention
        // -------------------------------------------------------------
        console.log("\n--- 5. Testing Error Handling & Raw Internals Leak Prevention ---");

        const { errorHandler } = await import("./src/app.js");
        const errorTestApp = express();
        errorTestApp.get("/test-db-error", (req, res, next) => {
            const dbError = new Error(
                "MongoServerError: connection failed to cluster0.mongodb.net with user 'root' and pass 'P@ssw0rd123!' at connection.js:42"
            );
            dbError.name = "MongoServerError";
            next(dbError);
        });
        errorTestApp.get("/test-api-error", (req, res, next) => {
            next(new ApiError(400, "Legitimate validation message"));
        });
        errorTestApp.use(errorHandler);

        const errorServer = http.createServer(errorTestApp);
        await new Promise((resolve) => errorServer.listen(0, resolve));
        const errPort = errorServer.address().port;
        const errBaseUrl = `http://localhost:${errPort}`;

        try {
            // Test 4A: Raw database crash response inspection
            const dbErrRes = await fetch(`${errBaseUrl}/test-db-error`);
            const dbErrData = await dbErrRes.json();
            console.log(`  Forced DB Error Response -> Status: ${dbErrRes.status}, Body:`, dbErrData);

            assert.strictEqual(dbErrRes.status, 500, "Raw database crash must return HTTP 500");
            assert.strictEqual(
                dbErrData.message,
                "Internal Server Error",
                'Raw error message must be masked with generic "Internal Server Error"'
            );
            assert.strictEqual(dbErrData.success, false, "success must be false");

            // Verify that sensitive credentials NEVER leak into client payload
            const rawJsonString = JSON.stringify(dbErrData);
            assert.ok(!rawJsonString.includes("MongoServerError"), "Client response must not leak error name");
            assert.ok(!rawJsonString.includes("cluster0"), "Client response must not leak database cluster URI");
            assert.ok(!rawJsonString.includes("P@ssw0rd123!"), "Client response must not leak database credentials");
            assert.ok(!rawJsonString.includes("connection.js"), "Client response must not leak source file names");
            console.log("  [PASS] Forced DB error masked with generic 'Internal Server Error' (zero secrets leaked)");

            // Test 4B: Operational ApiError preserved
            const apiErrRes = await fetch(`${errBaseUrl}/test-api-error`);
            const apiErrData = await apiErrRes.json();
            assert.strictEqual(apiErrRes.status, 400, "Operational ApiError must preserve 400 status");
            assert.strictEqual(apiErrData.message, "Legitimate validation message", "Operational error message must be preserved");
            console.log("  [PASS] Operational ApiError returned clean HTTP 400");
        } finally {
            errorServer.close();
        }

        console.log("\n=======================================================");
        console.log("ALL TASK 7 CORS, HEADERS & ERROR TESTS PASSED (100%)!");
        console.log("=======================================================\n");

    } finally {
        server.close();
    }
}

runTests().catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
