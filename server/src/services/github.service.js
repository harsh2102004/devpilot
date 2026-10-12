import { Octokit } from "@octokit/rest";
import { ApiError } from "../utils/ApiError.js";

/**
 * Helper to initialize an authenticated Octokit client
 */
export const getOctokitClient = (token) => {
    if (!token || typeof token !== "string" || !token.trim()) {
        throw new ApiError(401, "GitHub access token is required");
    }

    return new Octokit({
        auth: token.trim(),
        userAgent: "DevPilot-Agent/1.0.0"
    });
};

/**
 * 1. Verify GitHub Token & Retrieve Authenticated User Profile
 */
export const verifyGitHubToken = async (token) => {
    const octokit = getOctokitClient(token);
    const { data } = await octokit.rest.users.getAuthenticated();

    return {
        username: data.login,
        id: data.id,
        avatarUrl: data.avatar_url,
        name: data.name || data.login,
        htmlUrl: data.html_url
    };
};

/**
 * 2. Fetch User Repositories (Public & Private)
 */
export const fetchUserRepositories = async (token) => {
    const octokit = getOctokitClient(token);

    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: 100,
        affiliation: "owner,collaborator,organization_member"
    });

    return data.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        repoUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || "main",
        isPrivate: repo.private,
        description: repo.description || "",
        language: repo.language || "Unknown",
        updatedAt: repo.updated_at
    }));
};

/**
 * 3. Fetch Repository Branches
 */
export const fetchRepositoryBranches = async (token, owner, repo) => {
    if (!owner || !repo) {
        throw new ApiError(400, "Repository owner and name are required");
    }

    const octokit = getOctokitClient(token);

    const { data } = await octokit.rest.repos.listBranches({
        owner,
        repo,
        per_page: 100
    });

    return data.map((branch) => ({
        name: branch.name,
        isProtected: branch.protected,
        commitSha: branch.commit?.sha
    }));
};
