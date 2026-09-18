import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";

// ─────────────────────────────────────────────────────────────────────
// WHAT IS A QUEUE?
//   A Queue is the PRODUCER side of BullMQ.
//   It adds jobs into Redis. Think of it as a POST box — you drop a
//   letter (job) in. The Worker (consumer) picks it up and processes it.
//
// QUEUE NAME: "scan-queue"
//   The Worker MUST use the exact same name to subscribe to this queue.
// ─────────────────────────────────────────────────────────────────────

export const SCAN_QUEUE_NAME = "scan-queue";

export const scanQueue = new Queue(SCAN_QUEUE_NAME, {
    connection: redisConnection,

    defaultJobOptions: {
        // Retry a failed job up to 3 times before marking it as "failed"
        attempts: 3,

        // EXPONENTIAL BACKOFF:
        // If job fails -> wait 5s, then 10s, then 20s before retrying.
        // This prevents hammering GitHub API or Redis if there's a glitch.
        backoff: {
            type: "exponential",
            delay: 5000,
        },

        // Auto-clean completed jobs from Redis after 24h.
        // We keep the data in MongoDB, so we don't need it in Redis forever.
        removeOnComplete: {
            age: 24 * 60 * 60, // 24 hours in seconds
            count: 1000,        // Never store more than 1000 completed jobs in Redis
        },

        // Keep failed jobs for 7 days so we can inspect and debug them.
        removeOnFail: {
            age: 7 * 24 * 60 * 60, // 7 days in seconds
            count: 5000,
        },
    },
});

// ─────────────────────────────────────────────────────────────────────
// QueueEvents: Remote observer for job lifecycle changes.
//
// WHY DO WE NEED THIS?
//   The Worker process runs separately from the API server.
//   The API server doesn't know when a job finishes unless it listens
//   to Redis pub/sub events — QueueEvents does exactly that.
//
//   We use this to:
//   1. Update the Job document in MongoDB when status changes
//   2. Update the Project status (scanning -> indexed / scan-failed)
// ─────────────────────────────────────────────────────────────────────

export const scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, {
    connection: redisConnection,
});

// Log lifecycle events in the API server for observability
scanQueueEvents.on("waiting", ({ jobId }) => {
    console.log(`📥 [Queue] Job ${jobId} is waiting in the queue`);
});

scanQueueEvents.on("active", ({ jobId }) => {
    console.log(`⚙️  [Queue] Job ${jobId} has started processing`);
});

scanQueueEvents.on("progress", ({ jobId, data }) => {
    console.log(`📊 [Queue] Job ${jobId} progress: ${data}%`);
});

scanQueueEvents.on("completed", ({ jobId }) => {
    console.log(`✅ [Queue] Job ${jobId} completed successfully`);
});

scanQueueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`❌ [Queue] Job ${jobId} failed: ${failedReason}`);
});

// ─────────────────────────────────────────────────────────────────────
// PRODUCER HELPER: addScanJob()
//
// Called by the scan controller (POST /api/scan/:projectId) to enqueue
// a new repository scan job. Returns the BullMQ Job object so we can
// get its ID and save it to MongoDB.
// ─────────────────────────────────────────────────────────────────────

/**
 * Add a repository scan job to the BullMQ scan queue
 *
 * @param {Object} payload
 * @param {string} payload.projectId    - MongoDB Project _id
 * @param {string} payload.userId       - MongoDB User _id (for ownership)
 * @param {string} payload.repoUrl      - GitHub repository URL to scan
 * @param {string} payload.repoBranch   - Branch to scan (default: 'main')
 * @param {string} payload.jobRecordId  - MongoDB Job document _id (for cross-referencing)
 * @returns {Promise<import("bullmq").Job>}
 */
export const addScanJob = async ({ projectId, userId, repoUrl, repoBranch = "main", jobRecordId }) => {
    if (!projectId || !repoUrl) {
        throw new ApiError(400, "projectId and repoUrl are required to enqueue a scan job");
    }

    // Unique job name: scan-<projectId>-<timestamp>
    // Using timestamp ensures no duplicate jobId if same project is scanned twice
    const jobName = `scan-${projectId}-${Date.now()}`;

    const job = await scanQueue.add(
        jobName,
        // This is the JOB DATA — available as `job.data` inside the Worker
        {
            projectId,
            userId,
            repoUrl,
            repoBranch,
            jobRecordId,
            enqueuedAt: new Date().toISOString(),
        },
        // Override options per-job if needed
        {
            jobId: jobName,
        }
    );

    console.log(`📥 [Queue] Scan job enqueued: ${job.id} for project ${projectId}`);
    return job;
};
