import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { ApiError } from "../utils/ApiError.js";
import { decryptToken } from "./tokenEncryption.service.js";

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
 * Normalizes git URL to standard HTTPS format.
 * Tokens are NEVER embedded in the URL to prevent leakage into .git/config.
 *
 * @param {string} repoUrl
 * @returns {string} Clean HTTPS clone URL
 */
export const formatCloneUrl = (repoUrl) => {
    let cleanUrl = repoUrl.trim();

    // Support shorthand like "octocat/Hello-World"
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cleanUrl)) {
        cleanUrl = `https://github.com/${cleanUrl}.git`;
    }

    if (!cleanUrl.endsWith(".git") && cleanUrl.startsWith("https://github.com/")) {
        cleanUrl = `${cleanUrl.replace(/\/$/, "")}.git`;
    }

    return cleanUrl;
};

/**
 * Prepares the repository directory for code analysis:
 * - Local filesystem directories are only allowed if ALLOW_LOCAL_REPOS=true in development.
 * - Validates repository URL and branch against strict security rules.
 * - Clones WITHOUT token in URL using git extraheader in env (never argv) to prevent credential leakage into .git/config.
 * - Runs 'git remote set-url origin <clean url>' after clone.
 *
 * @param {object} options
 * @param {string} options.repoUrl - Remote git URL or owner/repo shorthand
 * @param {string} [options.repoBranch="main"] - Target branch
 * @param {string|null} [options.githubAccessToken=null] - GitHub access token (plain or encrypted)
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

    // Clean URL without embedded tokens
    const cleanUrl = formatCloneUrl(trimmedUrl);

    // Decrypt token if encrypted, and inject authorization via environment variables (never in argv!)
    const rawToken = githubAccessToken ? decryptToken(githubAccessToken) : null;
    const gitEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
    };

    if (rawToken) {
        gitEnv.GIT_CONFIG_COUNT = "1";
        gitEnv.GIT_CONFIG_KEY_0 = "http.extraheader";
        gitEnv.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: bearer ${rawToken}`;
    }

    try {
        const cloneArgs = ["clone", "--depth", "1"];
        if (repoBranch) {
            cloneArgs.push("--branch", repoBranch);
        }
        // Place '--' before the clean URL
        cloneArgs.push("--", cleanUrl, tempDir);

        // Execute git clone with clean URL and authorization header passed via private env
        await execFileAsync("git", cloneArgs, { env: gitEnv, timeout: 90000 });

        // Ensure origin remote is clean URL (guarantees .git/config never contains tokens or credentials)
        await execFileAsync("git", ["remote", "set-url", "origin", cleanUrl], {
            cwd: tempDir,
            timeout: 15000,
        });

        return { repoDir: tempDir, isTemp: true };
    } catch (cloneErr) {
        // If cloning specific branch failed, attempt default branch fallback
        if (repoBranch) {
            try {
                await cleanupRepoDirectory(tempDir);
                await execFileAsync("git", ["clone", "--depth", "1", "--", cleanUrl, tempDir], {
                    env: gitEnv,
                    timeout: 90000,
                });
                await execFileAsync("git", ["remote", "set-url", "origin", cleanUrl], {
                    cwd: tempDir,
                    timeout: 15000,
                });
                return { repoDir: tempDir, isTemp: true };
            } catch {
                // Secondary fallback failed, clean up and rethrow below
            }
        }

        // Clean up partial artifacts on failure
        await cleanupRepoDirectory(tempDir);

        // Sanitize error message to prevent token leakage in logs
        const safeMessage = cloneErr.message
            .replace(/bearer\s+[A-Za-z0-9_.-]+/gi, "bearer ***")
            .replace(/https:\/\/[^@]+@github\.com/g, "https://***@github.com");
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
