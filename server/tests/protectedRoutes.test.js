import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { app, request } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";

describe("Task 9: Protected Routes Authentication Enforcement", () => {
    before(async () => {
        await initTestDb();
    });

    after(async () => {
        await closeTestDb();
    });

    const fakeValidId = "507f1f77bcf86cd799439011";

    const protectedEndpoints = [
        { method: "get", path: "/api/projects" },
        { method: "post", path: "/api/projects" },
        { method: "get", path: `/api/projects/${fakeValidId}` },
        { method: "patch", path: `/api/projects/${fakeValidId}` },
        { method: "delete", path: `/api/projects/${fakeValidId}` },
        { method: "get", path: "/api/auth/me" },
        { method: "post", path: "/api/auth/logout" },
        { method: "post", path: "/api/auth/revoke-all" },
        { method: "post", path: `/api/scan/${fakeValidId}` },
        { method: "get", path: `/api/scan/job/${fakeValidId}` },
        { method: "post", path: "/api/chat/ask" },
        { method: "post", path: `/api/test/${fakeValidId}/run` },
        { method: "get", path: `/api/test/${fakeValidId}/runs` },
        { method: "get", path: "/api/github/status" },
    ];

    for (const ep of protectedEndpoints) {
        it(`Rejects unauthenticated request to ${ep.method.toUpperCase()} ${ep.path} with 401`, async () => {
            const req = request(app)[ep.method](ep.path);
            const res = await req.send({});
            assert.strictEqual(res.status, 401);
            assert.ok(
                res.body.message?.includes("No token") ||
                res.body.message?.includes("authorization denied") ||
                res.body.message?.includes("Token")
            );
        });
    }

    it("Rejects malformed Authorization header with 401", async () => {
        const res = await request(app)
            .get("/api/projects")
            .set("Authorization", "Bearer invalid.jwt.token");

        assert.strictEqual(res.status, 401);
        assert.ok(res.body.message?.includes("Token is not valid"));
    });

    it("Rejects request with empty Bearer token with 401", async () => {
        const res = await request(app)
            .get("/api/projects")
            .set("Authorization", "Bearer ");

        assert.strictEqual(res.status, 401);
    });
});
