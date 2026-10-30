import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";

export const SCAN_QUEUE_NAME = "scan-queue";

let _scanQueue = null;
let _scanQueueEvents = null;

export const getScanQueue = () => {
    if (!_scanQueue) {
        _scanQueue = new Queue(SCAN_QUEUE_NAME, {
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
    }
    return _scanQueue;
};

export const getScanQueueEvents = () => {
    if (!_scanQueueEvents) {
        _scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, {
            connection: redisConnection,
        });

        _scanQueueEvents.on("waiting", ({ jobId }) => {
            console.log(`[Queue] Job ${jobId} waiting`);
        });

        _scanQueueEvents.on("active", ({ jobId }) => {
            console.log(`[Queue] Job ${jobId} started`);
        });

        _scanQueueEvents.on("progress", ({ jobId, data }) => {
            console.log(`[Queue] Job ${jobId} progress: ${data}%`);
        });

        _scanQueueEvents.on("completed", ({ jobId }) => {
            console.log(`[Queue] Job ${jobId} completed`);
        });

        _scanQueueEvents.on("failed", ({ jobId, failedReason }) => {
            console.error(`[Queue] Job ${jobId} failed: ${failedReason}`);
        });
    }
    return _scanQueueEvents;
};

// Export getters / proxies for backward compatibility
export const scanQueue = {
    add: (...args) => getScanQueue().add(...args),
};
export const scanQueueEvents = {
    on: (...args) => getScanQueueEvents().on(...args),
};


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
