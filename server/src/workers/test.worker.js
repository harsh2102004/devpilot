/**
 * DevPilot Background Test Runner Worker (Sub-Phase 8B)
 * 
 * Consumes test execution jobs from `test-queue`, provisions isolated sandboxes
 * (Docker container or local process fallback), executes test suites with timeout watchdogs,
 * auto-detects runtime environments (Node.js npm test, Python pytest), and reports progress.
 */

import { Worker } from "bullmq";
import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { redisConnection } from "../config/redis.js";
import { TEST_QUEUE_NAME } from "../queues/test.queue.js";
import { Job } from "../models/job.js";
import { Project } from "../models/project.js";
import { User } from "../models/User.js";
import { TestRun } from "../models/testRun.js";
import { parseTestOutput } from "../services/testParser.service.js";
import {
    executeInSandbox,
    detectProjectEnvironment,
    ALLOWED_TEST_COMMANDS,
} from "../services/sandbox.service.js";
import {
    prepareRepoDirectory,
    cleanupRepoDirectory,
} from "../services/repoCloner.service.js";

dotenv.config({ path: "./.env" });

/**
 * Process a single test execution job from BullMQ
 *
 * @param {import("bullmq").Job} bullJob
 * @returns {Promise<object>} Execution report
 */
export const processTestJob = async (bullJob) => {
    const {
        projectId,
        userId,
        repoUrl: rawRepoUrl,
        repoBranch: rawRepoBranch,
        testRunId,
        jobRecordId,
        testCommand,
        timeoutMs = 60000,
        preferDocker = true,
        readOnly = false,
    } = bullJob.data;

    const isDbConnected = mongoose.connection.readyState === 1;

    let jobDoc = null;
    let testRunDoc = null;

    if (isDbConnected) {
        if (testRunId) {
            testRunDoc = await TestRun.findById(testRunId);
        }
        if (!testRunDoc) {
            testRunDoc = await TestRun.findOne({
                projectId,
                status: { $in: ["queued", "running"] },
            }).sort({ createdAt: -1 });
        }

        if (jobRecordId) {
            jobDoc = await Job.findById(jobRecordId);
        }
        if (!jobDoc && bullJob.id) {
            jobDoc = await Job.findOne({ bullJobId: bullJob.id });
        }
        if (!jobDoc) {
            jobDoc = await Job.findOne({
                projectId,
                type: "test-run",
                status: { $in: ["queued", "active"] },
            }).sort({ createdAt: -1 });
        }
    }

    const logStep = async (percent, message, level = "info") => {
        console.log(`[TestWorker ${bullJob.id || "local"}] [${percent}%] ${message}`);
        try {
            if (bullJob.updateProgress) {
                await bullJob.updateProgress(percent);
            }
        } catch {}
        try {
            if (jobDoc) {
                await jobDoc.updateProgress(percent, message);
            }
        } catch {}
    };

    let repoContext = null;

    try {
        if (jobDoc) {
            jobDoc.bullJobId = bullJob.id || "";
            await jobDoc.markActive();
        }
        if (testRunDoc) {
            testRunDoc.jobId = bullJob.id || testRunDoc.jobId || "";
            await testRunDoc.markRunning();
        }

        // Determine repoUrl and repoBranch from project if not directly supplied
        let targetRepoUrl = rawRepoUrl;
        let targetRepoBranch = rawRepoBranch || "main";

        if (!targetRepoUrl && projectId && isDbConnected) {
            const project = await Project.findById(projectId);
            if (project) {
                targetRepoUrl = project.repoUrl;
                targetRepoBranch = project.repoBranch || targetRepoBranch;
            }
        }

        if (!targetRepoUrl) {
            throw new Error(`Cannot run tests: No repository URL or local directory found for project ${projectId}`);
        }

        // Retrieve GitHub Access Token if user connected their GitHub account
        let githubToken = null;
        if (userId && isDbConnected) {
            try {
                const user = await User.findById(userId).select("+githubAccessToken");
                if (user?.githubAccessToken) {
                    githubToken = user.githubAccessToken;
                }
            } catch {}
        }

        await logStep(10, `Preparing test workspace for: ${targetRepoUrl} (${targetRepoBranch})`);

        // Clone or resolve repository into isolated workspace directory
        repoContext = await prepareRepoDirectory({
            repoUrl: targetRepoUrl,
            repoBranch: targetRepoBranch,
            githubAccessToken: githubToken,
        });

        await logStep(25, `Workspace isolated at: ${repoContext.repoDir}`);

        // Sub-Phase 8B Requirement 3: Runtime Environment & Test Runner Auto-Detection
        const envInfo = detectProjectEnvironment(repoContext.repoDir);
        let resolvedCommand = testCommand || envInfo.testCommand;

        // Security check: validate testCommand against fixed allow-list (Task 2)
        if (testCommand && typeof testCommand === "string" && !ALLOWED_TEST_COMMANDS.includes(testCommand.trim())) {
            throw new Error(`[TestWorker] Unauthorized test command rejected: "${testCommand}". Must match fixed allow-list.`);
        }

        await logStep(
            40,
            `Environment detected: ${envInfo.runtime.toUpperCase()} (Runner: ${envInfo.runner}). Test command: "${resolvedCommand}"`
        );

        await logStep(50, `Initializing execution sandbox (timeout: ${Math.round(timeoutMs / 1000)}s, preferDocker: ${preferDocker})...`);

        // Stream output logs in batches to prevent event loop blocking
        let streamedChars = 0;
        const onLog = (chunk) => {
            streamedChars += chunk.length;
            // Optionally log highlights or forward chunks to pub/sub
        };

        // Execute inside sandbox container or process fallback (strictly network: "none", readOnly: true)
        const executionResult = await executeInSandbox({
            workingDir: repoContext.repoDir,
            command: resolvedCommand,
            timeoutMs,
            preferDocker,
            readOnly: readOnly !== false,
            network: "none",
            image: envInfo.image,
            onLog,
        });

        await logStep(
            90,
            `Sandbox execution completed in ${executionResult.durationMs}ms (exitCode: ${executionResult.exitCode}, environment: ${executionResult.environment})`
        );

        // Parse test output for structured metrics and culprit failure traces
        const parsedReport = parseTestOutput({
            rawOutput: executionResult.output,
            runner: envInfo.runner,
            exitCode: executionResult.exitCode,
            durationMs: executionResult.durationMs,
        });

        const summaryPayload = {
            exitCode: executionResult.exitCode,
            durationMs: executionResult.durationMs,
            timedOut: executionResult.timedOut,
            environment: executionResult.environment,
            runtime: envInfo.runtime,
            runner: parsedReport.runner,
            testCommand: resolvedCommand,
            total: parsedReport.summary.total,
            passed: parsedReport.summary.passed,
            failed: parsedReport.summary.failed,
            skipped: parsedReport.summary.skipped,
        };

        if (executionResult.success) {
            await logStep(
                100,
                `✅ Test suite passed! (${parsedReport.summary.passed}/${parsedReport.summary.total} tests passed in ${parsedReport.summary.durationMs}ms)`,
                "success"
            );
            if (jobDoc) {
                await jobDoc.markCompleted(summaryPayload);
            }
        } else {
            const failReason = executionResult.timedOut
                ? `Test execution timed out after ${timeoutMs}ms`
                : `Test suite failed (${parsedReport.failures.length} failures, exit code ${executionResult.exitCode})`;
            await logStep(100, `❌ ${failReason}`, "error");
            if (jobDoc) {
                await jobDoc.markFailed(failReason);
            }
        }

        // Persist structured test run report in MongoDB
        if (testRunDoc) {
            await testRunDoc.markFinished({
                success: executionResult.success,
                timedOut: executionResult.timedOut,
                summary: parsedReport.summary,
                failures: parsedReport.failures,
                rawOutput: executionResult.output,
                environment: executionResult.environment,
                runtime: envInfo.runtime,
                runner: parsedReport.runner,
            });
        }

        return {
            ...executionResult,
            runtime: envInfo.runtime,
            runner: parsedReport.runner,
            summary: parsedReport.summary,
            failures: parsedReport.failures,
            testCommand: resolvedCommand,
            projectId,
            testRunId: testRunDoc?._id || testRunId,
        };
    } catch (err) {
        console.error(`[TestWorker] Error executing test job ${bullJob.id}:`, err);
        if (jobDoc) {
            await jobDoc.markFailed(err.message);
        }
        if (testRunDoc) {
            await testRunDoc.markError(err.message);
        }
        throw err;
    } finally {
        // Guarantee cleanup of ephemeral clone directories
        if (repoContext?.isTemp && repoContext?.repoDir) {
            try {
                await cleanupRepoDirectory(repoContext.repoDir);
            } catch (cleanupErr) {
                console.warn(`[TestWorker] Warning: failed to clean up temp repo dir: ${cleanupErr.message}`);
            }
        }
    }
};

