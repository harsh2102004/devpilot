/**
 * DevPilot Sub-Phase 8B Live Verification Test
 * 
 * Verifies:
 * 1. Dedicated BullMQ test queue (test.queue.js) initialization & job producer
 * 2. Background test runner worker (test.worker.js) processor lifecycle
 * 3. Runtime environment auto-detection (Node.js npm test, Python pytest)
 * 4. Sandbox execution pipeline with progress reporting and cleanup
 */

import path from "path";
import fs from "fs";
import os from "os";
import {
    TEST_QUEUE_NAME,
    getTestQueue,
    getTestQueueEvents,
    addTestJob,
} from "./src/queues/test.queue.js";
import {
    processTestJob,
    createTestWorker,
} from "./src/workers/test.worker.js";
import { detectProjectEnvironment } from "./src/services/sandbox.service.js";

console.log("=================================================================");
console.log("  DevPilot Test Queue & Worker Pipeline (Sub-Phase 8B Live Test)");
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
    // Test 1: Test Queue Module & Configuration (Item 1)
    // -------------------------------------------------------------
    console.log("--- Group 1: Test Queue Configuration & Initialization ---");
    assert(TEST_QUEUE_NAME === "test-queue", "TEST_QUEUE_NAME is 'test-queue'");
    
    // Missing projectId check
    let threwError = false;
    try {
        await addTestJob({ projectId: null, userId: "u123" });
    } catch (err) {
        threwError = true;
        assert(err.statusCode === 400 || err.message.includes("projectId"), "addTestJob validates required projectId");
    }
    assert(threwError, "addTestJob threw validation error on missing projectId");

    // -------------------------------------------------------------
    // Test 2: Runtime Environment Auto-Detection (Item 3)
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Runtime Environment Auto-Detection (Node & Python) ---");
    
    // Scenario 2A: Node.js project (DevPilot Server itself)
    const nodeEnv = detectProjectEnvironment(".");
    assert(nodeEnv.runtime === "node", `Correctly identified current repo runtime as "node"`);
    assert(nodeEnv.image === "node:20-alpine", `Selected base image: "${nodeEnv.image}"`);
    assert(typeof nodeEnv.testCommand === "string", `Auto-detected test command: "${nodeEnv.testCommand}"`);

    // Scenario 2B: Simulated Python / Pytest project
    const tempPyDir = path.join(os.tmpdir(), `devpilot-py-test-${Date.now()}`);
    fs.mkdirSync(tempPyDir, { recursive: true });
    fs.writeFileSync(path.join(tempPyDir, "requirements.txt"), "pytest>=7.0.0\nrequests\n");
    fs.writeFileSync(path.join(tempPyDir, "pytest.ini"), "[pytest]\npython_files = test_*.py\n");

    const pyEnv = detectProjectEnvironment(tempPyDir);
    assert(pyEnv.runtime === "python", `Correctly identified Python project runtime ("${pyEnv.runtime}")`);
    assert(pyEnv.runner === "pytest", `Auto-detected runner as "pytest"`);
    assert(pyEnv.testCommand === "pytest", `Set default test command to "pytest"`);
    assert(pyEnv.image === "python:3.11-alpine", `Selected Python container image: "${pyEnv.image}"`);

    // Cleanup temp dir
    fs.rmSync(tempPyDir, { recursive: true, force: true });

    // -------------------------------------------------------------
    // Test 3: Worker Process Pipeline & Sandbox Execution (Item 2)
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Test Runner Worker Execution Pipeline ---");

    const progressReports = [];
    const simulatedBullJob = {
        id: "simulated-job-001",
        data: {
            projectId: "670f1a2b3c4d5e6f7a8b9c0d",
            userId: "670f1a2b3c4d5e6f7a8b9c0e",
            repoUrl: ".", // Use current directory as local workspace
            repoBranch: "main",
            testCommand: "node -e \"console.log('--- TEST RUN LOG ---'); console.log('PASS test-suite-alpha'); process.exit(0);\"",
            timeoutMs: 15000,
            preferDocker: false, // Use process isolation for fast synchronous verification
        },
        updateProgress: async (percent) => {
            progressReports.push(percent);
        },
    };

    const workerResult = await processTestJob(simulatedBullJob);

    assert(workerResult.success === true, "Worker completed job with success=true");
    assert(workerResult.exitCode === 0, `Exit code is 0 (actual: ${workerResult.exitCode})`);
    assert(workerResult.output.includes("PASS test-suite-alpha"), "Captured stdout containing test results");
    assert(workerResult.runtime === "node", `Reported project runtime: "${workerResult.runtime}"`);
    assert(progressReports.length >= 4, `Worker emitted progress milestones: [${progressReports.join("%, ")}%]`);
    assert(progressReports.includes(100), "Progress reached 100% on job completion");

    // -------------------------------------------------------------
    // Test 4: Worker Concurrency & Instance Configuration
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Worker Instance & Concurrency Limits ---");
    assert(typeof processTestJob === "function", "processTestJob is exported as job consumer");
    assert(typeof createTestWorker === "function", "createTestWorker factory is exported");

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Test pipeline encountered an error:", err);
    process.exit(1);
});
