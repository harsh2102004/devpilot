import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";
import { User } from "../models/User.js";
import { Job } from "../models/job.js";
import { TestRun } from "../models/testRun.js";
import { addTestJob } from "../queues/test.queue.js";
import { executeAutonomousVerificationLoop } from "../services/verificationLoop.service.js";
import { prepareRepoDirectory, cleanupRepoDirectory } from "../services/repoCloner.service.js";
import { createAutomatedPullRequest } from "../services/githubPr.service.js";

/**
 * Trigger an asynchronous sandboxed test execution
 * POST /api/test/:projectId/run
 */
export const runProjectTests = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const { testCommand, timeoutMs = 60000, preferDocker = true, readOnly = false } = req.body || {};

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to execute tests on this project");
    }

    if (!project.repoUrl) {
        throw new ApiError(400, "Repository URL is required on the project to execute tests");
    }

    // Check if a test is already running or queued
    const activeTest = await TestRun.findOne({
        projectId,
        status: { $in: ["queued", "running"] },
    });

    if (activeTest) {
        throw new ApiError(409, "A test run is already queued or currently running for this project");
    }

    // 1. Create TestRun record in MongoDB
    const testRun = await TestRun.create({
        projectId,
        userId: req.user._id,
        trigger: "manual",
        status: "queued",
        testCommand: testCommand || "",
        environment: preferDocker ? "docker" : "local-process",
    });

    // 2. Create Job lifecycle record in MongoDB
    const job = await Job.create({
        projectId,
        userId: req.user._id,
        type: "test-run",
        status: "queued",
        progress: 0,
        logs: [{ level: "info", message: "Test run queued in sandbox pipeline" }],
    });

    // 3. Dispatch to BullMQ test queue
    const bullJob = await addTestJob({
        projectId: project._id,
        userId: req.user._id,
        repoUrl: project.repoUrl,
        repoBranch: project.repoBranch || "main",
        testRunId: testRun._id,
        jobRecordId: job._id,
        testCommand,
        timeoutMs,
        preferDocker,
        readOnly,
    });

    testRun.jobId = bullJob.id;
    testRun.jobRecordId = job._id;
    await testRun.save();

    job.bullJobId = bullJob.id;
    await job.save();

    return res.status(202).json(
        new ApiResponse(
            202,
            {
                testRunId: testRun._id,
                jobId: bullJob.id,
                status: "queued",
            },
            "Test run enqueued successfully"
        )
    );
});

/**
 * Get historical test runs for a project (summary list without heavy logs)
 * GET /api/test/:projectId/runs
 */
export const getProjectTestRuns = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view tests for this project");
    }

    const totalRuns = await TestRun.countDocuments({ projectId });
    const runs = await TestRun.find({ projectId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-rawOutput");

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                runs,
                pagination: {
                    page,
                    limit,
                    totalRuns,
                    totalPages: Math.ceil(totalRuns / limit) || 1,
                },
            },
            "Historical test runs retrieved successfully"
        )
    );
});

/**
 * Get detailed test run report (with parsed failures and terminal output)
 * GET /api/test/run/:runId
 */
export const getTestRunById = asyncHandler(async (req, res) => {
    const { runId } = req.params;

    const testRun = await TestRun.findById(runId);
    if (!testRun) {
        throw new ApiError(404, "Test run record not found");
    }

    // Ownership check
    if (testRun.userId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view this test run");
    }

    return res.status(200).json(
        new ApiResponse(200, testRun, "Test run details retrieved successfully")
    );
});

/**
 * Delete a test run record
 * DELETE /api/test/run/:runId
 */
export const deleteTestRun = asyncHandler(async (req, res) => {
    const { runId } = req.params;

    const testRun = await TestRun.findById(runId);
    if (!testRun) {
        throw new ApiError(404, "Test run record not found");
    }

    if (testRun.userId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to delete this test run");
    }

    await TestRun.findByIdAndDelete(runId);

    return res.status(200).json(
        new ApiResponse(200, { deletedId: runId }, "Test run deleted successfully")
    );
});

