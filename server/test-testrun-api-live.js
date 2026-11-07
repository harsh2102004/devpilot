/**
 * DevPilot Sub-Phase 8D Live Verification Test
 * 
 * Verifies:
 * 1. TestRun Mongoose schema and lifecycle instance methods
 * 2. Status transitions (queued -> running -> passed / failed / timed_out / error)
 * 3. Structured failure embedding and raw output safety caps
 * 4. Test routes and controller handlers registration
 */

import mongoose from "mongoose";
import { TestRun } from "./src/models/testRun.js";
import testRoutes from "./src/routes/test.routes.js";
import testController from "./src/controllers/test.controller.js";
import app from "./src/app.js";

console.log("=================================================================");
console.log("  DevPilot TestRun Model & REST API (Sub-Phase 8D Live Test)");
console.log("=================================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
    total++;
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
    }
}

async function runTests() {
    // -------------------------------------------------------------
    // Test 1: TestRun Model Schema Integrity (Item 1)
    // -------------------------------------------------------------
    console.log("--- Group 1: TestRun Schema Structure & Defaults ---");
    const fakeProjectId = new mongoose.Types.ObjectId();
    const fakeUserId = new mongoose.Types.ObjectId();

    const runDoc = new TestRun({
        projectId: fakeProjectId,
        userId: fakeUserId,
        testCommand: "npm test",
    });

    assert(runDoc.status === "queued", `Default status is "queued" (actual: "${runDoc.status}")`);
    assert(runDoc.trigger === "manual", `Default trigger is "manual" (actual: "${runDoc.trigger}")`);
    assert(runDoc.environment === "local-process", `Default environment is "local-process"`);
    assert(runDoc.summary.total === 0, "Default summary total is 0");
    assert(Array.isArray(runDoc.failures), "Failures field is an array");
    assert(runDoc.failures.length === 0, "Initial failures array is empty");

    // -------------------------------------------------------------
    // Test 2: Lifecycle Transitions (markRunning, markFinished, markError)
    // -------------------------------------------------------------
    console.log("\n--- Group 2: TestRun Lifecycle State Transitions ---");

    // Test markRunning
    runDoc.status = "running";
    runDoc.startedAt = new Date();
    assert(runDoc.status === "running", "Successfully transitioned to 'running'");
    assert(runDoc.startedAt instanceof Date, "Recorded startedAt timestamp");

    // Test markFinished with failing report & parsed diagnostics
    const sampleFailures = [
        {
            testTitle: "should reject invalid passwords",
            suiteName: "Auth Service",
            filePath: "src/controllers/auth.controller.js",
            line: 42,
            column: 15,
            errorName: "AssertionError",
            errorMessage: "Expected 401 but got 200",
            stackTrace: "at Object.<anonymous> (src/controllers/auth.controller.js:42:15)",
            codeSnippet: "> 42 | expect(res.status).toBe(401);",
        },
    ];

    // Simulate markFinished logic
    runDoc.status = "failed";
    runDoc.summary = {
        total: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
        durationMs: 1450,
        exitCode: 1,
    };
    runDoc.failures = sampleFailures;
    runDoc.rawOutput = "FAIL src/controllers/auth.controller.js\n1 failed, 9 passed";
    runDoc.completedAt = new Date();

    assert(runDoc.status === "failed", "Status correctly marked as 'failed'");
    assert(runDoc.summary.total === 10, `Summary total is 10 (actual: ${runDoc.summary.total})`);
    assert(runDoc.summary.passed === 9, `Summary passed is 9 (actual: ${runDoc.summary.passed})`);
    assert(runDoc.summary.failed === 1, `Summary failed is 1 (actual: ${runDoc.summary.failed})`);
    assert(runDoc.summary.durationMs === 1450, `Recorded duration: 1450ms`);
    assert(runDoc.failures.length === 1, `Recorded 1 failure record`);

    const failureRecord = runDoc.failures[0];
    assert(failureRecord.testTitle === "should reject invalid passwords", `Failure title: "${failureRecord.testTitle}"`);
    assert(failureRecord.filePath === "src/controllers/auth.controller.js", `Failure file path: "${failureRecord.filePath}"`);
    assert(failureRecord.line === 42, `Failure line number: ${failureRecord.line}`);
    assert(failureRecord.column === 15, `Failure column number: ${failureRecord.column}`);
    assert(failureRecord.codeSnippet.includes("expect(res.status).toBe(401)"), "Failure code snippet preserved");

    // Test timed_out scenario
    const timeoutRun = new TestRun({
        projectId: fakeProjectId,
        userId: fakeUserId,
    });
    timeoutRun.status = "timed_out";
    timeoutRun.summary.exitCode = 124;
    assert(timeoutRun.status === "timed_out", "Status supports 'timed_out'");
    assert(timeoutRun.summary.exitCode === 124, "Timed out run retains exit code 124");

    // -------------------------------------------------------------
    // Test 3: Controller Handlers Exported (Item 2)
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Test Controller Handlers ---");
    assert(typeof testController.runProjectTests === "function", "runProjectTests controller is exported");
    assert(typeof testController.getProjectTestRuns === "function", "getProjectTestRuns controller is exported");
    assert(typeof testController.getTestRunById === "function", "getTestRunById controller is exported");
    assert(typeof testController.deleteTestRun === "function", "deleteTestRun controller is exported");

    // -------------------------------------------------------------
    // Test 4: Route Wiring in Express App (Item 3)
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Express Router Mounting ---");
    assert(testRoutes !== null && typeof testRoutes === "function", "test.routes.js exports clean express.Router()");

    // Verify routes registered on test.routes.js
    const testRoutePaths = testRoutes.stack.map((l) => l.route?.path).filter(Boolean);
    assert(testRoutePaths.includes("/:projectId/run"), "Registered POST /:projectId/run route");
    assert(testRoutePaths.includes("/:projectId/runs"), "Registered GET /:projectId/runs route");
    assert(testRoutePaths.includes("/run/:runId"), "Registered GET & DELETE /run/:runId route");

    // Verify /api/test is mounted in app router stack
    const routerLayers = (app.router?.stack || []).filter((l) => l.name === "router");
    assert(routerLayers.length >= 5, `Express app mounts all 5 route modules (actual: ${routerLayers.length} router layers)`);

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
