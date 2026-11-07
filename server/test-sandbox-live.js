/**
 * DevPilot Sandbox Service Comprehensive Live Verification Test (Sub-Phase 8A)
 * 
 * Verifies:
 * 1. Docker sandbox runner service configuration
 * 2. Container security boundaries:
 *    - Read-only volume mounts (:ro) and tmpfs caches
 *    - Memory limits (512m / 1024m) and memory-swap caps
 *    - CPU limits (1.0) and process count caps (pids-limit)
 *    - Non-root user execution (--user 1000:1000)
 *    - Security options (--security-opt no-new-privileges:true, --cap-drop=ALL)
 * 3. Execution timeout watchdog (kills rogue execution after timeoutMs with exitCode 124)
 * 4. Dual-mode execution & real-time log streaming
 */

import {
    isDockerAvailable,
    detectProjectEnvironment,
    normalizeVolumePath,
    buildDockerRunArgs,
    executeInSandbox,
} from "./src/services/sandbox.service.js";

import path from "path";
import fs from "fs";

console.log("=================================================================");
console.log("  DevPilot Sandbox Service Verification (Sub-Phase 8A Live Test)");
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
    // Test 1: Docker Probing & Path Normalization
    // -------------------------------------------------------------
    console.log("--- Group 1: Docker Probing & Path Normalization ---");
    const dockerInfo = await isDockerAvailable();
    assert(typeof dockerInfo.available === "boolean", `isDockerAvailable returned boolean (available=${dockerInfo.available})`);
    if (dockerInfo.available) {
        console.log(`    Docker engine detected: version ${dockerInfo.version}`);
    } else {
        console.log(`    Docker daemon offline/not reachable, sandbox seamlessly uses secure process isolation fallback`);
    }

    const normPath = normalizeVolumePath("C:\\Users\\dev\\project");
    assert(!normPath.includes("\\") && normPath.includes("/"), "normalizeVolumePath converts backslashes to forward slashes");

    // -------------------------------------------------------------
    // Test 2: Container Security Boundaries Configuration (Item 2)
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Container Security Boundaries Configuration ---");
    
    // Scenario 2A: 512MB memory cap, read-only volume, non-root user
    const secArgs1 = buildDockerRunArgs({
        containerId: "devpilot-test-sec1",
        workingDir: "C:/fake/path",
        command: "npm test",
        memoryLimit: "512m",
        cpuLimit: "0.5",
        pidsLimit: 50,
        readOnly: true,
        user: "1000:1000",
    });

    assert(secArgs1.includes("--memory=512m"), "Enforces 512MB memory constraint (--memory=512m)");
    assert(secArgs1.includes("--memory-swap=512m"), "Prevents memory swap escalation (--memory-swap=512m)");
    assert(secArgs1.includes("--cpus=0.5"), "Enforces 0.5 CPU constraint (--cpus=0.5)");
    assert(secArgs1.includes("--pids-limit=50"), "Enforces process count limit to block fork bombs (--pids-limit=50)");
    assert(secArgs1.includes("--user") && secArgs1[secArgs1.indexOf("--user") + 1] === "1000:1000", "Enforces non-root user execution (--user 1000:1000)");
    assert(secArgs1.some(arg => arg.includes(":/workspace:ro")), "Configured read-only volume mount (:ro)");
    assert(secArgs1.includes("--tmpfs"), "Configured tmpfs cache mount for read-only containers");
    assert(secArgs1.includes("--security-opt") && secArgs1.includes("no-new-privileges:true"), "Prevents privilege escalation (--security-opt no-new-privileges:true)");
    assert(secArgs1.includes("--cap-drop=ALL"), "Drops all root capabilities (--cap-drop=ALL)");

    // Scenario 2B: 1GB (1024MB) memory cap, standard read-write volume
    const secArgs2 = buildDockerRunArgs({
        containerId: "devpilot-test-sec2",
        workingDir: "C:/fake/path",
        command: "npm test",
        memoryLimit: "1024m",
        cpuLimit: "1.0",
        pidsLimit: 100,
        readOnly: false,
        user: "1000:1000",
    });

    assert(secArgs2.includes("--memory=1024m"), "Enforces 1GB (1024MB) memory constraint (--memory=1024m)");
    assert(secArgs2.includes("--cpus=1.0"), "Enforces 1.0 CPU constraint (--cpus=1.0)");
    assert(secArgs2.some(arg => arg.includes(":/workspace") && !arg.includes(":ro")), "Configured read-write volume mount");

    // -------------------------------------------------------------
    // Test 3: Project Runtime Detection
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Project Runtime & Runner Detection ---");
    const serverEnv = detectProjectEnvironment(".");
    assert(serverEnv.runtime === "node", `Identified server runtime as node (${serverEnv.runtime})`);
    assert(serverEnv.hasPackageJson === true, "Detected package.json in server root");
    assert(typeof serverEnv.testCommand === "string", `Determined test command: "${serverEnv.testCommand}"`);

    // -------------------------------------------------------------
    // Test 4: Live Sandboxed Command Execution
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Live Sandboxed Command Execution & Stream ---");
    let streamedChunks = 0;
    const testResult = await executeInSandbox({
        workingDir: ".",
        command: "node -e \"console.log('DevPilot sandbox execution live'); process.stdout.write('Stream chunk 2');\"",
        timeoutMs: 10000,
        onLog: (chunk) => {
            if (chunk) streamedChunks++;
        },
    });

    assert(testResult.success === true, "Command executed successfully");
    assert(testResult.exitCode === 0, `Exit code is 0 (actual: ${testResult.exitCode})`);
    assert(testResult.output.includes("DevPilot sandbox execution live"), "Captured stdout in result output");
    assert(testResult.timedOut === false, "Execution completed within timeout");
    assert(streamedChunks > 0, `Live log streaming callback received chunks (${streamedChunks} chunks)`);
    assert(testResult.environment === "docker" || testResult.environment === "local-process", `Reported active environment: "${testResult.environment}"`);

    // -------------------------------------------------------------
    // Test 5: Execution Watchdog Timeout (Item 3)
    // -------------------------------------------------------------
    console.log("\n--- Group 5: Execution Timeout Watchdog ---");
    const startTime = Date.now();
    const timeoutResult = await executeInSandbox({
        workingDir: ".",
        // Command attempts to sleep for 20 seconds, watchdog timeout capped at 1500ms
        command: "node -e \"setTimeout(() => console.log('Hanging rogue process'), 20000);\"",
        timeoutMs: 1500,
    });
    const elapsed = Date.now() - startTime;

    assert(timeoutResult.timedOut === true, "Watchdog triggered: timedOut is true");
    assert(timeoutResult.success === false, "Timed out command returned success=false");
    assert(timeoutResult.exitCode === 124, `Timed out process exited with standard timeout exit code 124 (actual: ${timeoutResult.exitCode})`);
    assert(elapsed < 4500, `Watchdog killed rogue execution promptly (${elapsed}ms < 4500ms limit)`);
    assert(
        timeoutResult.stderr.includes("exceeded timeout") || timeoutResult.stderr.includes("timed out"),
        "Watchdog appended informative timeout notice to logs"
    );

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Test runner encountered an unhandled exception:", err);
    process.exit(1);
});
