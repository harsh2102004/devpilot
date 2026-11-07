import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { app, request, generateTestToken } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";
import { revokeToken, revokeAllUserTokens, clearBlacklist } from "../src/services/tokenRevocation.service.js";
import User from "../src/models/User.js";

describe("Task 9: Token Revocation & Session Termination (Sub-Phase 10B)", () => {
    let testUser;
    let userId;

    before(async () => {
        await initTestDb();
        userId = new mongoose.Types.ObjectId();
        testUser = await User.create({
            _id: userId,
            fullName: "Revocation Subject",
            username: `revoke_${Date.now()}`,
            email: `revoke_${Date.now()}@example.com`,
            password: "SecurePassword123",
        });
    });

    after(async () => {
        await closeTestDb();
    });

    beforeEach(() => {
        clearBlacklist();
    });

    it("1. Valid unrevoked token can access protected route", async () => {
        const token = generateTestToken(userId.toString(), { email: testUser.email });

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
    });

    it("2. Explicitly revoked token is rejected with HTTP 401", async () => {
        const token = generateTestToken(userId.toString(), { email: testUser.email });

        // Revoke the token
        await revokeToken({ token, expirySeconds: 300 });

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(res.status, 401);
        assert.ok(res.body.message.includes("Token has been revoked or session terminated"));
    });

    it("3. User-wide revocation rejects previously issued tokens with HTTP 401", async () => {
        const oldToken = generateTestToken(userId.toString(), { email: testUser.email });

        // Ensure small time gap so token's iat is strictly before revokeAll
        await new Promise((r) => setTimeout(r, 1100));

        await revokeAllUserTokens(userId.toString());

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${oldToken}`);

        assert.strictEqual(res.status, 401);
        assert.ok(res.body.message.includes("Token has been revoked or session terminated"));
    });

    it("4. POST /api/auth/logout revokes the caller's token", async () => {
        const token = generateTestToken(userId.toString(), { email: testUser.email });

        // Call logout
        const logoutRes = await request(app)
            .post("/api/auth/logout")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(logoutRes.status, 200);
        assert.strictEqual(logoutRes.body.success, true);

        // Subsequent call with same token must fail
        const subsequentRes = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(subsequentRes.status, 401);
        assert.ok(subsequentRes.body.message.includes("Token has been revoked or session terminated"));
    });

    it("5. POST /api/auth/revoke-all terminates all previous user sessions", async () => {
        const token = generateTestToken(userId.toString(), { email: testUser.email });

        // Ensure iat < revoke timestamp
        await new Promise((r) => setTimeout(r, 1100));

        const revokeRes = await request(app)
            .post("/api/auth/revoke-all")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(revokeRes.status, 200);

        // Immediate subsequent call with that token is rejected
        const accessRes = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        assert.strictEqual(accessRes.status, 401);
    });
});
