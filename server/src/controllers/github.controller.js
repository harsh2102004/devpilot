import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import User from "../models/User.js";
import Project from "../models/project.js";
import {
    verifyGitHubToken,
    fetchUserRepositories,
    fetchRepositoryBranches
} from "../services/github.service.js";

// 1. Connect & Save GitHub Token
// POST /api/github/connect
export const connectGitHub = asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token || !token.trim()) {
        throw new ApiError(400, "GitHub Personal Access Token is required");
    }

    // Direct service call - any Octokit 401/403/500 is caught automatically by asyncHandler
    const githubUser = await verifyGitHubToken(token);

    // Save token and username to User model (selecting +githubAccessToken)
    const user = await User.findById(req.user._id).select("+githubAccessToken");
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    user.githubAccessToken = token.trim();
    user.githubUsername = githubUser.username;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                githubUsername: githubUser.username,
                avatarUrl: githubUser.avatarUrl,
                name: githubUser.name
            },
            "GitHub account successfully connected"
        )
    );
});

/**
 * 2. Get GitHub Connection Status
 * GET /api/github/status
 */
export const getGitHubStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select("+githubAccessToken");
    if(!user){
        throw new ApiError(404, "User not found");
    }   

    const isConnected = Boolean(user?.githubAccessToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                isConnected,
                githubUsername: user?.githubUsername || ""
            },
            "GitHub status fetched successfully"
        )
    );
});

/**
 * 3. Fetch User Repositories
 * GET /api/github/repos
 */
export const getUserRepositories = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select("+githubAccessToken");

    if (!user || !user.githubAccessToken) {
        throw new ApiError(400, "GitHub account is not connected. Please connect your GitHub account first.");
    }

    const repositories = await fetchUserRepositories(user.githubAccessToken);

    return res.status(200).json(
        new ApiResponse(200, repositories, "GitHub repositories fetched successfully")
    );
});

/**
 * 4. Fetch Branches for a Specific Repository
 * GET /api/github/repos/:owner/:repo/branches
 */
export const getRepoBranches = asyncHandler(async (req, res) => {
    const { owner, repo } = req.params;
    const user = await User.findById(req.user._id).select("+githubAccessToken");

    if (!user?.githubAccessToken) {
        throw new ApiError(400, "GitHub account is not connected");
    }

    const branches = await fetchRepositoryBranches(user.githubAccessToken, owner, repo);

    return res.status(200).json(
        new ApiResponse(200, branches, "Branches fetched successfully")
    );
});

/**
 * 5. Link a GitHub Repository to an existing DevPilot Project
 * POST /api/projects/:projectId/link-repo
 */
export const linkRepoToProject = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const { repoUrl, repoBranch } = req.body;

    if (!repoUrl) {
        throw new ApiError(400, "Repository URL is required");
    }

    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    // Enforce 403 ownership check
    if (project.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You do not have permission to modify this project");
    }

    project.repoUrl = repoUrl.trim();
    if (repoBranch) project.repoBranch = repoBranch.trim();
    project.status = "connected"; // State machine transition: disconnected -> connected
    await project.save();

    return res.status(200).json(
        new ApiResponse(200, project, "GitHub repository linked successfully")
    );
});
