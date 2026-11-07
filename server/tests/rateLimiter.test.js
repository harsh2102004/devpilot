import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import rateLimit from "express-rate-limit";
import { app, request } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";
import { createRateLimitHandler, resolveClientKey, authRateLimiter } from "../src/middleware/rateLimiter.js";

describe("Task 9: Rate Limiting & DoS Defense (Sub-Phase 10B)", () => {
    before(async () => {
        await initTestDb();
    });

    after(async () => {
        await closeTestDb();
    });
    it("1. resolveClientKey extracts authenticated user ID when present", () => {
        const mockReqUser = { user: { id: "user_12345" } };
        assert.strictEqual(resolveClientKey(mockReqUser), "user:user_12345");

        const mockReqUserDoc = { user: { _id: "user_doc_67890" } };
        assert.strictEqual(resolveClientKey(mockReqUserDoc), "user:user_doc_67890");
    });

    it("2. resolveClientKey extracts remote IP when unauthenticated", () => {
        const mockReqIp = { ip: "192.168.1.100" };
        assert.strictEqual(resolveClientKey(mockReqIp), "192.168.1.100");

        const mockReqForwarded = { headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" } };
        assert.strictEqual(resolveClientKey(mockReqForwarded), "203.0.113.195");
    });

    it("3. Rate limiter triggers HTTP 429 when threshold exceeded and sets Retry-After", async () => {
        // Create an isolated sub-app with low max to verify rate limiter behavior without polluting global app
        const testApp = express();
        testApp.use(
            rateLimit({
                windowMs: 60 * 1000,
                max: 3,
                standardHeaders: true,
                legacyHeaders: false,
                handler: createRateLimitHandler("Rate limit exceeded for test"),
            })
        );
        testApp.get("/test-endpoint", (req, res) => res.status(200).json({ ok: true }));

        const agent = request(testApp);

        // Requests 1, 2, 3 should succeed
        for (let i = 0; i < 3; i++) {
            const res = await agent.get("/test-endpoint");
            assert.strictEqual(res.status, 200);
        }

        // Request 4 must be rate-limited
        const limitedRes = await agent.get("/test-endpoint");
        assert.strictEqual(limitedRes.status, 429);
        assert.strictEqual(limitedRes.body.success, false);
        assert.strictEqual(limitedRes.body.statusCode, 429);
        assert.ok(limitedRes.headers["retry-after"], "Retry-After header must be set");
        assert.ok(limitedRes.body.message.includes("Rate limit exceeded for test"));
    });

    it("4. Global authRateLimiter on /api/auth/login triggers HTTP 429 after 10 requests", async () => {
        const testAuthApp = express();
        testAuthApp.use("/api/auth/login", authRateLimiter);
        testAuthApp.post("/api/auth/login", (req, res) => res.status(200).json({ ok: true }));

        const testClientIp = "198.51.100.42";
        let lastRes;

        for (let i = 0; i < 11; i++) {
            lastRes = await request(testAuthApp)
                .post("/api/auth/login")
                .set("X-Forwarded-For", testClientIp)
                .send({
                    email: "ratelimit_probe@example.com",
                    password: "RandomPassword123",
                });
        }

        // The 11th request must receive HTTP 429
        assert.strictEqual(lastRes.status, 429);
        assert.strictEqual(lastRes.body.success, false);
        assert.ok(lastRes.headers["retry-after"]);
        assert.ok(lastRes.body.message.includes("Too many"));
    });
});
