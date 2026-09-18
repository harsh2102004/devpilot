/**
 * ============================================================================
 * LEARNING NOTES & MISTAKES BREAKDOWN (FOR REVIEW):
 * 
 * 1. Import Paths & Named Exports:
 *    - Mistake: `import asyncHandler from "../middleware/asyncHandler.js"`
 *      -> asyncHandler is inside `../utils/asyncHandler.js`, not middleware.
 *    - Mistake: `import ApiError from "../utils/ApiError.js"`
 *      -> ApiError and ApiResponse are named exports, so they must use `{ ApiError }` and `{ ApiResponse }`.
 * 
 * 2. ApiResponse Constructor Argument Order:
 *    - Mistake: `new ApiResponse(201, "message", project)`
 *      -> The class constructor is `constructor(statusCode, data, message)`.
 *      -> Putting the string second stores the string inside `response.data`!
 *      -> Correct: `new ApiResponse(201, project, "Project created successfully")`.
 * 
 * 3. Required Fields vs Optional Fields:
 *    - In createProject: `if (!name || !description || !repoUrl.trim())`
 *      -> In DevPilot, a project can be created before connecting a GitHub repo.
 *      -> Only `name` is strictly required; `description`, `repoUrl`, `repoBranch` are optional.
 * 
 * 4. findByIdAndDelete vs findOneAndDelete:
 *    - Mistake: `Project.findOneAndDelete(projectId)`
 *      -> `findOneAndDelete` requires a query filter `{ _id: projectId }`.
 *      -> `findByIdAndDelete(projectId)` takes the string ID directly.
 * 
 * 5. Complete Exports:
 *    - Mistake: Omitting `deleteProject` and `updateProject` from the export list.
 * ============================================================================
 */

import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";

// 1. Create a new project (Only name is mandatory)
const createProject = asyncHandler(async (req, res) => {
    const { name, description, repoUrl, repoBranch } = req.body;

    if (!name || !name.trim()) {
        throw new ApiError(400, "Project name is required");
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
        repoBranch: repoBranch || "main",
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

// 3. Get single project by ID (with 403 ownership enforcement)
const getProjectById = asyncHandler(async (req, res) => {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to view this project");
    }

    return res.status(200).json(
        new ApiResponse(200, project, "Project fetched successfully")
    );
});

// 4. Update a project (with 403 ownership enforcement)
const updateProject = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const { name, description, repoUrl, repoBranch, status } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to update this project");
    }

    if (name) project.name = name.trim();
    if (description !== undefined) project.description = description.trim();
    if (repoUrl !== undefined) project.repoUrl = repoUrl.trim();
    if (repoBranch) project.repoBranch = repoBranch;
    if (status) project.status = status;

    await project.save();

    return res.status(200).json(
        new ApiResponse(200, project, "Project updated successfully")
    );
});

// 5. Delete a project (with 403 ownership enforcement)
const deleteProject = asyncHandler(async (req, res) => {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to delete this project");
    }

    await Project.findByIdAndDelete(projectId);

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