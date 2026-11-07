import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { ApiError } from "../utils/ApiError.js";

const execFileAsync = promisify(execFile);

/**
 * Validates repository URL against strict GitHub repository formats.
 * Accepts:
 *  - Full HTTPS URL: https://github.com/<owner>/<repo> (with optional .git and trailing slash)
 *  - Shorthand: <owner>/<repo> (with optional .git)
 * Strictly rejects:
 *  - Non-GitHub hosts (GitLab, Bitbucket, arbitrary domains)
 *  - Protocols other than https: (e.g. file://, ssh://, git://)
 *  - Local filesystem paths (/etc, C:\...)
 *  - Strings beginning with '-' (prevent CLI flag injection)
 *
 * @param {string} repoUrl
 * @returns {boolean}
 */
export const isValidRepoUrl = (repoUrl) => {
    if (!repoUrl || typeof repoUrl !== "string") return false;
    const clean = repoUrl.trim();
    if (!clean || clean.startsWith("-")) return false;

    // Reject file:// and non-HTTPS protocols
    if (clean.includes("://")) {
        try {
            const parsed = new URL(clean);
            if (parsed.protocol !== "https:") return false;
            if (parsed.hostname.toLowerCase() !== "github.com") return false;

            const segments = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
            if (segments.length !== 2) return false;

            const [owner, repo] = segments;
            if (!owner || !repo || owner.startsWith("-") || repo.startsWith("-")) return false;
            return /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+(?:\.git)?$/.test(repo);
        } catch {
            return false;
        }
    }

    // Shorthand format: owner/repo
    const parts = clean.split("/");
    if (parts.length !== 2) return false;
    const [owner, repo] = parts;
    if (!owner || !repo || owner.startsWith("-") || repo.startsWith("-")) return false;
    return /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+(?:\.git)?$/.test(repo);
};

/**
 * Validates git branch name.
 * Accepts 1-100 characters of [A-Za-z0-9._/-].
 * Rejects leading '-' to prevent git argument injection.
 *
 * @param {string} branch
 * @returns {boolean}
 */
export const isValidRepoBranch = (branch) => {
    if (!branch || typeof branch !== "string") return false;
    const clean = branch.trim();
    if (!clean || clean.startsWith("-")) return false;
    return /^[A-Za-z0-9._\/-]{1,100}$/.test(clean);
};

/**
 * Throws ApiError(400) if repoUrl is invalid.
 * @param {string} repoUrl
 */
export const validateRepoUrl = (repoUrl) => {
    if (!isValidRepoUrl(repoUrl)) {
        throw new ApiError(
            400,
            `Invalid repository URL "${repoUrl}". Only GitHub repositories (https://github.com/<owner>/<repo> or <owner>/<repo>) are permitted.`
        );
    }
};

/**
 * Throws ApiError(400) if repoBranch is invalid.
 * @param {string} branch
 */
export const validateRepoBranch = (branch) => {
    if (!isValidRepoBranch(branch)) {
        throw new ApiError(
            400,
            `Invalid repository branch "${branch}". Branch must match /^[A-Za-z0-9._\/-]{1,100}$/ and cannot begin with '-'.`
        );
    }
};

/**
 * Normalizes git URL and attaches GitHub personal access token if present
 * @param {string} repoUrl
 * @param {string|null} token
 * @returns {string}
 */
export const formatCloneUrl = (repoUrl, token = null) => {
    let cleanUrl = repoUrl.trim();

    // Support shorthand like "octocat/Hello-World"
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cleanUrl)) {
        cleanUrl = `https://github.com/${cleanUrl}.git`;
    }

    if (token && cleanUrl.startsWith("https://github.com/")) {
        // Inject token for authenticated cloning of private repos
        cleanUrl = cleanUrl.replace("https://github.com/", `https://${token}@github.com/`);
    }

    return cleanUrl;
};

