/**
 * DevPilot Task 6 Live Test Suite
 *
 * Verifies:
 * 1. PATCH /api/projects/:id { status: "indexed" } leaves status unchanged.
 * 2. GET /api/projects/abc returns HTTP 400 (ObjectId validation middleware).
 * 3. User B cannot read, delete, scan, chat on, or test-run User A's project (all return 404).
 */

process.env.ACCESS_TOKEN_SECRET = "test_access_token_secret_32_characters_long_devpilot_auth!";
process.env.REFRESH_TOKEN_SECRET = "test_refresh_token_secret_32_characters_long_devpilot_auth!";
process.env.MONGO_URI = "mongodb://localhost:27017/devpilot_test_db_placeholder_32chars!";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NODE_ENV = "test";

import assert from "assert";
import http from "http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import env from "./src/config/env.js";
import { app } from "./src/app.js";
import { Project } from "./src/models/project.js";
import { TestRun } from "./src/models/testRun.js";
import { Job } from "./src/models/job.js";
import { User } from "./src/models/User.js";
import { isValidObjectId, validateObjectId } from "./src/middleware/validateObjectId.js";

async function runTests() {
    console.log("=== DEVPIILOT TASK 6: SERVER STATE & ID VALIDATION VERIFICATION ===\n");

    // -------------------------------------------------------------
    // Unit Tests: isValidObjectId and validateObjectId Middleware
    // -------------------------------------------------------------
    console.log("--- 1. Testing validateObjectId Helper & Middleware ---");
    assert.strictEqual(isValidObjectId("abc"), false, '"abc" must be invalid');
    assert.strictEqual(isValidObjectId("123"), false, '"123" must be invalid');
    assert.strictEqual(isValidObjectId("507f1f77bcf86cd799439011"), true, '24-hex ObjectId must be valid');
    assert.strictEqual(isValidObjectId(null), false, 'null must be invalid');
    assert.strictEqual(isValidObjectId(undefined), false, 'undefined must be invalid');
    console.log("  [PASS] isValidObjectId accurately validates 24-character hexadecimal IDs");

    // Test middleware execution
    let capturedErr = null;
    const mockReq = { params: { projectId: "not-a-valid-id" } };
    const mockRes = {};
    const mockNext = (err) => { capturedErr = err; };
    validateObjectId(mockReq, mockRes, mockNext);
    assert.ok(capturedErr, "validateObjectId must call next with error when param is invalid");
    assert.strictEqual(capturedErr.statusCode, 400, "Error status code must be 400");
    console.log("  [PASS] validateObjectId middleware intercepted malformed param and passed 400 error");

    // -------------------------------------------------------------
    // Setup Mock Database & Auth Tokens for User A and User B
    // -------------------------------------------------------------
    console.log("\n--- 2. Setting up Mock Entities for Multi-Tenant Tests ---");
    const userAId = "607f1f77bcf86cd799439001";
    const userBId = "607f1f77bcf86cd799439002";

    const tokenA = jwt.sign(
        { user: { id: userAId, email: "userA@example.com", name: "User A" } },
        env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
    );

    const tokenB = jwt.sign(
        { user: { id: userBId, email: "userB@example.com", name: "User B" } },
        env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
    );

    const projAId = "707f1f77bcf86cd799439010";
    const testRunAId = "807f1f77bcf86cd799439020";
    const jobAId = "907f1f77bcf86cd799439030";

    // In-memory mock store
    const projectsDb = new Map();
    const testRunsDb = new Map();
    const jobsDb = new Map();

    const initialProjectA = {
        _id: projAId,
        name: "User A Secret Project",
        description: "Confidential codebase",
        repoUrl: "https://github.com/userA/secret-repo",
        repoBranch: "main",
        status: "disconnected",
        owner: userAId,
        save: async function () {
            projectsDb.set(this._id.toString(), { ...this });
            return this;
        }
    };
    projectsDb.set(projAId, initialProjectA);

    const initialTestRunA = {
        _id: testRunAId,
        projectId: projAId,
        userId: userAId,
        status: "passed",
        summary: { total: 10, passed: 10, failed: 0 },
        save: async function () {
            testRunsDb.set(this._id.toString(), { ...this });
            return this;
        }
    };
    testRunsDb.set(testRunAId, initialTestRunA);

    const initialJobA = {
        _id: jobAId,
        projectId: projAId,
        userId: userAId,
        type: "scan",
        status: "completed",
        progress: 100,
        save: async function () {
            jobsDb.set(this._id.toString(), { ...this });
            return this;
        }
    };
    jobsDb.set(jobAId, initialJobA);

    // Mock Mongoose model queries
    const origProjFindOne = Project.findOne;
    const origProjFindOneAndDelete = Project.findOneAndDelete;
    const origTestRunFindOne = TestRun.findOne;
    const origTestRunFindOneAndDelete = TestRun.findOneAndDelete;
    const origJobFindOne = Job.findOne;
    const origUserFindById = User.findById;

    Project.findOne = async function (filter) {
        const id = filter._id?.toString();
        const p = projectsDb.get(id);
        if (!p) return null;
        if (filter.owner && p.owner.toString() !== filter.owner.toString()) {
            return null; // Scoped by owner in DB query
        }
        return { ...p, save: p.save };
    };

    Project.findOneAndDelete = async function (filter) {
        const id = filter._id?.toString();
        const p = projectsDb.get(id);
        if (!p) return null;
        if (filter.owner && p.owner.toString() !== filter.owner.toString()) {
            return null;
        }
        projectsDb.delete(id);
        return p;
    };

    TestRun.findOne = async function (filter) {
        const id = filter._id?.toString();
        const tr = testRunsDb.get(id);
        if (!tr) return null;
        if (filter.userId && tr.userId.toString() !== filter.userId.toString()) {
            return null;
        }
        return { ...tr, save: tr.save };
    };

    TestRun.findOneAndDelete = async function (filter) {
        const id = filter._id?.toString();
        const tr = testRunsDb.get(id);
        if (!tr) return null;
        if (filter.userId && tr.userId.toString() !== filter.userId.toString()) {
            return null;
        }
        testRunsDb.delete(id);
        return tr;
    };

    Job.findOne = async function (filter) {
        const id = filter._id?.toString();
        const j = jobsDb.get(id);
        if (!j) return null;
        if (filter.userId && j.userId.toString() !== filter.userId.toString()) {
            return null;
        }
        return { ...j, save: j.save };
    };

    User.findById = function (id) {
        return {
            select: async () => ({
                _id: id,
                email: id === userAId ? "userA@example.com" : "userB@example.com",
                name: id === userAId ? "User A" : "User B",
                githubAccessToken: null,
            })
        };
    };

    // -------------------------------------------------------------
    // Live Server Setup
    // -------------------------------------------------------------
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`  Live test server listening on port ${port}`);

    try {
        // -------------------------------------------------------------
        // Condition 1: PATCH /api/projects/:id { status: "indexed" } leaves status unchanged
        // -------------------------------------------------------------
        console.log('\n--- 3. Testing Condition 1: PATCH /api/projects/:id { status: "indexed" } ---');
        const patchRes = await fetch(`${baseUrl}/api/projects/${projAId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${tokenA}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: "Updated Project Name By User A",
                status: "indexed" // Attempt to illegitimately force indexed state
            })
        });

        const patchData = await patchRes.json();
        console.log(`  PATCH status code: ${patchRes.status}, data:`, patchData);
        assert.strictEqual(patchRes.status, 200, "PATCH must return HTTP 200");
        assert.strictEqual(patchData.data.name, "Updated Project Name By User A", "Project name should be updated");
        assert.strictEqual(patchData.data.status, "disconnected", "Project status MUST REMAIN 'disconnected' and NOT change to 'indexed'");

        // Confirm database persistence
        const storedProject = projectsDb.get(projAId);
        assert.strictEqual(storedProject.status, "disconnected", "Database status must remain unchanged");
        console.log("  [PASS] Status parameter was ignored; status remained 'disconnected'");

        // -------------------------------------------------------------
        // Condition 2: GET /api/projects/abc → 400 (Bad ObjectId parameter)
        // -------------------------------------------------------------
        console.log("\n--- 4. Testing Condition 2: GET /api/projects/abc → 400 ---");
        const badIdRes = await fetch(`${baseUrl}/api/projects/abc`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenA}` }
        });
        const badIdData = await badIdRes.json();
        console.log(`  GET /api/projects/abc status: ${badIdRes.status}, body:`, badIdData);
        assert.strictEqual(badIdRes.status, 400, "GET /api/projects/abc must return HTTP 400");
        assert.ok(
            badIdData.message.includes("Invalid ID format"),
            `Message should indicate invalid ID format, got: "${badIdData.message}"`
        );
        console.log("  [PASS] GET /api/projects/abc rejected with HTTP 400");

        // Verify other routes with malformed IDs
        const badRunIdRes = await fetch(`${baseUrl}/api/test/run/invalidRun123`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenA}` }
        });
        assert.strictEqual(badRunIdRes.status, 400, "GET /api/test/run/invalidRun123 must return HTTP 400");
        console.log("  [PASS] GET /api/test/run/:runId with invalid ID returns HTTP 400");

        const badJobIdRes = await fetch(`${baseUrl}/api/scan/job/badJob456`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenA}` }
        });
        assert.strictEqual(badJobIdRes.status, 400, "GET /api/scan/job/badJob456 must return HTTP 400");
        console.log("  [PASS] GET /api/scan/job/:jobId with invalid ID returns HTTP 400");

        // -------------------------------------------------------------
        // Condition 3: User B cannot read, delete, scan, chat on or test-run User A's project
        // -------------------------------------------------------------
        console.log("\n--- 5. Testing Condition 3: Multi-Tenant Access Isolation (User B vs User A's Project) ---");

        // 3A: Read isolation
        console.log("  [Testing READ Isolation]");
        const userBReadRes = await fetch(`${baseUrl}/api/projects/${projAId}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        console.log(`    User B GET /api/projects/${projAId} -> status: ${userBReadRes.status}`);
        assert.strictEqual(userBReadRes.status, 404, "User B reading User A's project must return HTTP 404");

        const userBReadRunsRes = await fetch(`${baseUrl}/api/test/${projAId}/runs`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        assert.strictEqual(userBReadRunsRes.status, 404, "User B reading test runs of User A's project must return HTTP 404");

        const userBReadRunRes = await fetch(`${baseUrl}/api/test/run/${testRunAId}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        assert.strictEqual(userBReadRunRes.status, 404, "User B reading User A's test run detail must return HTTP 404");

        const userBReadJobRes = await fetch(`${baseUrl}/api/scan/job/${jobAId}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        assert.strictEqual(userBReadJobRes.status, 404, "User B reading User A's scan job status must return HTTP 404");

        const userBReadHistoryRes = await fetch(`${baseUrl}/api/scan/project/${projAId}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        assert.strictEqual(userBReadHistoryRes.status, 404, "User B reading User A's scan history must return HTTP 404");

        console.log("    [PASS] User B cannot read User A's project or associated records (all 404)");

        // 3B: Delete isolation
        console.log("  [Testing DELETE Isolation]");
        const userBDeleteRes = await fetch(`${baseUrl}/api/projects/${projAId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        console.log(`    User B DELETE /api/projects/${projAId} -> status: ${userBDeleteRes.status}`);
        assert.strictEqual(userBDeleteRes.status, 404, "User B deleting User A's project must return HTTP 404");
        assert.ok(projectsDb.has(projAId), "User A's project must still exist in DB after User B attempt");

        const userBDeleteRunRes = await fetch(`${baseUrl}/api/test/run/${testRunAId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        assert.strictEqual(userBDeleteRunRes.status, 404, "User B deleting User A's test run must return HTTP 404");
        assert.ok(testRunsDb.has(testRunAId), "User A's test run must still exist in DB after User B attempt");

        console.log("    [PASS] User B cannot delete User A's project or test runs (all 404)");

        // 3C: Scan isolation
        console.log("  [Testing SCAN Isolation]");
        const userBScanRes = await fetch(`${baseUrl}/api/scan/${projAId}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${tokenB}` }
        });
        console.log(`    User B POST /api/scan/${projAId} -> status: ${userBScanRes.status}`);
        assert.strictEqual(userBScanRes.status, 404, "User B triggering scan on User A's project must return HTTP 404");
        console.log("    [PASS] User B cannot scan User A's project (returns 404)");

        // 3D: Chat isolation
        console.log("  [Testing CHAT Isolation]");
        const userBChatRes = await fetch(`${baseUrl}/api/chat/ask`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${tokenB}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                projectId: projAId,
                query: "What does this project do?"
            })
        });
        console.log(`    User B POST /api/chat/ask -> status: ${userBChatRes.status}`);
        assert.strictEqual(userBChatRes.status, 404, "User B chatting with User A's project must return HTTP 404");
        console.log("    [PASS] User B cannot chat on User A's project (returns 404)");

        // 3E: Test-run isolation
        console.log("  [Testing TEST-RUN Isolation]");
        const userBTestRes = await fetch(`${baseUrl}/api/test/${projAId}/run`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${tokenB}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                testCommand: "npm test"
            })
        });
        console.log(`    User B POST /api/test/${projAId}/run -> status: ${userBTestRes.status}`);
        assert.strictEqual(userBTestRes.status, 404, "User B running tests on User A's project must return HTTP 404");

        const userBVerifyRes = await fetch(`${baseUrl}/api/test/${projAId}/verify-fix`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${tokenB}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                customFailure: { testTitle: "mock" }
            })
        });
        assert.strictEqual(userBVerifyRes.status, 404, "User B running verify-fix on User A's project must return HTTP 404");

        const userBPrRes = await fetch(`${baseUrl}/api/test/${projAId}/create-pr`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${tokenB}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                filePath: "src/index.js",
                modifiedContent: "// fixed"
            })
        });
        assert.strictEqual(userBPrRes.status, 404, "User B creating PR on User A's project must return HTTP 404");

        console.log("    [PASS] User B cannot test-run or execute loops on User A's project (all 404)");

        console.log("\n=======================================================");
        console.log("ALL TASK 6 STATE & ID VALIDATION TESTS PASSED (100%)!");
        console.log("=======================================================\n");

    } finally {
        Project.findOne = origProjFindOne;
        Project.findOneAndDelete = origProjFindOneAndDelete;
        TestRun.findOne = origTestRunFindOne;
        TestRun.findOneAndDelete = origTestRunFindOneAndDelete;
        Job.findOne = origJobFindOne;
        User.findById = origUserFindById;
        server.close();
    }
}

runTests().catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
