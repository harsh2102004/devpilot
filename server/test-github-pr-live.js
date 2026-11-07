/**
 * DevPilot GitHub Pull Request Automation Live Test Suite (Sub-Phase 9E)
 *
 * Verifies:
 * 1. GitHub Repository URL parsing across HTTPS, SSH, and shorthand formats
 * 2. Git branch name generation and sanitization
 * 3. PR Markdown body generation with failure diagnostics, root cause, and sandbox proof table
 * 4. End-to-end automated PR creation pipeline (branch, commit, PR metadata)
 * 5. REST API endpoint registration (POST /api/test/:projectId/create-pr)
 */

import {
    parseGitHubRepoUrl,
    formatBranchName,
    generatePrDescription,
    createAutomatedPullRequest,
} from "./src/services/githubPr.service.js";
import testRoutes from "./src/routes/test.routes.js";

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
    console.log("  DevPilot GitHub Pull Request Automation (Sub-Phase 9E Live Test)");
    console.log("=================================================================\n");

    // -------------------------------------------------------------
    // Group 1: GitHub URL Parsing
    // -------------------------------------------------------------
    console.log("--- Group 1: GitHub URL Parsing ---");

    const repo1 = parseGitHubRepoUrl("https://github.com/octocat/Hello-World.git");
    assert(repo1.owner === "octocat" && repo1.repo === "Hello-World", "Parses HTTPS with .git extension");

    const repo2 = parseGitHubRepoUrl("https://github.com/facebook/react");
    assert(repo2.owner === "facebook" && repo2.repo === "react", "Parses HTTPS without .git extension");

    const repo3 = parseGitHubRepoUrl("git@github.com:torvalds/linux.git");
    assert(repo3.owner === "torvalds" && repo3.repo === "linux", "Parses SSH URL format");

    const repo4 = parseGitHubRepoUrl("google-deepmind/antigravity");
    assert(repo4.owner === "google-deepmind" && repo4.repo === "antigravity", "Parses shorthand 'owner/repo'");

    let invalidRejected = false;
    try {
        parseGitHubRepoUrl("not-a-valid-url");
    } catch {
        invalidRejected = true;
    }
    assert(invalidRejected, "Rejects malformed repository URL with ApiError");

    // -------------------------------------------------------------
    // Group 2: Git Branch Name Sanitization
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Git Branch Name Sanitization ---");

    const branch1 = formatBranchName({ filePath: "src/controllers/auth.controller.js" });
    assert(branch1.startsWith("devpilot/fix-auth-controller-"), "Branch name prefixed with devpilot/fix-<slug>");
    assert(!branch1.includes("."), "Branch name stripped file extensions");

    const branch2 = formatBranchName({
        customName: "devpilot/fix:illegal~characters?and*brackets..name",
    });
    assert(!branch2.includes(":") && !branch2.includes("~") && !branch2.includes("?"), "Sanitizes invalid Git reference characters");

    // -------------------------------------------------------------
    // Group 3: PR Markdown Summary Generation
    // -------------------------------------------------------------
    console.log("\n--- Group 3: PR Markdown Summary Generation ---");

    const failureEvidence = {
        testTitle: "should return 401 for unauthorized requests",
        suiteName: "Authentication Suite",
        filePath: "src/controllers/auth.controller.js",
        line: 12,
        errorName: "AssertionError",
        errorMessage: "Expected 401 but received 200",
        stackTrace: "AssertionError: Expected 401 but received 200\n    at Context.<anonymous> (test/auth.js:12:8)",
    };

    const patchEvidence = {
        explanation: "Correct HTTP status code from 200 to 401 to satisfy test assertion",
        unifiedDiff: [
            "--- a/src/controllers/auth.controller.js",
            "+++ b/src/controllers/auth.controller.js",
            "@@ -10,3 +10,3 @@",
            "-return res.status(200);",
            "+return res.status(401);",
        ].join("\n"),
    };

    const verificationReport = {
        attemptsCount: 1,
        finalTestResult: {
            environment: "docker",
            summary: {
                total: 8,
                passed: 8,
                failed: 0,
            },
        },
    };

    const prDescription = generatePrDescription({
        projectName: "DevPilot-Demo",
        filePath: "src/controllers/auth.controller.js",
        failure: failureEvidence,
        diagnosticReport: "Logic branch returns HTTP 200 instead of HTTP 401 on missing token.",
        patch: patchEvidence,
        verificationReport,
    });

    assert(prDescription.includes("# 🤖 DevPilot Autonomous Bugfix Pull Request"), "Includes standard DevPilot PR title");
    assert(prDescription.includes("Authentication Suite"), "Includes test suite name");
    assert(prDescription.includes("Expected 401 but received 200"), "Includes test failure error message");
    assert(prDescription.includes("src/controllers/auth.controller.js"), "Includes culprit file path");
    assert(prDescription.includes("```diff"), "Includes fenced unified diff codeblock");
    assert(prDescription.includes("## 🧪 Sandbox Test Verification Proof"), "Includes Sandbox Test Verification Proof section");
    assert(prDescription.includes("**8** / 8"), "Proof table lists 8/8 tests passing");
    assert(prDescription.includes("`@babel/parser` validated"), "Proof table documents AST syntax validation");
    assert(prDescription.includes("Attempt **1** of 3"), "Proof table documents iteration metric");

    // -------------------------------------------------------------
    // Group 4: Master Automated Pull Request Pipeline
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Master Automated PR Pipeline ---");

    const prResult = await createAutomatedPullRequest({
        token: "mock-github-token",
        repoUrl: "https://github.com/devpilot-ai/demo-repo",
        baseBranch: "main",
        filePath: "src/controllers/auth.controller.js",
        modifiedContent: "export function auth() { return 401; }",
        patch: patchEvidence,
        failure: failureEvidence,
        verificationReport,
        mock: true,
    });

    assert(prResult.success === true, "Automated PR pipeline completed successfully");
    assert(prResult.owner === "devpilot-ai", "Owner extracted correctly");
    assert(prResult.repo === "demo-repo", "Repo name extracted correctly");
    assert(Boolean(prResult.prNumber), "Assigned PR number");
    assert(prResult.prUrl.includes("https://github.com/devpilot-ai/demo-repo/pull/"), "Generated standard GitHub PR URL");
    assert(prResult.headBranch.startsWith("devpilot/fix-"), "Head branch formatted properly");
    assert(prResult.baseBranch === "main", "Target base branch set to main");
    assert(prResult.state === "open", "PR state marked as open");
    assert(Boolean(prResult.commitSha), "Commit SHA generated and attached");

    // -------------------------------------------------------------
    // Group 5: REST API Route Mounting
    // -------------------------------------------------------------
    console.log("\n--- Group 5: REST API Route Mounting ---");

    const registeredRoutes = testRoutes.stack
        .filter((layer) => layer.route)
        .map((layer) => ({
            path: layer.route.path,
            method: Object.keys(layer.route.methods)[0].toUpperCase(),
        }));

    const createPrRoute = registeredRoutes.find(
        (r) => r.path === "/:projectId/create-pr" && r.method === "POST"
    );
    assert(Boolean(createPrRoute), "POST /api/test/:projectId/create-pr route mounted in test.routes.js");

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
