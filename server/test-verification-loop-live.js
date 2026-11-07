/**
 * DevPilot Sandbox Verification Loop Live Test Suite (Sub-Phase 9C)
 *
 * Verifies:
 * 1. Isolated workspace creation, file filtering, and safe cleanup
 * 2. Patch application to isolated workspace with AST syntax validation & path traversal defense
 * 3. Sandboxed test execution and result parsing in isolated workspace
 * 4. Multi-attempt autonomous reflection loop (re-feeding errors up to 3 attempts)
 * 5. Full fix cycle: failing test -> autonomous patch -> sandboxed re-test -> verified fix
 * 6. REST API endpoint registration (POST /api/test/:projectId/verify-fix)
 */

import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import {
    createIsolatedWorkspace,
    cleanupIsolatedWorkspace,
    applyPatchToWorkspace,
    runVerificationTest,
    formatReflectionFeedback,
    executeAutonomousVerificationLoop,
} from "./src/services/verificationLoop.service.js";
import testRoutes from "./src/routes/test.routes.js";
import app from "./src/app.js";

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
    console.log("  DevPilot Sandbox Verification Loop (Sub-Phase 9C Live Test)");
    console.log("=================================================================\n");

    // Setup temporary mock project for testing
    const mockRepoDir = path.join(os.tmpdir(), `devpilot-test-repo-${Date.now()}`);
    await fs.mkdir(path.join(mockRepoDir, "src"), { recursive: true });
    await fs.mkdir(path.join(mockRepoDir, "tests"), { recursive: true });

    // Culprit code with intentional bug (returns 200 instead of 401)
    const authCode = [
        "export function authenticate(req, res, next) {",
        "    const token = req.headers['authorization'];",
        "    if (!token) {",
        "        // BUG: status code 200 instead of 401",
        "        return res.status(200).json({ error: 'Unauthorized' });",
        "    }",
        "    return next();",
        "}",
    ].join("\n");

    // Test runner script that asserts the behavior
    const testRunnerScript = [
        "import assert from 'assert';",
        "import { authenticate } from '../src/auth.js';",
        "",
        "let capturedStatus = 0;",
        "let capturedJson = null;",
        "const mockRes = {",
        "    status(code) { capturedStatus = code; return this; },",
        "    json(payload) { capturedJson = payload; return this; },",
        "};",
        "",
        "// Test 1: Should reject missing token with 401",
        "authenticate({ headers: {} }, mockRes, () => {});",
        "if (capturedStatus !== 401) {",
        "    console.error('FAIL: Expected 401 but received ' + capturedStatus);",
        "    process.exit(1);",
        "} else {",
        "    console.log('PASS: Authentication correctly returned 401 Unauthorized');",
        "    process.exit(0);",
        "}",
    ].join("\n");

    const packageJson = JSON.stringify(
        {
            name: "mock-auth-project",
            version: "1.0.0",
            type: "module",
            scripts: {
                test: "node tests/auth.test.js",
            },
        },
        null,
        2
    );

    await fs.writeFile(path.join(mockRepoDir, "package.json"), packageJson, "utf8");
    await fs.writeFile(path.join(mockRepoDir, "src", "auth.js"), authCode, "utf8");
    await fs.writeFile(path.join(mockRepoDir, "tests", "auth.test.js"), testRunnerScript, "utf8");

    // -------------------------------------------------------------
    // Group 1: Isolated Workspace Management
    // -------------------------------------------------------------
    console.log("--- Group 1: Isolated Workspace Management ---");
    const workspaceInfo = await createIsolatedWorkspace({
        repoDir: mockRepoDir,
        prefix: "test-workspace",
    });

    assert(existsSync(workspaceInfo.workspaceDir), "Isolated workspace directory created on disk");
    assert(workspaceInfo.workspaceDir.includes("devpilot-verification"), "Workspace located in dedicated sandbox root");
    assert(existsSync(path.join(workspaceInfo.workspaceDir, "src", "auth.js")), "Workspace successfully cloned culprit source file");
    assert(existsSync(path.join(workspaceInfo.workspaceDir, "tests", "auth.test.js")), "Workspace successfully cloned test runner");

    // -------------------------------------------------------------
    // Group 2: Patch Application & Safety Checks
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Patch Application & Safety Integrity Checks ---");

    // 2A: Valid patch application
    const validPatchApply = await applyPatchToWorkspace({
        workspaceDir: workspaceInfo.workspaceDir,
        filePath: "src/auth.js",
        targetCode: "return res.status(200).json({ error: 'Unauthorized' });",
        replacementCode: "return res.status(401).json({ error: 'Unauthorized' });",
    });

    assert(validPatchApply.success === true, "Valid code patch successfully applied to workspace");
    assert(validPatchApply.astValid === true, "Applied code passed AST syntax integrity check");
    assert(validPatchApply.unifiedDiff.includes("-        return res.status(200)"), "Unified diff captures deleted buggy line");
    assert(validPatchApply.unifiedDiff.includes("+        return res.status(401)"), "Unified diff captures inserted fix line");

    const onDiskModified = await fs.readFile(path.join(workspaceInfo.workspaceDir, "src", "auth.js"), "utf8");
    assert(onDiskModified.includes("status(401)"), "On-disk file content in isolated workspace reflects updated status");

    // 2B: Malformed syntax rejection (AST safety guard)
    const malformedApply = await applyPatchToWorkspace({
        workspaceDir: workspaceInfo.workspaceDir,
        filePath: "src/auth.js",
        targetCode: "return res.status(401).json({ error: 'Unauthorized' });",
        replacementCode: "return res.status(401).json({ error: 'Unauthorized' }BROKEN",
    });

    assert(malformedApply.success === false, "Malformed patch rejected by AST validation before disk mutation");
    assert(malformedApply.astValid === false, "astValid flagged as false");
    assert(Boolean(malformedApply.syntaxError), "Captured syntax error description");

    // 2C: Security Path Traversal Guard
    let traversalBlocked = false;
    try {
        await applyPatchToWorkspace({
            workspaceDir: workspaceInfo.workspaceDir,
            filePath: "../../../etc/passwd",
            targetCode: "root",
            replacementCode: "hacked",
        });
    } catch (err) {
        traversalBlocked = err.message.includes("Path traversal detected");
    }
    assert(traversalBlocked, "Security guard blocks directory traversal outside workspace");

    // Clean up temporary test workspace
    await workspaceInfo.cleanup();
    assert(!existsSync(workspaceInfo.workspaceDir), "Isolated workspace cleaned up completely");

    // -------------------------------------------------------------
    // Group 3: Sandboxed Execution of Baseline vs Patched Project
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Sandboxed Test Execution ---");

    // Create fresh workspace with original buggy code
    const sandboxWorkspace = await createIsolatedWorkspace({
        repoDir: mockRepoDir,
        prefix: "sandbox-run",
    });

    // 3A: Execute baseline tests (expected to fail)
    const baselineTest = await runVerificationTest({
        workspaceDir: sandboxWorkspace.workspaceDir,
        testCommand: "node tests/auth.test.js",
    });

    assert(baselineTest.passed === false, "Baseline test correctly fails with buggy code");
    assert(baselineTest.exitCode !== 0, "Baseline test returned non-zero exit code");
    assert(baselineTest.rawOutput.includes("Expected 401 but received 200"), "Failure output captured expected vs received mismatch");

    // 3B: Apply fix to workspace and re-run sandbox test
    await applyPatchToWorkspace({
        workspaceDir: sandboxWorkspace.workspaceDir,
        filePath: "src/auth.js",
        targetCode: "return res.status(200).json({ error: 'Unauthorized' });",
        replacementCode: "return res.status(401).json({ error: 'Unauthorized' });",
    });

    const verifiedTest = await runVerificationTest({
        workspaceDir: sandboxWorkspace.workspaceDir,
        testCommand: "node tests/auth.test.js",
    });

    assert(verifiedTest.passed === true, "Patched test run passes in sandbox!");
    assert(verifiedTest.exitCode === 0, "Patched test returned exit code 0");
    assert(verifiedTest.rawOutput.includes("PASS: Authentication correctly returned 401"), "Execution log shows test pass confirmation");

    await sandboxWorkspace.cleanup();

    // -------------------------------------------------------------
    // Group 4: Reflection Feedback Formulation
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Autonomous Reflection Feedback Formulation ---");
    const reflectionPrompt = formatReflectionFeedback({
        attemptNumber: 1,
        failure: {
            testTitle: "should reject missing token with 401",
            errorName: "AssertionError",
            errorMessage: "Expected 401 but received 200",
            line: 5,
        },
        prevPatch: {
            targetCode: "res.status(200)",
            replacementCode: "res.status(500)",
        },
        prevTestResult: {
            exitCode: 1,
            timedOut: false,
            failures: [
                {
                    testTitle: "should reject missing token with 401",
                    errorName: "AssertionError",
                    errorMessage: "Expected 401 but received 500",
                    line: 5,
                },
            ],
            rawOutput: "FAIL: Expected 401 but received 500",
        },
    });

    assert(reflectionPrompt.includes("Attempt 1 Failed Verification"), "Reflection header specifies failed attempt");
    assert(reflectionPrompt.includes("res.status(500)"), "Reflection documents previous flawed patch");
    assert(reflectionPrompt.includes("Expected 401 but received 500"), "Reflection includes previous test failure details");
    assert(reflectionPrompt.includes("Do NOT propose the same patch again"), "Reflection explicitly instructs agent to adapt fix");

    // -------------------------------------------------------------
    // Group 5: Master Autonomous Verification Loop End-to-End
    // -------------------------------------------------------------
    console.log("\n--- Group 5: Master Autonomous Verification Loop ---");

    const failureEvidence = {
        testTitle: "should reject missing token with 401",
        suiteName: "Authentication Suite",
        filePath: "src/auth.js",
        line: 5,
        errorName: "AssertionError",
        errorMessage: "Expected 401 but received 200",
    };

    const loopResult = await executeAutonomousVerificationLoop({
        projectId: "670f1a2b3c4d5e6f7a8b9c0d",
        projectName: "Mock Auth Project",
        repoDir: mockRepoDir,
        failure: failureEvidence,
        testCommand: "node tests/auth.test.js",
        maxAttempts: 3,
        preferDocker: false,
    });

    assert(loopResult.success === true, "Autonomous verification loop succeeded");
    assert(loopResult.verified === true, "Fix verified with passing tests in sandbox");
    assert(loopResult.attemptsCount >= 1 && loopResult.attemptsCount <= 3, "Completed within allowed maxAttempts (<= 3)");
    assert(loopResult.attemptsHistory.length > 0, "Recorded detailed attempts history");
    assert(loopResult.verifiedPatch.astValid === true, "Final verified patch is AST valid");
    assert(loopResult.verifiedPatch.unifiedDiff.includes("+        return res.status(401)"), "Verified patch contains unified diff of resolution");
    assert(loopResult.finalTestResult.passed === true, "Final sandbox test report confirmed passing");

    // Verify source repo was completely untouched (true isolation)
    const baseSourceStillUnmodified = await fs.readFile(path.join(mockRepoDir, "src", "auth.js"), "utf8");
    assert(baseSourceStillUnmodified.includes("status(200)"), "Original repository remained untouched throughout the sandbox loop");

    if (loopResult.cleanup) {
        await loopResult.cleanup();
    }

    // -------------------------------------------------------------
    // Group 6: REST API Endpoint Wiring
    // -------------------------------------------------------------
    console.log("\n--- Group 6: REST API Endpoint Verification ---");
    const registeredRoutes = testRoutes.stack
        .filter((layer) => layer.route)
        .map((layer) => ({
            path: layer.route.path,
            method: Object.keys(layer.route.methods)[0].toUpperCase(),
        }));

    const verifyFixRoute = registeredRoutes.find((r) => r.path === "/:projectId/verify-fix" && r.method === "POST");
    assert(Boolean(verifyFixRoute), "POST /api/test/:projectId/verify-fix mounted in test routes");

    // Clean up base mock repo
    await fs.rm(mockRepoDir, { recursive: true, force: true });

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