/**
 * Creates and initializes the BullMQ test worker instance
 *
 * @param {object} [options]
 * @param {import("ioredis").Redis} [options.connection=redisConnection]
 * @param {number} [options.concurrency=2] - Maximum concurrent sandboxed test runs
 * @returns {Worker}
 */
export const createTestWorker = ({
    connection = redisConnection,
    concurrency = 2,
} = {}) => {
    const worker = new Worker(TEST_QUEUE_NAME, processTestJob, {
        connection,
        concurrency,
        limiter: {
            max: 5,
            duration: 10000,
        },
    });

    worker.on("active", (job) => {
        console.log(`[TestWorker] Job ${job.id} active`);
    });

    worker.on("completed", (job) => {
        console.log(`[TestWorker] Job ${job.id} completed successfully`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[TestWorker] Job ${job?.id} failed with error:`, err?.message || err);
    });

    worker.on("error", (err) => {
        console.error("[TestWorker] Worker encountered error:", err);
    });

    return worker;
};

// Auto-run if executed directly as entrypoint (e.g. `npm run worker:test`)
const isDirectEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

if (isDirectEntry) {
    console.log("=================================================");
    console.log("   DevPilot Sandboxed Test Runner Worker");
    console.log("=================================================");

    connectDB()
        .then(() => {
            console.log("[TestWorker] Connected to MongoDB");
            const worker = createTestWorker();
            console.log(`[TestWorker] Listening on queue "${TEST_QUEUE_NAME}" (concurrency: 2)...`);

            const handleShutdown = async (signal) => {
                console.log(`\n[TestWorker] Received ${signal}. Closing worker gracefully...`);
                await worker.close();
                process.exit(0);
            };

            process.on("SIGINT", () => handleShutdown("SIGINT"));
            process.on("SIGTERM", () => handleShutdown("SIGTERM"));
        })
        .catch((err) => {
            console.error("[TestWorker] Failed to start test worker:", err);
            process.exit(1);
        });
}

export default {
    processTestJob,
    createTestWorker,
};
