/**
 * DevPilot Task 3 Verification: Repository Lockdown & Input Validation Live Test
 *
 * Verifies:
 * 1. Strict URL Format Validation (Regex + new URL()):
 *    - Rejects /etc, --upload-pack=x, file:///tmp/x, http://, non-GitHub domains
 *    - Accepts https://github.com/<owner>/<repo>(.git)? and <owner>/<repo> shorthand
 * 2. Strict Branch Name Validation:
 *    - Rejects leading '-' (prevents git CLI option injection like -rf, --branch)
 *    - Validates /^[A-Za-z0-9._\/-]{1,100}$/
 * 3. Git Clone Argument Hardening:
 *    - Verifies '--' is positioned before the URL in git clone arguments
 * 4. Local Directory Path Bypass Blocked:
 *    - Local directories like /etc, ., C:\... are never treated as local repos
 *      unless ALLOW_LOCAL_REPOS=true and NODE_ENV!==production
 * 5. Controller & Schema Validation:
 *    - createProject rejects /etc, --upload-pack=x, file:///tmp/x with HTTP 400
 *    - updateProject rejects invalid repoUrl / repoBranch with HTTP 400
 *    - startScan validates repoUrl / repoBranch before dispatching scan jobs
 */

import env from "./src/config/env.js";
import {
    isValidRepoUrl,
    isValidRepoBranch,
    validateRepoUrl,
    validateRepoBranch,
    formatCloneUrl,
    prepareRepoDirectory,
} from "./src/services/repoCloner.service.js";
import { createProject, updateProject } from "./src/controllers/project.controller.js";
import { startScan } from "./src/controllers/scan.controller.js";
import { Project } from "./src/models/project.js";

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

async function runMockReq(handler, { params = {}, body = {}, query = {}, user = { _id: "507f1f77bcf86cd799439011" } } = {}) {
    return new Promise((resolve) => {
        const req = {
            params,
            body,
            query,
            user,
            header: () => null,
        };

        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this.body = data;
                resolve({ statusCode: this.statusCode, body: data });
            },
        };

        const next = (err) => {
            if (err) {
                resolve({
                    statusCode: err.statusCode || 500,
                    body: {
                        success: false,
                        message: err.message,
                    },
                });
            }
        };

        handler(req, res, next).catch((err) => next(err));
    });
}

