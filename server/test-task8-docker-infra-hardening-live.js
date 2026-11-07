/**
 * DevPilot Task 8: Docker & Infrastructure Security Hardening Live Test Suite
 *
 * Verifies:
 * 1. docker-compose.yml syntax and security settings:
 *    - MongoDB and Redis have NO published ports to host.
 *    - Redis enforces requirepass and REDIS_PASSWORD.
 *    - MongoDB enforces root credentials (MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD).
 *    - API server does NOT mount /var/run/docker.sock.
 *    - All backend services pass authenticated MONGO_URI and REDIS_PASSWORD.
 * 2. server/Dockerfile enforces non-root execution (USER node).
 * 3. Redis client configuration properly passes REDIS_PASSWORD.
 * 4. README documents Docker socket access warning and runner isolation.
 */

import assert from "assert";
import fs from "fs";
import path from "path";

async function runTests() {
    console.log("=== DEVPIILOT TASK 8: DOCKER & INFRASTRUCTURE HARDENING VERIFICATION ===\n");

    const rootDir = path.resolve("..");
    const composePath = path.join(rootDir, "docker-compose.yml");
    const serverDockerfilePath = path.join(rootDir, "server", "Dockerfile");
    const readmePath = path.join(rootDir, "README.md");

    // -------------------------------------------------------------
    // Test 1: docker-compose.yml Port Hardening & Credentials
    // -------------------------------------------------------------
    console.log("--- 1. Inspecting docker-compose.yml Security Specifications ---");
    assert.ok(fs.existsSync(composePath), "docker-compose.yml must exist at repo root");
    const composeContent = fs.readFileSync(composePath, "utf8");

    // 1A. Verify Mongo has NO published ports
    const mongoSection = composeContent.split(/[\r\n]+  mongo:[\r\n]+/)[1]?.split(/[\r\n]+  redis:[\r\n]+/)[0];
    assert.ok(mongoSection, "mongo service must exist in docker-compose.yml");
    assert.ok(
        !mongoSection.includes("ports:"),
        "MongoDB ports must NOT be published to the host network (internal network only)"
    );
    assert.ok(
        mongoSection.includes("MONGO_INITDB_ROOT_USERNAME"),
        "MongoDB must configure root username authentication"
    );
    assert.ok(
        mongoSection.includes("MONGO_INITDB_ROOT_PASSWORD"),
        "MongoDB must configure root password authentication"
    );
    console.log("  [PASS] MongoDB ports removed; root authentication configured");

    // 1B. Verify Redis has NO published ports and requires password
    const redisSection = composeContent.split(/[\r\n]+  redis:[\r\n]+/)[1]?.split(/[\r\n]+  server:[\r\n]+/)[0];
    assert.ok(redisSection, "redis service must exist in docker-compose.yml");
    assert.ok(
        !redisSection.includes("ports:"),
        "Redis ports must NOT be published to the host network (internal network only)"
    );
    assert.ok(
        redisSection.includes("--requirepass"),
        "Redis command must enforce --requirepass"
    );
    assert.ok(
        redisSection.includes("REDIS_PASSWORD"),
        "Redis service must configure REDIS_PASSWORD"
    );
    console.log("  [PASS] Redis ports removed; --requirepass enforced with REDIS_PASSWORD");

    // 1C. Verify server container does NOT mount docker.sock
    const serverSection = composeContent.split(/[\r\n]+  server:[\r\n]+/)[1]?.split(/[\r\n]+  scanner-worker:[\r\n]+/)[0];
    assert.ok(serverSection, "server service must exist in docker-compose.yml");
    assert.ok(
        !serverSection.match(/-\s+[\/\\]var[\/\\]run[\/\\]docker\.sock/),
        "API server container must NOT mount /var/run/docker.sock (isolated to test-worker runner only)"
    );
    assert.ok(
        serverSection.includes("authSource=admin"),
        "Server MONGO_URI must authenticate via admin database"
    );
    assert.ok(
        serverSection.includes("REDIS_PASSWORD"),
        "Server must receive REDIS_PASSWORD"
    );
    console.log("  [PASS] API server container does not mount /var/run/docker.sock; auth credentials wired");

    // 1D. Verify test-worker is the isolated runner
    const testWorkerSection = composeContent.split(/[\r\n]+  test-worker:[\r\n]+/)[1]?.split(/[\r\n]+  client:[\r\n]+/)[0];
    assert.ok(testWorkerSection, "test-worker service must exist");
    assert.ok(
        testWorkerSection.match(/-\s+[\/\\]var[\/\\]run[\/\\]docker\.sock/),
        "test-worker is the designated runner mounting docker.sock"
    );
    assert.ok(
        testWorkerSection.includes("REDIS_PASSWORD"),
        "test-worker must authenticate with Redis"
    );
    console.log("  [PASS] Isolated test-worker runner designated for Docker sandbox tasks");

    // -------------------------------------------------------------
    // Test 2: server/Dockerfile Non-Root User Execution
    // -------------------------------------------------------------
    console.log("\n--- 2. Inspecting server/Dockerfile Non-Root User Specification ---");
    assert.ok(fs.existsSync(serverDockerfilePath), "server/Dockerfile must exist");
    const serverDockerContent = fs.readFileSync(serverDockerfilePath, "utf8");

    assert.ok(
        serverDockerContent.includes("USER node"),
        "server/Dockerfile must specify 'USER node' (unprivileged UID 1000)"
    );
    assert.ok(
        serverDockerContent.includes("chown -R node:node /app"),
        "server/Dockerfile must ensure /app ownership is assigned to node user"
    );
    console.log("  [PASS] server/Dockerfile configures 'USER node' (whoami will return 'node', not 'root')");

    // -------------------------------------------------------------
    // Test 3: Redis Client Authentication Logic
    // -------------------------------------------------------------
    console.log("\n--- 3. Testing Redis Client Authentication Configuration ---");
    process.env.REDIS_PASSWORD = "test_password_for_verification_12345";
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_PORT = "6379";

    const redisModule = await import("./src/config/redis.js");
    const client = redisModule.redisConnection;
    assert.ok(client, "redisConnection must be created");
    assert.strictEqual(
        client.options.password,
        "test_password_for_verification_12345",
        "Redis client must receive password from REDIS_PASSWORD environment variable"
    );
    console.log("  [PASS] Redis client properly wires REDIS_PASSWORD into connection options");

    // -------------------------------------------------------------
    // Test 4: README Docker Socket Warning Verification
    // -------------------------------------------------------------
    console.log("\n--- 4. Inspecting README.md Security Architecture Documentation ---");
    assert.ok(fs.existsSync(readmePath), "README.md must exist");
    const readmeContent = fs.readFileSync(readmePath, "utf8");

    assert.ok(
        readmeContent.includes("Security Architecture & Infrastructure Hardening"),
        "README must contain Security Architecture section"
    );
    assert.ok(
        readmeContent.includes("docker.sock"),
        "README must document /var/run/docker.sock isolation and warning"
    );
    assert.ok(
        readmeContent.includes("devpilot-test-worker"),
        "README must mention test-worker isolation"
    );
    assert.ok(
        readmeContent.includes("USER node"),
        "README must document unprivileged node execution"
    );
    console.log("  [PASS] README.md documents Docker socket warning and infrastructure hardening");

    console.log("\n=======================================================");
    console.log("ALL TASK 8 DOCKER & INFRASTRUCTURE TESTS PASSED (100%)!");
    console.log("=======================================================\n");
}

runTests().catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