/**
 * Prepares the repository directory for code analysis:
 * - Local filesystem directories are only allowed if ALLOW_LOCAL_REPOS=true in development.
 * - Validates repository URL and branch against strict security rules.
 * - Performs shallow git clone using '--' separator to prevent option injection.
 *
 * @param {object} options
 * @param {string} options.repoUrl - Remote git URL or owner/repo shorthand
 * @param {string} [options.repoBranch="main"] - Target branch
 * @param {string|null} [options.githubAccessToken=null] - GitHub access token
 * @returns {Promise<{ repoDir: string, isTemp: boolean }>}
 */
export const prepareRepoDirectory = async ({
    repoUrl,
    repoBranch = "main",
    githubAccessToken = null,
}) => {
    if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
        throw new ApiError(400, "Repository URL is required");
    }

    const trimmedUrl = repoUrl.trim();

    // 1. Existing local directory: allowed ONLY when explicitly enabled in non-production development
    const allowLocal = process.env.ALLOW_LOCAL_REPOS === "true" && process.env.NODE_ENV !== "production";
    if (allowLocal) {
        const resolvedLocal = path.resolve(trimmedUrl);
        if (existsSync(resolvedLocal)) {
            try {
                const stat = await fs.stat(resolvedLocal);
                if (stat.isDirectory()) {
                    return { repoDir: resolvedLocal, isTemp: false };
                }
            } catch {
                // Not a directory, continue to remote clone
            }
        }
    }

    // 2. Strict validation of repoUrl and repoBranch
    validateRepoUrl(trimmedUrl);
    if (repoBranch) {
        validateRepoBranch(repoBranch);
    }

    // 3. Remote Git Repository: Create unique isolated temp folder
    const tempBase = path.join(os.tmpdir(), "devpilot-repos");
    await fs.mkdir(tempBase, { recursive: true });

    const tempDir = path.join(
        tempBase,
        `scan-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    );

    const cloneUrl = formatCloneUrl(trimmedUrl, githubAccessToken);

    try {
        const cloneArgs = ["clone", "--depth", "1"];
        if (repoBranch) {
            cloneArgs.push("--branch", repoBranch);
        }
        // Place '--' before the URL to ensure it is treated strictly as an argument, never an option
        cloneArgs.push("--", cloneUrl, tempDir);

        // Execute git clone with a 90 second timeout limit
        await execFileAsync("git", cloneArgs, { timeout: 90000 });

        return { repoDir: tempDir, isTemp: true };
    } catch (cloneErr) {
        // If cloning specific branch failed, attempt default branch fallback
        if (repoBranch) {
            try {
                await cleanupRepoDirectory(tempDir);
                await execFileAsync("git", ["clone", "--depth", "1", "--", cloneUrl, tempDir], {
                    timeout: 90000,
                });
                return { repoDir: tempDir, isTemp: true };
            } catch {
                // Secondary fallback failed, clean up and rethrow below
            }
        }

        // Clean up partial artifacts on failure
        await cleanupRepoDirectory(tempDir);

        // Sanitize error message to prevent token leakage in logs
        const safeMessage = cloneErr.message.replace(/https:\/\/[^@]+@github\.com/g, "https://***@github.com");
        throw new ApiError(500, `Failed to clone repository: ${safeMessage}`);
    }
};

/**
 * Safely removes temporary clone directory after scanning
 * @param {string} dirPath
 */
export const cleanupRepoDirectory = async (dirPath) => {
    try {
        if (dirPath && dirPath.includes("devpilot-repos") && existsSync(dirPath)) {
            await fs.rm(dirPath, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`[RepoCloner] Failed to clean up temp dir ${dirPath}:`, err.message);
    }
};

export default {
    isValidRepoUrl,
    isValidRepoBranch,
    validateRepoUrl,
    validateRepoBranch,
    prepareRepoDirectory,
    cleanupRepoDirectory,
    formatCloneUrl,
};
