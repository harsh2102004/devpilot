import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { ApiError } from "../utils/ApiError.js";

const execFileAsync = promisify(execFile);

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
 * - If repoUrl is an existing local directory, returns the absolute path directly.
 * - Otherwise, performs a shallow git clone into an isolated temporary folder.
 *
 * @param {object} options
 * @param {string} options.repoUrl - Local path or remote git URL
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
        throw new ApiError(400, "Repository URL or directory path is required");
    }

    const trimmedUrl = repoUrl.trim();

    // 1. Check if it's an existing local directory on disk
    const resolvedLocal = path.resolve(trimmedUrl);
    if (existsSync(resolvedLocal)) {
        try {
            const stat = await fs.stat(resolvedLocal);
            if (stat.isDirectory()) {
                return { repoDir: resolvedLocal, isTemp: false };
            }
        } catch {
            // Not a local directory, continue to remote clone
        }
    }

    // 2. Remote Git Repository: Create unique isolated temp folder
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
        cloneArgs.push(cloneUrl, tempDir);

        // Execute git clone with a 90 second timeout limit
        await execFileAsync("git", cloneArgs, { timeout: 90000 });

        return { repoDir: tempDir, isTemp: true };
    } catch (cloneErr) {
        // If cloning specific branch failed, attempt default branch fallback
        if (repoBranch) {
            try {
                await cleanupRepoDirectory(tempDir);
                await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, tempDir], {
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
    prepareRepoDirectory,
    cleanupRepoDirectory,
    formatCloneUrl,
};
