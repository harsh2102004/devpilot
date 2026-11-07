import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";
import { validateRepoUrl, validateRepoBranch } from "../services/repoCloner.service.js";

// 1. Create a new project (Only name is mandatory)
const createProject = asyncHandler(async (req, res) => {
    const { name, description, repoUrl, repoBranch } = req.body;

    if (!name || !name.trim()) {
        throw new ApiError(400, "Project name is required");
    }

    // Validate repoUrl and repoBranch if supplied before database operations (Task 3)
    if (repoUrl && typeof repoUrl === "string" && repoUrl.trim()) {
        validateRepoUrl(repoUrl.trim());
    }
    if (repoBranch && typeof repoBranch === "string" && repoBranch.trim()) {
        validateRepoBranch(repoBranch.trim());
    }

    const existingProject = await Project.findOne({
        name: name.trim(),
        owner: req.user._id
    });

    if (existingProject) {
        throw new ApiError(400, "You already have a project with this name");
    }

    const project = await Project.create({
        name: name.trim(),
        description: description?.trim() || "",
        repoUrl: repoUrl?.trim() || "",
        repoBranch: repoBranch?.trim() || "main",
        owner: req.user._id
    });

    return res.status(201).json(
        new ApiResponse(201, project, "Project created successfully")
    );
});

// 2. Get all projects owned by the logged-in user
const getUserProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ owner: req.user._id }).sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, projects, "Projects fetched successfully")
    );
});

// 3. Get single project by ID (scoped by owner in query, returns 404 if not found or not yours)
const getProjectById = asyncHandler(async (req, res) => {
    const projectId = req.params.projectId || req.params.id;

    const project = await Project.findOne({
        _id: projectId,
        owner: req.user._id
    });

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    return res.status(200).json(
        new ApiResponse(200, project, "Project fetched successfully")
    );
});

// 4. Update a project (status excluded: server state cannot be manipulated by client; scoped by owner)
const updateProject = asyncHandler(async (req, res) => {
    const projectId = req.params.projectId || req.params.id;
    // Task 6: Remove status from req.body to stop client from controlling server state
    const { name, description, repoUrl, repoBranch } = req.body;

    const project = await Project.findOne({
        _id: projectId,
        owner: req.user._id
    });

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    // Validate repoUrl and repoBranch if updated (Task 3)
    if (repoUrl !== undefined && repoUrl !== null && repoUrl.trim() !== "") {
        validateRepoUrl(repoUrl.trim());
    }
    if (repoBranch !== undefined && repoBranch !== null && repoBranch.trim() !== "") {
        validateRepoBranch(repoBranch.trim());
    }

    if (name) project.name = name.trim();
    if (description !== undefined) project.description = description.trim();
    if (repoUrl !== undefined) project.repoUrl = repoUrl.trim();
    if (repoBranch) project.repoBranch = repoBranch.trim();
    // Do NOT allow req.body.status to alter project.status (only workers update status)

    await project.save();

    return res.status(200).json(
        new ApiResponse(200, project, "Project updated successfully")
    );
});

// 5. Delete a project (scoped by owner in query, returns 404 if not found or not yours)
const deleteProject = asyncHandler(async (req, res) => {
    const projectId = req.params.projectId || req.params.id;

    const project = await Project.findOneAndDelete({
        _id: projectId,
        owner: req.user._id
    });

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Project deleted successfully")
    );
});

export {
    createProject,
    getUserProjects,
    getProjectById,
    updateProject,
    deleteProject
};