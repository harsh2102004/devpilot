import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { app, request, generateTestToken } from "./testHelper.js";
import { initTestDb, closeTestDb } from "./testDb.js";
import { isValidRepoUrl, isValidRepoBranch, validateRepoUrl } from "../src/services/repoCloner.service.js";
import User from "../src/models/User.js";

describe("Task 9: Repository URL Lockdown & Injection Defense (Task 3)", () => {
    let testUser;
    let userToken;

    before(async () => {
        await initTestDb();
        const userId = new mongoose.Types.ObjectId();
        testUser = await User.create({
            _id: userId,
            fullName: "Repo Tester",
            username: `repotest_${Date.now()}`,
            email: `repotest_${Date.now()}@example.com`,
            password: "SecurePassword123",
        });
        userToken = generateTestToken(userId.toString(), { email: testUser.email });
    });

    after(async () => {
        await closeTestDb();
    });

    describe("Unit: isValidRepoUrl", () => {
        it("Accepts valid GitHub HTTPS URLs", () => {
            assert.strictEqual(isValidRepoUrl("https://github.com/torvalds/linux"), true);
            assert.strictEqual(isValidRepoUrl("https://github.com/facebook/react.git"), true);
            assert.strictEqual(isValidRepoUrl("https://github.com/owner-name/repo_name"), true);
        });

        it("Accepts valid shorthand owner/repo formats", () => {
            assert.strictEqual(isValidRepoUrl("torvalds/linux"), true);
            assert.strictEqual(isValidRepoUrl("facebook/react"), true);
            assert.strictEqual(isValidRepoUrl("owner-name/repo.git"), true);
        });

        it("Rejects non-HTTPS protocols (file://, ssh://, git://, http://)", () => {
            assert.strictEqual(isValidRepoUrl("file:///etc/passwd"), false);
            assert.strictEqual(isValidRepoUrl("ssh://git@github.com/user/repo"), false);
            assert.strictEqual(isValidRepoUrl("git://github.com/user/repo.git"), false);
            assert.strictEqual(isValidRepoUrl("http://github.com/user/repo"), false);
        });

        it("Rejects non-GitHub domains", () => {
            assert.strictEqual(isValidRepoUrl("https://gitlab.com/user/repo"), false);
            assert.strictEqual(isValidRepoUrl("https://bitbucket.org/user/repo"), false);
            assert.strictEqual(isValidRepoUrl("https://evil-attacker.com/repo"), false);
        });

        it("Rejects local filesystem paths and directory traversal", () => {
            assert.strictEqual(isValidRepoUrl("/etc/passwd"), false);
            assert.strictEqual(isValidRepoUrl("C:\\Windows\\System32"), false);
            assert.strictEqual(isValidRepoUrl("../../etc/shadow"), false);
        });

        it("Rejects CLI flag injection strings starting with '-'", () => {
            assert.strictEqual(isValidRepoUrl("--upload-pack=evil_cmd"), false);
            assert.strictEqual(isValidRepoUrl("-oProxyCommand=calc.exe"), false);
            assert.strictEqual(isValidRepoUrl("-rf"), false);
            assert.strictEqual(isValidRepoUrl("https://github.com/-flag/repo"), false);
        });

        it("Rejects empty, null, and non-string values", () => {
            assert.strictEqual(isValidRepoUrl(""), false);
            assert.strictEqual(isValidRepoUrl(null), false);
            assert.strictEqual(isValidRepoUrl(undefined), false);
            assert.strictEqual(isValidRepoUrl(12345), false);
            assert.strictEqual(isValidRepoUrl({}), false);
        });
    });

    describe("Unit: isValidRepoBranch", () => {
        it("Accepts valid git branch names", () => {
            assert.strictEqual(isValidRepoBranch("main"), true);
            assert.strictEqual(isValidRepoBranch("master"), true);
            assert.strictEqual(isValidRepoBranch("feature/auth-hardening-10b"), true);
            assert.strictEqual(isValidRepoBranch("v1.2.3"), true);
            assert.strictEqual(isValidRepoBranch("patch-1"), true);
        });

        it("Rejects branch names starting with '-' to prevent argument injection", () => {
            assert.strictEqual(isValidRepoBranch("--upload-pack=evil"), false);
            assert.strictEqual(isValidRepoBranch("-b"), false);
            assert.strictEqual(isValidRepoBranch("--all"), false);
        });

        it("Rejects empty, null, or excessively long branch names", () => {
            assert.strictEqual(isValidRepoBranch(""), false);
            assert.strictEqual(isValidRepoBranch(null), false);
            assert.strictEqual(isValidRepoBranch("a".repeat(101)), false);
        });
    });

    describe("Integration: Project Creation Repo URL Validation", () => {
        it("POST /api/projects rejects non-GitHub URL with HTTP 400", async () => {
            const res = await request(app)
                .post("/api/projects")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    name: "Gitlab Project",
                    repoUrl: "https://gitlab.com/attacker/malicious",
                    repoBranch: "main",
                });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.success, false);
            assert.ok(res.body.message.includes("Invalid repository URL"));
        });

        it("POST /api/projects rejects command injection flag in repoUrl with HTTP 400", async () => {
            const res = await request(app)
                .post("/api/projects")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    name: "Flag Injection Project",
                    repoUrl: "--upload-pack=/bin/sh",
                    repoBranch: "main",
                });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.success, false);
        });

        it("POST /api/projects rejects flag injection in repoBranch with HTTP 400", async () => {
            const res = await request(app)
                .post("/api/projects")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    name: "Branch Injection Project",
                    repoUrl: "https://github.com/legit/repo",
                    repoBranch: "--all",
                });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.success, false);
            assert.ok(res.body.message.includes("Invalid repository branch"));
        });

        it("POST /api/projects accepts valid GitHub URL and branch", async () => {
            const res = await request(app)
                .post("/api/projects")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    name: "Legitimate Repo Project",
                    repoUrl: "https://github.com/expressjs/express",
                    repoBranch: "master",
                });

            assert.strictEqual(res.status, 201);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.data.name, "Legitimate Repo Project");
        });
    });
});
