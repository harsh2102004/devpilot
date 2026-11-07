import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { app, request, generateTestToken } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";
import User from "../src/models/User.js";
import Project from "../src/models/project.js";
import TestRun from "../src/models/testRun.js";

describe("Task 9: Multi-Tenant Data Isolation & State Control (Task 6)", () => {
    let userA;
    let userB;
    let tokenA;
    let tokenB;
    let projectA;
    let testRunA;

    before(async () => {
        await initTestDb();

        const userAId = new mongoose.Types.ObjectId();
        const userBId = new mongoose.Types.ObjectId();

        userA = await User.create({
            _id: userAId,
            fullName: "User A Owner",
            username: `usera_${Date.now()}`,
            email: `usera_${Date.now()}@example.com`,
            password: "SecurePassword123",
        });

        userB = await User.create({
            _id: userBId,
            fullName: "User B Attacker",
            username: `userb_${Date.now()}`,
            email: `userb_${Date.now()}@example.com`,
            password: "SecurePassword123",
        });

        tokenA = generateTestToken(userAId.toString(), { email: userA.email, name: userA.fullName });
        tokenB = generateTestToken(userBId.toString(), { email: userB.email, name: userB.fullName });

        projectA = await Project.create({
            name: "Project A Secrets",
            repoUrl: "https://github.com/usera/secrets",
            repoBranch: "main",
            status: "disconnected",
            owner: userAId,
        });

        testRunA = await TestRun.create({
            projectId: projectA._id,
            userId: userAId,
            status: "passed",
            trigger: "manual",
        });
    });

    after(async () => {
        await closeTestDb();
    });

    it("1. validateObjectId middleware returns HTTP 400 for malformed IDs", async () => {
        const res = await request(app)
            .get("/api/projects/not-a-valid-objectid")
            .set("Authorization", `Bearer ${tokenA}`);

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.message.includes("Invalid ID format") || res.body.message.includes("Invalid"));
    });

    it("2. User B cannot read User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .get(`/api/projects/${projectA._id}`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("3. User B cannot update User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .patch(`/api/projects/${projectA._id}`)
            .set("Authorization", `Bearer ${tokenB}`)
            .send({ description: "Hacked by User B" });

        assert.strictEqual(res.status, 404);
    });

    it("4. User B cannot delete User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .delete(`/api/projects/${projectA._id}`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("5. User B cannot trigger a scan on User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .post(`/api/scan/${projectA._id}`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("6. User B cannot trigger a test run on User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .post(`/api/test/${projectA._id}/run`)
            .set("Authorization", `Bearer ${tokenB}`)
            .send({});

        assert.strictEqual(res.status, 404);
    });

    it("7. User B cannot view User A's test runs list (returns HTTP 404)", async () => {
        const res = await request(app)
            .get(`/api/test/${projectA._id}/runs`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("8. User B cannot read User A's specific test run (returns HTTP 404)", async () => {
        const res = await request(app)
            .get(`/api/test/run/${testRunA._id}`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("9. User B cannot delete User A's specific test run (returns HTTP 404)", async () => {
        const res = await request(app)
            .delete(`/api/test/run/${testRunA._id}`)
            .set("Authorization", `Bearer ${tokenB}`);

        assert.strictEqual(res.status, 404);
    });

    it("10. User B cannot query chat on User A's project (returns HTTP 404)", async () => {
        const res = await request(app)
            .post("/api/chat/ask")
            .set("Authorization", `Bearer ${tokenB}`)
            .send({
                projectId: projectA._id.toString(),
                query: "Show me secrets",
            });

        assert.strictEqual(res.status, 404);
    });

    it("11. Client cannot manipulate project status via PATCH /api/projects/:id", async () => {
        const initialStatus = projectA.status || "disconnected";

        const res = await request(app)
            .patch(`/api/projects/${projectA._id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({
                status: "indexed",
                description: "Legitimate description update",
            });

        assert.strictEqual(res.status, 200);
        // Status must remain unchanged even if client passed status: "indexed"
        assert.strictEqual(res.body.data.status, initialStatus);
        assert.notStrictEqual(res.body.data.status, "indexed");
    });
});