/**
 * Run autonomous AI debugging and sandbox verification loop on a test failure
 * POST /api/test/:projectId/verify-fix
 */
export const verifyAutonomousFix = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const {
        testRunId,
        failureIndex = 0,
        customFailure = null,
        maxAttempts = 3,
        preferDocker = false,
        timeoutMs = 60000,
    } = req.body || {};

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to trigger fixes on this project");
    }

    // Resolve failure evidence
    let failureEvidence = customFailure;
    if (!failureEvidence && testRunId) {
        const testRun = await TestRun.findById(testRunId);
        if (testRun && testRun.failures && testRun.failures.length > failureIndex) {
            failureEvidence = testRun.failures[failureIndex];
        }
    }

    if (!failureEvidence) {
        throw new ApiError(400, "Failure evidence or valid testRunId with parsed failures is required");
    }

    // Resolve repository directory
    const repoInfo = await prepareRepoDirectory({
        repoUrl: project.repoUrl,
        repoBranch: project.repoBranch || "main",
    });

    try {
        const verificationReport = await executeAutonomousVerificationLoop({
            projectId: project._id,
            projectName: project.name,
            repoDir: repoInfo.repoDir,
            failure: failureEvidence,
            maxAttempts,
            preferDocker,
            timeoutMs,
        });

        // If verification passed, create an 'ai-debug' TestRun record in MongoDB documenting the verified fix
        if (verificationReport.verified && verificationReport.finalTestResult) {
            await TestRun.create({
                projectId: project._id,
                userId: req.user._id,
                trigger: "ai-debug",
                status: "passed",
                environment: verificationReport.finalTestResult.environment || "local-process",
                testCommand: project.testCommand || "",
                summary: verificationReport.finalTestResult.summary,
                rawOutput: verificationReport.finalTestResult.rawOutput,
            });
        }

        return res.status(200).json(
            new ApiResponse(
                200,
                verificationReport,
                verificationReport.verified
                    ? "Autonomous fix successfully synthesized and verified in sandbox!"
                    : "Autonomous verification loop completed without full pass"
            )
        );
    } finally {
        if (repoInfo.isTemp) {
            await cleanupRepoDirectory(repoInfo.repoDir);
        }
    }
});

/**
 * Automate branch creation, fix commit, and GitHub Pull Request opening
 * POST /api/test/:projectId/create-pr
 */
export const createPullRequestForFix = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const {
        filePath,
        modifiedContent,
        patch = null,
        failure = null,
        verificationReport = null,
        branchName = null,
        customTitle = null,
        customBody = null,
    } = req.body || {};

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to create pull requests for this project");
    }

    if (!project.repoUrl) {
        throw new ApiError(400, "Project does not have a connected GitHub repository URL");
    }

    // Retrieve user's GitHub access token from DB
    const userWithToken = await User.findById(req.user._id).select("+githubAccessToken");
    const token =
        userWithToken?.githubAccessToken ||
        process.env.GITHUB_TOKEN ||
        process.env.GITHUB_ACCESS_TOKEN ||
        null;

    const prResult = await createAutomatedPullRequest({
        token,
        repoUrl: project.repoUrl,
        baseBranch: project.repoBranch || "main",
        branchName,
        filePath,
        modifiedContent,
        patch,
        failure,
        verificationReport,
        customTitle,
        customBody,
        mock: !token,
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            prResult,
            prResult.mock
                ? "Simulated Pull Request generated successfully (Connect live GitHub token to publish directly to GitHub)"
                : `GitHub Pull Request #${prResult.prNumber} opened successfully!`
        )
    );
});

export default {
    runProjectTests,
    getProjectTestRuns,
    getTestRunById,
    deleteTestRun,
    verifyAutonomousFix,
    createPullRequestForFix,
};
