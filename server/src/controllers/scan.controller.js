import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";
import { Job } from "../models/job.js";
import { CodeGraph } from "../models/codeGraph.js";
import { addScanJob } from "../queues/scan.queue.js";
import { searchCodebase } from "../services/vectorDb.service.js";
import { validateRepoUrl, validateRepoBranch } from "../services/repoCloner.service.js";

// Start repository scan
const startScan = asyncHandler(async (req, res) => {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to scan this project");
    }

    const repoUrl = project.repoUrl;
    if (!repoUrl || !repoUrl.trim()) {
        throw new ApiError(400, "Repository url is required to scan the project");
    }

    // Validate repoUrl and repoBranch (Task 3)
    validateRepoUrl(repoUrl.trim());
    if (project.repoBranch) {
        validateRepoBranch(project.repoBranch.trim());
    }

    const activeScans = await Job.find({
        projectId: projectId,
        status: { $in: ["queued", "active"] }
    });

    if (activeScans.length > 0) {
        throw new ApiError(409, "A scan is already in progress for this project");
    }

    const job = await Job.create({
        projectId: projectId,
        userId: req.user._id,
        type: "scan",
        status: "queued",
        progress: 0,
        logs: [{ level: "info", message: "Scan job queued" }]
    });

    const bullJob = await addScanJob({
        projectId: project._id,
        userId: req.user._id,
        repoUrl: project.repoUrl,
        repoBranch: project.repoBranch || "main",
        jobRecordId: job._id
    });

    job.bullJobId = bullJob.id;
    await job.save();

    return res.status(202).json(
        new ApiResponse(202, job, "Scan job added to queue")
    );
});

// Polling status for a specific job
const getjobstatus = asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const job = await Job.findById(jobId);

    if (!job) {
        throw new ApiError(404, "Job not found");
    }

    if (job.userId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view this job");
    }

    return res.status(200).json(
        new ApiResponse(200, job, "Job fetched successfully")
    );
});

// Scan history for a specific project
const getprojectscanhistory = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view this project's scan history");
    }

    const jobs = await Job.find({ projectId: projectId }).sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, jobs, "Scan history fetched successfully")
    );
});

// Fetch latest code graph for a specific project
const getProjectCodeGraph = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view this project's code graph");
    }

    const codeGraph = await CodeGraph.findOne({ projectId: projectId });

    if (!codeGraph) {
        throw new ApiError(404, "No code graph found for this project. Please run a scan first.");
    }

    return res.status(200).json(
        new ApiResponse(200, codeGraph, "Code graph fetched successfully")
    );
});

// Semantic search within project codebase vectors
const searchProjectCode = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const { query, topK = 5, filter } = req.body;

    if (!query || typeof query !== "string" || !query.trim()) {
        throw new ApiError(400, "Search query is required");
    }

    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to search this project");
    }

    const limit = Math.min(Math.max(parseInt(topK, 10) || 5, 1), 20);
    const results = await searchCodebase({
        projectId: project._id.toString(),
        query: query.trim(),
        topK: limit,
        filter,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                projectId: project._id,
                query: query.trim(),
                totalMatches: results.length,
                matches: results,
            },
            "Semantic code search executed successfully"
        )
    );
});

export {
    startScan,
    getjobstatus,
    getprojectscanhistory,
    getProjectCodeGraph,
    searchProjectCode,
};

