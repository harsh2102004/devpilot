import { Worker } from "bullmq";
import dotenv from "dotenv";
import connectDB from "../db/index.js";
import { Job } from "../models/job.js";
import { Project } from "../models/project.js";
import { User } from "../models/User.js";
import { CodeGraph } from "../models/codeGraph.js";
import { buildCodeGraph } from "../services/codeGraph.service.js";
import { prepareRepoDirectory, cleanupRepoDirectory } from "../services/repoCloner.service.js";

dotenv.config({ path: "./.env" });

export const SCAN_QUEUE_NAME = process.env.SCAN_QUEUE_NAME || "scan-queue";

/**
 * Background worker task processor for repository code scanning & AST graph indexing
 * @param {import("bullmq").Job} bullJob
 */
export const processScanJob = async (bullJob) => {
    const { projectId, userId, repoUrl, repoBranch, jobRecordId } = bullJob.data;

    let jobDoc = null;
    if (jobRecordId) {
        jobDoc = await Job.findById(jobRecordId);
    }
    if (!jobDoc && bullJob.id) {
        jobDoc = await Job.findOne({ bullJobId: bullJob.id });
    }
    if (!jobDoc) {
        jobDoc = await Job.findOne({ projectId, status: { $in: ["queued", "active"] } }).sort({ createdAt: -1 });
    }

    const logStep = async (percent, message) => {
        console.log(`[Job ${bullJob.id || "local"}] [${percent}%] ${message}`);
        if (bullJob.updateProgress) {
            await bullJob.updateProgress(percent);
        }
        if (jobDoc) {
            await jobDoc.updateProgress(percent, message);
        }
    };

    let repoContext = null;

    try {
        if (jobDoc) {
            jobDoc.bullJobId = bullJob.id || "";
            await jobDoc.markActive();
        }

        // Transition project status: connected/disconnected -> scanning
        await Project.findByIdAndUpdate(projectId, { status: "scanning" });

        // Retrieve GitHub Access Token if user connected their GitHub account
        let githubToken = null;
        if (userId) {
            const user = await User.findById(userId).select("+githubAccessToken");
            if (user?.githubAccessToken) {
                githubToken = user.githubAccessToken;
            }
        }

        await logStep(10, `Preparing repository: ${repoUrl} (${repoBranch || "main"})`);

        // Resolve local directory or shallow clone remote repo
        repoContext = await prepareRepoDirectory({
            repoUrl,
            repoBranch: repoBranch || "main",
            githubAccessToken: githubToken,
        });

        await logStep(30, `Inspecting repository file tree at: ${repoContext.repoDir}`);

        await logStep(50, "Parsing AST and extracting symbols (functions, classes, calls, imports)...");

        // Execute AST parsing & Code Graph construction
        const codeGraphData = await buildCodeGraph(repoContext.repoDir);

        await logStep(
            80,
            `Code graph analyzed: ${codeGraphData.stats.totalNodes} nodes, ${codeGraphData.stats.totalEdges} edges (${codeGraphData.stats.functionsFound} functions, ${codeGraphData.stats.classesFound} classes across ${codeGraphData.stats.codeFilesParsed} source files)`
        );

        await logStep(90, "Persisting code graph and metrics to MongoDB...");

        // Upsert complete CodeGraph in MongoDB
        const persistedGraph = await CodeGraph.findOneAndUpdate(
            { projectId },
            {
                projectId,
                jobId: jobDoc?._id || null,
                nodes: codeGraphData.nodes,
                edges: codeGraphData.edges,
                stats: codeGraphData.stats,
            },
            { upsert: true, returnDocument: "after" }
        );

        // Update Project document: state -> indexed, codeGraphStats & reference
        await Project.findByIdAndUpdate(projectId, {
            status: "indexed",
            codeGraphStats: codeGraphData.stats,
            codeGraph: persistedGraph._id,
            lastScannedAt: new Date(),
        });

        // Update Job document: state -> completed, progress -> 100%
        if (jobDoc) {
            await jobDoc.markCompleted({
                stats: codeGraphData.stats,
                nodes: codeGraphData.nodes,
                edges: codeGraphData.edges,
                graphId: persistedGraph._id,
            });
        }

        await logStep(
            100,
            `Scan completed successfully. Total indexed symbols: ${codeGraphData.stats.totalNodes}`
        );

        return {
            success: true,
            projectId,
            stats: codeGraphData.stats,
            graphId: persistedGraph._id,
        };
    } catch (error) {
        console.error(`[Job ${bullJob.id || "local"}] Scan job failed:`, error.message);

        if (jobDoc) {
            await jobDoc.markFailed(error.message);
        }

        await Project.findByIdAndUpdate(projectId, { status: "scan-failed" });

        throw error;
    } finally {
        if (repoContext?.isTemp && repoContext?.repoDir) {
            await cleanupRepoDirectory(repoContext.repoDir);
        }
    }
};

export const initScannerWorker = async () => {
    const { redisConnection } = await import("../config/redis.js");

    const worker = new Worker(
        SCAN_QUEUE_NAME,
        async (job) => processScanJob(job),
        {
            connection: redisConnection,
            concurrency: 2,
        }
    );

    worker.on("ready", () => {
        console.log(`Scanner worker listening on queue: ${SCAN_QUEUE_NAME}`);
    });

    worker.on("completed", (job) => {
        console.log(`Job ${job.id} completed successfully`);
    });

    worker.on("failed", (job, err) => {
        console.error(`Job ${job?.id} failed:`, err.message);
    });

    const shutdown = async () => {
        console.log("Stopping scanner worker...");
        await worker.close();
        process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    return worker;
};

const isDirectRun =
    process.argv[1] &&
    process.argv[1].replace(/\\/g, "/").endsWith("scanner.worker.js");

if (isDirectRun) {
    connectDB()
        .then(() => initScannerWorker())
        .catch((err) => {
            console.error("Worker DB connection error:", err);
            process.exit(1);
        });
}

export default initScannerWorker;
