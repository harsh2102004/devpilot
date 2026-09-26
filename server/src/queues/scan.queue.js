import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";

export const SCAN_QUEUE_NAME = "scan-queue";

export const scanQueue = new Queue(SCAN_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: {
            age: 24 * 60 * 60,
            count: 1000,
        },
        removeOnFail: {
            age: 7 * 24 * 60 * 60,
            count: 5000,
        },
    },
});

export const scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, {
    connection: redisConnection,
});

scanQueueEvents.on("waiting", ({ jobId }) => {
    console.log(`[Queue] Job ${jobId} waiting`);
});

scanQueueEvents.on("active", ({ jobId }) => {
    console.log(`[Queue] Job ${jobId} started`);
});

scanQueueEvents.on("progress", ({ jobId, data }) => {
    console.log(`[Queue] Job ${jobId} progress: ${data}%`);
});

scanQueueEvents.on("completed", ({ jobId }) => {
    console.log(`[Queue] Job ${jobId} completed`);
});

scanQueueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[Queue] Job ${jobId} failed: ${failedReason}`);
});

export const addScanJob = async ({ projectId, userId, repoUrl, repoBranch = "main", jobRecordId }) => {
    if (!projectId || !repoUrl) {
        throw new ApiError(400, "projectId and repoUrl are required to enqueue a scan job");
    }

    const jobName = `scan-${projectId}-${Date.now()}`;

    const job = await scanQueue.add(
        jobName,
        {
            projectId,
            userId,
            repoUrl,
            repoBranch,
            jobRecordId,
            enqueuedAt: new Date().toISOString(),
        },
        {
            jobId: jobName,
        }
    );

    return job;
};
