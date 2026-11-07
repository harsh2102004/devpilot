import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";
import { Job } from "../models/job.js";
import { TestRun } from "../models/testRun.js";
import { addTestJob } from "../queues/test.queue.js";

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

export default {
    runProjectTests,
    getProjectTestRuns,
    getTestRunById,
    deleteTestRun,
};
