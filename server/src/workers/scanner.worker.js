import { Worker } from "bullmq";
import dotenv from "dotenv";
import connectDB from "../db/index.js";
import { redisConnection } from "../config/redis.js";
import { SCAN_QUEUE_NAME } from "../queues/scan.queue.js";
import { Job } from "../models/job.js";
import { Project } from "../models/project.js";

dotenv.config({ path: "./.env" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const processScanJob = async (bullJob) => {
    const { projectId, repoUrl, repoBranch, jobRecordId } = bullJob.data;

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
        console.log(`[Job ${bullJob.id}] [${percent}%] ${message}`);
        await bullJob.updateProgress(percent);
        if (jobDoc) {
            await jobDoc.updateProgress(percent, message);
        }
    };

    try {
        if (jobDoc) {
            jobDoc.bullJobId = bullJob.id;
            await jobDoc.markActive();
        }

        await Project.findByIdAndUpdate(projectId, { status: "scanning" });

        await logStep(15, `Connecting to repository: ${repoUrl} (${repoBranch || "main"})`);
        await sleep(800);

        await logStep(40, "Fetching commits and inspecting repository tree...");
        await sleep(1000);

        await logStep(70, "Scanning files and parsing code structure...");
        await sleep(1200);

        await logStep(90, "Analyzing components and dependencies...");
        await sleep(800);

        await logStep(100, "Repository scan completed");

        if (jobDoc) {
            await jobDoc.markCompleted();
        }

        await Project.findByIdAndUpdate(projectId, { status: "indexed" });

        return { success: true, projectId };
    } catch (error) {
        console.error(`Error processing scan job ${bullJob.id}:`, error);

        if (jobDoc) {
            await jobDoc.markFailed(error.message);
        }

        await Project.findByIdAndUpdate(projectId, { status: "scan-failed" });

        throw error;
    }
};

export const initScannerWorker = () => {
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
        console.log(`Job ${job.id} completed`);
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

const isDirectRun = process.argv[1] && (
    process.argv[1].replace(/\\/g, "/").endsWith("scanner.worker.js")
);

if (isDirectRun) {
    connectDB()
        .then(() => initScannerWorker())
        .catch((err) => {
            console.error("Worker DB connection error:", err);
            process.exit(1);
        });
}

export default initScannerWorker;
