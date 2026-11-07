/**
 * DevPilot Sandbox Verification Loop & Autonomous Fix Engine (Sub-Phase 9C)
 *
 * Implements Step 11 & Section 9 of the DevPilot Architecture (pilot.pdf):
 * 1. Creates isolated workspace clones to safely test candidate patches without mutating user code.
 * 2. Applies candidate patches to isolated workspace with AST syntax safety guards.
 * 3. Re-executes test suites via Phase 8 Docker/process sandboxes.
 * 4. Autonomous reflection loop: if tests fail, feeds compiler/runtime errors back to LLM (up to 3 attempts).
 */

import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import crypto from "crypto";
import { executeInSandbox } from "./sandbox.service.js";
import { parseTestOutput } from "./testParser.service.js";
import { investigateFailure } from "./debugAgent.service.js";
import {
    synthesizePatch,
    applyCodeReplacement,
    validateAstSyntax,
    generateUnifiedDiff,
} from "./patchGenerator.service.js";

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Normalizes relative file paths extracted from test failures
 * @param {string} rawPath
 * @returns {string}
 */
export const normalizePath = (rawPath) => {
    if (!rawPath) return "";
    return rawPath
        .trim()
        .replace(/\\/g, "/")
        .replace(/^file:\/\/\/?/, "")
        .replace(/^\/workspace\//, "");
};

/**
 * Recursively copies directory contents, filtering out bloat/caches (.git, dist, build)
 * and linking dependencies for fast execution.
 *
 * @param {string} src - Source folder
 * @param {string} dest - Destination folder
 */
export const copyWorkspaceFiles = async (src, dest) => {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Exclude version control and build caches to ensure fast workspace creation
        if (
            entry.name === ".git" ||
            entry.name === ".next" ||
            entry.name === "dist" ||
            entry.name === "build" ||
            entry.name === ".cache" ||
            entry.name === "coverage"
        ) {
            continue;
        }

        // Link dependencies (node_modules or venv) so tests can run immediately
        if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "venv") {
            try {
                if (process.platform === "win32") {
                    await fs.symlink(srcPath, destPath, "junction");
                } else {
                    await fs.symlink(srcPath, destPath, "dir");
                }
                continue;
            } catch {
                // If symlinking/junction fails (e.g. cross-volume), fall back to copy
            }
        }

        if (entry.isDirectory()) {
            await copyWorkspaceFiles(srcPath, destPath);
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
        }
    }
};

/**
 * Creates an isolated workspace copy for candidate patch application and verification.
 *
 * @param {object} params
 * @param {string} params.repoDir - Source repository directory
 * @param {string} [params.prefix="devpilot-verify"]
 * @returns {Promise<{ workspaceDir: string, isTemp: boolean, cleanup: () => Promise<void> }>}
 */
export const createIsolatedWorkspace = async ({
    repoDir,
    prefix = "devpilot-verify",
}) => {
    if (!repoDir || !existsSync(repoDir)) {
        throw new Error(`[VerificationLoop] Invalid repoDir: directory does not exist at "${repoDir}"`);
    }

    const tempRoot = path.join(os.tmpdir(), "devpilot-verification");
    await fs.mkdir(tempRoot, { recursive: true });

    const uniqueId = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const workspaceDir = path.join(tempRoot, uniqueId);

    await copyWorkspaceFiles(repoDir, workspaceDir);

    const cleanup = async () => {
        await cleanupIsolatedWorkspace(workspaceDir);
    };

    return {
        workspaceDir,
        isTemp: true,
        cleanup,
    };
};

/**
 * Safely cleans up the isolated workspace directory
 *
 * @param {string} workspaceDir
 */