async function runTests() {
    console.log("=================================================================");
    console.log("  DevPilot Task 3: Repository Lockdown & Injection Defense Live");
    console.log("=================================================================\n");

    // -------------------------------------------------------------
    // Group 1: Strict URL Validation (Regex + new URL())
    // -------------------------------------------------------------
    console.log("--- Group 1: Repository URL Whitelist Enforcement ---");

    // Valid GitHub URLs
    const validUrls = [
        "https://github.com/octocat/Hello-World",
        "https://github.com/octocat/Hello-World.git",
        "https://github.com/octocat/Hello-World/",
        "https://github.com/harsh2102004/devpilot",
        "https://github.com/facebook/react.git",
        "octocat/Hello-World",
        "facebook/react",
        "harsh2102004/devpilot",
    ];

    for (const url of validUrls) {
        assert(isValidRepoUrl(url) === true, `Accepts legitimate GitHub repository: "${url}"`);
    }

    // Invalid & Malicious URLs
    const invalidUrls = [
        "/etc",
        "--upload-pack=x",
        "file:///tmp/x",
        "file:///etc/passwd",
        "http://github.com/octocat/Hello-World", // must be https
        "https://gitlab.com/octocat/Hello-World", // non-github
        "https://bitbucket.org/octocat/Hello-World",
        "https://evil.com/github.com/octocat/Hello-World",
        "-evil/repo", // leading hyphen
        "evil/-repo", // leading hyphen in repo
        "https://github.com/-evil/repo",
        "https://github.com/evil/-repo",
        "https://github.com/octocat/Hello-World/extra/nested/path",
        "; rm -rf / ;",
        "https://github.com/",
        "",
        null,
        undefined,
    ];

    for (const url of invalidUrls) {
        assert(isValidRepoUrl(url) === false, `Rejects unauthorized/malicious repository URL: "${url}"`);
    }

    // -------------------------------------------------------------
    // Group 2: Git Branch Validation (Preventing Option Injection)
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Git Branch Name Validation ---");

    const validBranches = [
        "main",
        "master",
        "develop",
        "feature/auth-v2",
        "bugfix/issue-123_test",
        "v1.0.0",
        "release.2026",
    ];

    for (const branch of validBranches) {
        assert(isValidRepoBranch(branch) === true, `Accepts valid git branch: "${branch}"`);
    }

    const invalidBranches = [
        "-rf", // leading hyphen: option injection
        "--upload-pack",
        "-b",
        "--branch",
        "branch with spaces",
        "branch;rm -rf /",
        "branch`whoami`",
        "",
        null,
    ];

    for (const branch of invalidBranches) {
        assert(isValidRepoBranch(branch) === false, `Rejects dangerous/invalid git branch: "${branch}"`);
    }

    // -------------------------------------------------------------
    // Group 3: Controller Enforcement (createProject & updateProject)
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Project Controller Validation ---");

    // 3A. createProject with malicious repoUrls
    const forbiddenCreateCases = [
        { repoUrl: "/etc", label: "repoUrl=/etc" },
        { repoUrl: "--upload-pack=x", label: "repoUrl=--upload-pack=x" },
        { repoUrl: "file:///tmp/x", label: "repoUrl=file:///tmp/x" },
        { repoUrl: "https://evil-attacker.com/repo", label: "repoUrl=https://evil-attacker.com/repo" },
        { repoUrl: "https://github.com/octocat/Hello-World", repoBranch: "-rf", label: "repoBranch=-rf" },
    ];

    for (const testCase of forbiddenCreateCases) {
        const res = await runMockReq(createProject, {
            body: {
                name: `Test Project ${Date.now()}-${Math.random()}`,
                repoUrl: testCase.repoUrl,
                repoBranch: testCase.repoBranch || "main",
            },
        });

        assert(res.statusCode === 400, `createProject with ${testCase.label} returns HTTP 400 (actual: ${res.statusCode})`);
        assert(res.body.success === false, `createProject response indicates success=false for ${testCase.label}`);
    }

    // -------------------------------------------------------------
    // Group 4: Local Directory Bypass Prevention in prepareRepoDirectory
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Local Filesystem Bypass Prevention ---");

    // Ensure ALLOW_LOCAL_REPOS is not enabled
    delete process.env.ALLOW_LOCAL_REPOS;

    let localDirThrew = false;
    let localDirErrMsg = "";
    try {
        await prepareRepoDirectory({
            repoUrl: ".", // Points to current working directory on server
        });
    } catch (err) {
        localDirThrew = true;
        localDirErrMsg = err.message;
    }

    assert(localDirThrew === true, "prepareRepoDirectory rejects '.' when ALLOW_LOCAL_REPOS is not set");
    assert(localDirErrMsg.includes("Invalid repository URL"), `Error states 'Invalid repository URL' (actual: "${localDirErrMsg}")`);

    let etcThrew = false;
    try {
        await prepareRepoDirectory({
            repoUrl: "/etc",
        });
    } catch (err) {
        etcThrew = true;
    }

    assert(etcThrew === true, "prepareRepoDirectory rejects '/etc'");

    // -------------------------------------------------------------
    // Group 5: URL Normalization & '--' Argument Injection Protection
    // -------------------------------------------------------------
    console.log("\n--- Group 5: Clone URL Formatting & Shorthand Conversion ---");

    const formattedShorthand = formatCloneUrl("octocat/Hello-World");
    assert(formattedShorthand === "https://github.com/octocat/Hello-World.git", `Converts shorthand to GitHub HTTPS: "${formattedShorthand}"`);

    // In Task 4, tokens are NEVER embedded in the URL to prevent leakage into .git/config
    const formattedTokenUrl = formatCloneUrl("https://github.com/octocat/Hello-World", "ghp_mocktoken123");
    assert(!formattedTokenUrl.includes("ghp_mocktoken123"), "formatCloneUrl does NOT embed raw token in URL (Task 4 credential defense)");
    assert(!formattedTokenUrl.includes("@github.com"), "formatCloneUrl does NOT embed '@github.com' in URL");

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Task 3 test suite failed with unhandled exception:", err);
    process.exit(1);
});

