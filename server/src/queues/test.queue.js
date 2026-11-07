import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";

export const TEST_QUEUE_NAME = "test-queue";

let _testQueue = null;
let _testQueueEvents = null;

/**
 * Lazy initialization of the BullMQ test queue
 * @returns {Queue}
 */
export const getTestQueue = () => {
    if (!_testQueue) {
        _testQueue = new Queue(TEST_QUEUE_NAME, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 2,
                backoff: {
                    type: "exponential",
                    delay: 5000,
                },
                removeOnComplete: {
                    age: 24 * 60 * 60, // retain completed for 24h
                    count: 1000,
                },
                removeOnFail: {
                    age: 7 * 24 * 60 * 60, // retain failed for 7 days
                    count: 5000,
                },
            },
        });
    }
    return _testQueue;
};

/**
 * Lazy initialization of QueueEvents observer for test lifecycle
 * @returns {QueueEvents}
 */
export const getTestQueueEvents = () => {
    if (!_testQueueEvents) {
        _testQueueEvents = new QueueEvents(TEST_QUEUE_NAME, {
            connection: redisConnection,
        });

        _testQueueEvents.on("waiting", ({ jobId }) => {
            console.log(`[TestQueue] Job ${jobId} waiting in queue`);
        });

        _testQueueEvents.on("active", ({ jobId }) => {
            console.log(`[TestQueue] Job ${jobId} active / started`);
        });

        _testQueueEvents.on("progress", ({ jobId, data }) => {
            console.log(`[TestQueue] Job ${jobId} progress: ${data}%`);
        });

        _testQueueEvents.on("completed", ({ jobId }) => {
            console.log(`[TestQueue] Job ${jobId} successfully completed`);
        });

        _testQueueEvents.on("failed", ({ jobId, failedReason }) => {
            console.error(`[TestQueue] Job ${jobId} failed: ${failedReason}`);
        });
    }
    return _testQueueEvents;
};

export const closeTestQueue = async () => {
    if (_testQueue) {
        try { await _testQueue.close(); } catch {}
        _testQueue = null;
    }
    if (_testQueueEvents) {
        try { await _testQueueEvents.close(); } catch {}
        _testQueueEvents = null;
    }
};

// Export getters / proxies for modularity and testing
export const testQueue = {
    add: (...args) => getTestQueue().add(...args),
};

export const testQueueEvents = {
    on: (...args) => getTestQueueEvents().on(...args),
};

/**
 * Enqueues a new sandboxed test execution job
 *
 * @param {object} params
 * @param {string} params.projectId - Target project ID
 * @param {string} params.userId - Initiating user ID
 * @param {string} [params.repoUrl] - Project repository URL or local path
 * @param {string} [params.repoBranch="main"] - Repository branch
 * @param {string} [params.testRunId] - Associated TestRun record ID
 * @param {string} [params.jobRecordId] - Associated Job record ID
 * @param {string} [params.testCommand] - Custom test command override (optional)
 * @param {number} [params.timeoutMs=60000] - Hard execution timeout in milliseconds
 * @param {boolean} [params.preferDocker=true] - Attempt Docker container if available
 * @param {boolean} [params.readOnly=false] - Mount workspace as read-only
 * @returns {Promise<import("bullmq").Job>}
 */
export const addTestJob = async ({
    projectId,
    userId,
    repoUrl,
    repoBranch = "main",
    testRunId = null,
    jobRecordId = null,
    testCommand = null,
    timeoutMs = 60000,
    preferDocker = true,
    readOnly = false,
}) => {
    if (!projectId) {
        throw new ApiError(400, "projectId is required to enqueue a test execution job");
    }

    const jobName = `test-${projectId}-${Date.now()}`;

    const job = await testQueue.add(
        jobName,
        {
            projectId,
            userId,
            repoUrl,
            repoBranch,
            testRunId,
            jobRecordId,
            testCommand,
            timeoutMs,
            preferDocker,
            readOnly,
            enqueuedAt: new Date().toISOString(),
        },
        {
            jobId: jobName,
        }
    );

    return job;
};

export default {
    TEST_QUEUE_NAME,
    getTestQueue,
    getTestQueueEvents,
    testQueue,
    testQueueEvents,
    addTestJob,
};