export const cleanupIsolatedWorkspace = async (workspaceDir) => {
    try {
        if (
            workspaceDir &&
            workspaceDir.includes("devpilot-verification") &&
            existsSync(workspaceDir)
        ) {
            await fs.rm(workspaceDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`[VerificationLoop] Failed to clean up isolated workspace "${workspaceDir}": ${err.message}`);
    }
};

/**
 * Applies a synthesized patch directly to the target file inside the isolated workspace.
 * Validates AST syntax integrity before writing to disk.
 *
 * @param {object} params
 * @param {string} params.workspaceDir - Isolated workspace directory root
 * @param {string} params.filePath - Relative path to culprit file
 * @param {string} [params.modifiedContent] - Complete modified file content
 * @param {string} [params.targetCode] - Code segment to replace
 * @param {string} [params.replacementCode] - Replacement code to insert
 * @returns {Promise<object>} Application report
 */
export const applyPatchToWorkspace = async ({
    workspaceDir,
    filePath,
    modifiedContent = null,
    targetCode = null,
    replacementCode = null,
}) => {
    if (!workspaceDir || !existsSync(workspaceDir)) {
        throw new Error(`[VerificationLoop] Workspace directory not found: "${workspaceDir}"`);
    }
    if (!filePath) {
        throw new Error("[VerificationLoop] filePath is required to apply patch");
    }

    const cleanRelPath = normalizePath(filePath);
    const targetFullPath = path.resolve(workspaceDir, cleanRelPath);

    // Guard against path traversal attacks outside workspace
    const resolvedWorkspace = path.resolve(workspaceDir);
    if (!targetFullPath.startsWith(resolvedWorkspace)) {
        throw new Error(`[VerificationLoop] Security violation: Path traversal detected "${filePath}"`);
    }

    if (!existsSync(targetFullPath)) {
        throw new Error(`[VerificationLoop] Target file does not exist in workspace: "${cleanRelPath}"`);
    }

    const originalContent = await fs.readFile(targetFullPath, "utf8");
    let finalModifiedContent = modifiedContent;
    let matchStrategy = "direct";

    if (!finalModifiedContent) {
        if (!targetCode) {
            throw new Error("[VerificationLoop] Either modifiedContent or targetCode must be supplied to apply patch");
        }
        const replaceResult = applyCodeReplacement({
            originalContent,
            targetCode,
            replacementCode: replacementCode || "",
        });

        if (!replaceResult.success) {
            return {
                success: false,
                filePath: cleanRelPath,
                error: "Target code not found in original file content for replacement",
                astValid: false,
                unifiedDiff: "",
            };
        }

        finalModifiedContent = replaceResult.modifiedContent;
        matchStrategy = replaceResult.matchedBy;
    }

    // AST syntax integrity check on modified code
    const astCheck = validateAstSyntax({
        code: finalModifiedContent,
        filePath: cleanRelPath,
    });

    if (!astCheck.valid) {
        return {
            success: false,
            filePath: cleanRelPath,
            error: `AST syntax integrity failed: ${astCheck.error}`,
            syntaxError: astCheck.error,
            syntaxErrorLine: astCheck.line,
            astValid: false,
            unifiedDiff: "",
        };
    }

    // Write modified content to disk in isolated workspace
    await fs.writeFile(targetFullPath, finalModifiedContent, "utf8");

    // Compute unified diff
    const unifiedDiff = generateUnifiedDiff({
        filePath: cleanRelPath,
        originalContent,
        modifiedContent: finalModifiedContent,
    });

    return {
        success: true,
        filePath: cleanRelPath,
        targetFullPath,
        astValid: true,
        matchedBy: matchStrategy,
        originalContent,
        modifiedContent: finalModifiedContent,
        unifiedDiff,
    };
};

/**
 * Re-runs the test suite in the isolated workspace via Phase 8 Docker/process sandbox.
 *
 * @param {object} params
 * @param {string} params.workspaceDir - Isolated workspace directory
 * @param {string|string[]} [params.testCommand] - Override test command
 * @param {number} [params.timeoutMs=60000] - Execution timeout watchdog
 * @param {boolean} [params.preferDocker=false] - Prefer Docker execution
 * @param {Function} [params.onLog] - Streaming log callback
 * @returns {Promise<object>} Parsed test verification report
 */
export const runVerificationTest = async ({
    workspaceDir,
    testCommand = null,
    timeoutMs = 60000,
    preferDocker = false,
    onLog = null,
}) => {
    const execResult = await executeInSandbox({
        workingDir: workspaceDir,
        command: testCommand,
        timeoutMs,
        preferDocker,
        onLog,
    });

    const parsedReport = parseTestOutput({
        rawOutput: execResult.output,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
    });

    const isPassed = execResult.exitCode === 0 && (parsedReport.failed === 0 || !parsedReport.failed) && !execResult.timedOut;

    return {
        passed: isPassed,
        exitCode: execResult.exitCode,
        timedOut: execResult.timedOut,
        summary: {
            total: parsedReport.total ?? 0,
            passed: parsedReport.passed ?? (isPassed ? 1 : 0),
            failed: parsedReport.failed ?? (isPassed ? 0 : 1),
            skipped: parsedReport.skipped ?? 0,
            durationMs: execResult.durationMs,
        },
        failures: parsedReport.failures || [],
        rawOutput: execResult.output,
        environment: execResult.environment,
    };
};

/**
 * Formulates structured reflection feedback for subsequent patch synthesis attempts.
 *
 * @param {object} params
 * @param {number} params.attemptNumber
 * @param {object} params.failure - Original test failure
 * @param {object} [params.prevPatch] - Patch proposed in previous attempt
 * @param {object} [params.prevTestResult] - Sandbox test result from previous attempt
 * @param {string} [params.syntaxError] - AST syntax error if attempt failed before sandbox
 * @returns {string} Formatted reflection prompt section
 */
export const formatReflectionFeedback = ({
    attemptNumber,
    failure,
    prevPatch = null,
    prevTestResult = null,
    syntaxError = null,
}) => {
    const lines = [
        `[DevPilot Autonomous Reflection - Attempt ${attemptNumber} Failed Verification]`,
    ];

    if (syntaxError) {
        lines.push(`The proposed patch introduced a syntax error: "${syntaxError}".`);
        lines.push("Ensure your next code replacement is 100% syntactically valid JavaScript/TypeScript.");
    } else if (prevTestResult) {
        lines.push(`Candidate patch failed sandbox execution with exit code ${prevTestResult.exitCode}.`);
        if (prevTestResult.timedOut) {
            lines.push("Execution timed out. The patch may have introduced an infinite loop or hanging process.");
        }
        if (prevTestResult.failures && prevTestResult.failures.length > 0) {
            lines.push("Active test failure(s):");
            prevTestResult.failures.slice(0, 3).forEach((f, idx) => {
                lines.push(`  ${idx + 1}. [${f.errorName || "Error"}] in "${f.testTitle}": ${f.errorMessage}`);
                if (f.line) lines.push(`     Culprit location: ${f.filePath || "unknown"}:${f.line}`);
            });
        } else {
            lines.push(`Captured error output: ${prevTestResult.rawOutput.slice(-300).trim()}`);
        }
    }

    if (prevPatch) {
        lines.push(`Previous replacement attempted:`);
        lines.push(`  Target: "${prevPatch.targetCode}"`);
        lines.push(`  Replacement: "${prevPatch.replacementCode}"`);
        lines.push("CRITICAL: Do NOT propose the same patch again. Adapt your strategy to fix the root cause and avoid regressions.");
    }

    return lines.join("\n");
};

/**
 * Master Sandbox Verification Loop (Sub-Phase 9C Core)
 *
 * Coordinates:
 * 1. Isolated clone creation
 * 2. AST-safe patch application
 * 3. Sandboxed test verification
 * 4. Autonomous reflection loop (up to maxAttempts, default 3)
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.projectName="DevPilot Project"]
 * @param {string} params.repoDir - Source repository directory
 * @param {object} params.failure - Parsed test failure evidence
 * @param {object} [params.codeGraph=null] - AST Code Graph for context
 * @param {string|string[]} [params.testCommand=null] - Custom test command
 * @param {number} [params.maxAttempts=3] - Maximum retry iterations (default: 3)
 * @param {boolean} [params.preferDocker=false] - Prefer Docker execution
 * @param {number} [params.timeoutMs=60000] - Sandbox timeout
 * @param {Function} [params.onProgress] - Real-time progress notifier
 * @param {Function} [params.onLog] - Streaming test log callback
 * @returns {Promise<object>} Complete autonomous verification result
 */
export const executeAutonomousVerificationLoop = async ({
    projectId,
    projectName = "DevPilot Project",
    repoDir,
    failure,
    codeGraph = null,
    testCommand = null,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    preferDocker = false,
    timeoutMs = 60000,
    onProgress = null,
    onLog = null,
}) => {
    if (!repoDir || !existsSync(repoDir)) {
        throw new Error(`[VerificationLoop] Source directory does not exist: "${repoDir}"`);
    }
    if (!failure || !failure.testTitle) {
        throw new Error("[VerificationLoop] Valid failure evidence object is required");
    }

    const culpritFilePath = normalizePath(failure.filePath || "");
    const attemptsHistory = [];
    let isolatedWorkspace = null;

    try {
        // 1. Create clean isolated workspace
        isolatedWorkspace = await createIsolatedWorkspace({
            repoDir,
            prefix: "verify-loop",
        });

        const targetFullPath = path.resolve(isolatedWorkspace.workspaceDir, culpritFilePath);
        if (!existsSync(targetFullPath)) {
            throw new Error(`[VerificationLoop] Culprit file "${culpritFilePath}" not found in workspace`);
        }

        const originalBaseContent = await fs.readFile(targetFullPath, "utf8");
        let diagnosticReport = "";

        // 2. Iterative Reflection Loop (maxAttempts, default 3)
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (onProgress) {
                onProgress({
                    attempt,
                    maxAttempts,
                    stage: "diagnosing",
                    message: attempt === 1 ? "Diagnosing root cause with AST context..." : `Reflection attempt ${attempt}/${maxAttempts}: Re-analyzing failure...`,
                });
            }

            // Step A: Root Cause Diagnosis or Reflection
            if (attempt === 1) {
                try {
                    const diagnosisResult = await investigateFailure({
                        projectId,
                        projectName,
                        failure,
                        codeGraph,
                        workingDir: repoDir,
                    });
                    diagnosticReport = diagnosisResult.diagnosticReport || "";
                } catch (diagErr) {
                    console.warn(`[VerificationLoop] Initial diagnosis warning: ${diagErr.message}`);
                    diagnosticReport = `Investigating failure "${failure.testTitle}": ${failure.errorMessage}`;
                }
            } else {
                // Generate reflection diagnostic from previous attempt's failure
                const prevAttempt = attemptsHistory[attemptsHistory.length - 1];
                diagnosticReport = formatReflectionFeedback({
                    attemptNumber: attempt - 1,
                    failure,
                    prevPatch: prevAttempt.patch,
                    prevTestResult: prevAttempt.testResult,
                    syntaxError: prevAttempt.syntaxError,
                });
            }

            // Step B: Synthesize candidate patch
            if (onProgress) {
                onProgress({
                    attempt,
                    maxAttempts,
                    stage: "synthesizing_patch",
                    message: `Synthesizing candidate patch (attempt ${attempt}/${maxAttempts})...`,
                });
            }

            const patch = await synthesizePatch({
                projectId,
                projectName,
                failure,
                diagnosticReport,
                filePath: culpritFilePath,
                originalContent: originalBaseContent,
                previousAttempts: attemptsHistory,
            });

            // Pre-execution AST Syntax Integrity Guard
            if (!patch.astValid) {
                const syntaxErrorMsg = patch.syntaxError || "AST syntax validation failed";
                attemptsHistory.push({
                    attempt,
                    status: "ast_syntax_error",
                    syntaxError: syntaxErrorMsg,
                    syntaxErrorLine: patch.syntaxErrorLine,
                    patch,
                    testResult: null,
                });

                if (onProgress) {
                    onProgress({
                        attempt,
                        maxAttempts,
                        stage: "syntax_error",
                        error: syntaxErrorMsg,
                    });
                }
                continue; // Reflect and retry in next attempt
            }

            // Step C: Apply candidate patch in isolated container/workspace
            if (onProgress) {
                onProgress({
                    attempt,
                    maxAttempts,
                    stage: "applying_patch",
                    message: `Applying patch to isolated workspace (attempt ${attempt}/${maxAttempts})...`,
                });
            }

            // Reset culprit file to original before applying candidate patch
            await fs.writeFile(targetFullPath, originalBaseContent, "utf8");

            const applyResult = await applyPatchToWorkspace({
                workspaceDir: isolatedWorkspace.workspaceDir,
                filePath: culpritFilePath,
                modifiedContent: patch.modifiedContent,
            });

            if (!applyResult.success) {
                attemptsHistory.push({
                    attempt,
                    status: "apply_error",
                    error: applyResult.error,
                    patch,
                    testResult: null,
                });
                continue;
            }

            // Step D: Re-run test suite via sandbox to verify fix
            if (onProgress) {
                onProgress({
                    attempt,
                    maxAttempts,
                    stage: "running_sandbox_tests",
                    message: `Executing sandboxed test suite verification (attempt ${attempt}/${maxAttempts})...`,
                });
            }

            const testResult = await runVerificationTest({
                workspaceDir: isolatedWorkspace.workspaceDir,
                testCommand,
                timeoutMs,
                preferDocker,
                onLog,
            });

            // Step E: Evaluate Verification Outcome
            if (testResult.passed) {
                attemptsHistory.push({
                    attempt,
                    status: "passed",
                    patch,
                    testResult,
                });

                if (onProgress) {
                    onProgress({
                        attempt,
                        maxAttempts,
                        stage: "verified",
                        status: "success",
                        message: `Fix successfully verified in sandbox on attempt ${attempt}!`,
                    });
                }

                return {
                    success: true,
                    verified: true,
                    attemptsCount: attempt,
                    maxAttempts,
                    attemptsHistory,
                    verifiedPatch: {
                        ...patch,
                        unifiedDiff: applyResult.unifiedDiff || patch.unifiedDiff,
                    },
                    finalTestResult: testResult,
                    workspaceDir: isolatedWorkspace.workspaceDir,
                    cleanup: isolatedWorkspace.cleanup,
                };
            }

            // Test still failing -> Record for reflection in next attempt
            attemptsHistory.push({
                attempt,
                status: "failed",
                patch,
                testResult,
                errorFeedback: formatReflectionFeedback({
                    attemptNumber: attempt,
                    failure,
                    prevPatch: patch,
                    prevTestResult: testResult,
                }),
            });

            if (onProgress) {
                onProgress({
                    attempt,
                    maxAttempts,
                    stage: "attempt_failed",
                    message: `Verification failed on attempt ${attempt}. Triggering reflection loop...`,
                    testResult,
                });
            }
        }

        // Maximum attempts exhausted
        return {
            success: false,
            verified: false,
            attemptsCount: maxAttempts,
            maxAttempts,
            attemptsHistory,
            lastError: `Autonomous verification loop exhausted max attempts (${maxAttempts}) without resolving test failure.`,
            workspaceDir: isolatedWorkspace.workspaceDir,
            cleanup: isolatedWorkspace.cleanup,
        };
    } catch (loopErr) {
        if (isolatedWorkspace) {
            await isolatedWorkspace.cleanup();
        }
        throw loopErr;
    }
};

export default {
    normalizePath,
    copyWorkspaceFiles,
    createIsolatedWorkspace,
    cleanupIsolatedWorkspace,
    applyPatchToWorkspace,
    runVerificationTest,
    formatReflectionFeedback,
    executeAutonomousVerificationLoop,
};

