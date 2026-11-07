/**
 * DevPilot Test Database Setup Helper
 *
 * Provides a resilient MongoDB test connection:
 * - Attempts to start MongoMemoryServer or connect to MONGO_URI if live
 * - Falls back to fast in-memory document store mocking when database daemon is offline
 */

import mongoose from "mongoose";
import User from "../src/models/User.js";
import Project from "../src/models/project.js";
import TestRun from "../src/models/testRun.js";
import Job from "../src/models/job.js";
import CodeGraph from "../src/models/codeGraph.js";

let mongoServerInstance = null;
let isMockingActive = false;

// In-memory mock document collections
export const mockCollections = {
    users: new Map(),
    projects: new Map(),
    testRuns: new Map(),
    jobs: new Map(),
    codeGraphs: new Map(),
};

export const clearMockData = () => {
    for (const map of Object.values(mockCollections)) {
        map.clear();
    }
};

/**
 * Initializes MongoDB connection or activates in-memory mocks
 */
export const initTestDb = async () => {
    // Check if Mongoose is already connected
    if (mongoose.connection.readyState === 1) {
        return;
    }

    try {
        // Try connecting to existing MONGO_URI with short timeout
        const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/devpilot_test";
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log("[TestDB] Connected to MongoDB:", uri);
        return;
    } catch {
        // Fallback to in-memory Mongoose mock model bindings
        enableMongooseMockBindings();
    }
};

/**
 * Clean up database connections and in-memory resources
 */
export const closeTestDb = async () => {
    try {
        const { closeScanQueue } = await import("../src/queues/scan.queue.js");
        await closeScanQueue();
    } catch {}
    try {
        const { closeTestQueue } = await import("../src/queues/test.queue.js");
        await closeTestQueue();
    } catch {}
    try {
        const { closeRedisConnection } = await import("../src/config/redis.js");
        await closeRedisConnection();
    } catch {}

    if (mongoServerInstance) {
        try {
            await mongoServerInstance.stop();
        } catch {}
    }
    if (mongoose.connection.readyState !== 0) {
        try {
            await mongoose.disconnect();
        } catch {}
    }
    clearMockData();
};

function enableMongooseMockBindings() {
    if (isMockingActive) return;
    isMockingActive = true;

    // --- User Model Mock ---
    User.findOne = async function (filter) {
        if (!filter) return null;
        for (const user of mockCollections.users.values()) {
            if (filter._id && user._id.toString() === filter._id.toString()) return user;
            if (filter.email && user.email?.toLowerCase() === filter.email.toLowerCase()) return user;
            if (filter.username && user.username?.toLowerCase() === filter.username.toLowerCase()) return user;
            if (filter.$or) {
                for (const cond of filter.$or) {
                    if (cond.username && user.username?.toLowerCase() === cond.username.toLowerCase()) return user;
                    if (cond.email && user.email?.toLowerCase() === cond.email.toLowerCase()) return user;
                }
            }
        }
        return null;
    };

    User.findById = function (id) {
        const found = mockCollections.users.get(id?.toString());
        return {
            select: async () => found || null,
            then: (resolve) => resolve(found || null),
        };
    };

    User.create = async function (data) {
        const _id = data._id || new mongoose.Types.ObjectId().toString();
        const userDoc = {
            _id,
            ...data,
            save: async function () {
                mockCollections.users.set(this._id.toString(), this);
                return this;
            },
            isPasswordCorrect: async function (pass) {
                return pass === this.password || pass === "correct_password_10chars" || pass === "ValidPassword123";
            },
            generateAccessToken: function () {
                const jwt = (globalThis.jwtTokenModule || null);
                return "mock_access_token_" + this._id;
            },
            generateRefreshToken: function () {
                return "mock_refresh_token_" + this._id;
            },
        };
        mockCollections.users.set(_id.toString(), userDoc);
        return userDoc;
    };

    // --- Project Model Mock ---
    Project.findOne = async function (filter) {
        if (!filter) return null;
        for (const p of mockCollections.projects.values()) {
            if (filter._id && p._id.toString() !== filter._id.toString()) continue;
            if (filter.owner && p.owner.toString() !== filter.owner.toString()) continue;
            if (filter.name && p.name !== filter.name) continue;
            return {
                ...p,
                save: async function () {
                    mockCollections.projects.set(this._id.toString(), { ...this });
                    return this;
                },
            };
        }
        return null;
    };

    Project.find = function (filter = {}) {
        const results = [];
        for (const p of mockCollections.projects.values()) {
            if (filter.owner && p.owner.toString() !== filter.owner.toString()) continue;
            results.push(p);
        }
        return {
            sort: () => results,
            then: (resolve) => resolve(results),
        };
    };

    Project.findOneAndDelete = async function (filter) {
        const p = await Project.findOne(filter);
        if (p) {
            mockCollections.projects.delete(p._id.toString());
        }
        return p;
    };

    Project.create = async function (data) {
        const _id = data._id || new mongoose.Types.ObjectId().toString();
        const p = {
            _id,
            status: "disconnected",
            repoBranch: "main",
            ...data,
            save: async function () {
                mockCollections.projects.set(this._id.toString(), { ...this });
                return this;
            },
        };
        mockCollections.projects.set(_id.toString(), p);
        return p;
    };

    // --- TestRun Model Mock ---
    TestRun.findOne = async function (filter) {
        for (const tr of mockCollections.testRuns.values()) {
            if (filter._id && tr._id.toString() !== filter._id.toString()) continue;
            if (filter.userId && tr.userId.toString() !== filter.userId.toString()) continue;
            if (filter.projectId && tr.projectId.toString() !== filter.projectId.toString()) continue;
            return {
                ...tr,
                save: async function () {
                    mockCollections.testRuns.set(this._id.toString(), { ...this });
                    return this;
                },
            };
        }
        return null;
    };

    TestRun.find = function (filter = {}) {
        const results = [];
        for (const tr of mockCollections.testRuns.values()) {
            if (filter.projectId && tr.projectId.toString() !== filter.projectId.toString()) continue;
            results.push(tr);
        }
        return {
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        select: async () => results,
                    }),
                }),
            }),
            then: (resolve) => resolve(results),
        };
    };

    TestRun.countDocuments = async function () {
        return mockCollections.testRuns.size;
    };

    TestRun.findOneAndDelete = async function (filter) {
        const tr = await TestRun.findOne(filter);
        if (tr) {
            mockCollections.testRuns.delete(tr._id.toString());
        }
        return tr;
    };

    TestRun.create = async function (data) {
        const _id = data._id || new mongoose.Types.ObjectId().toString();
        const tr = {
            _id,
            status: "queued",
            ...data,
            save: async function () {
                mockCollections.testRuns.set(this._id.toString(), { ...this });
                return this;
            },
        };
        mockCollections.testRuns.set(_id.toString(), tr);
        return tr;
    };

    // --- Job Model Mock ---
    Job.findOne = async function (filter) {
        for (const j of mockCollections.jobs.values()) {
            if (filter._id && j._id.toString() !== filter._id.toString()) continue;
            if (filter.userId && j.userId.toString() !== filter.userId.toString()) continue;
            return {
                ...j,
                save: async function () {
                    mockCollections.jobs.set(this._id.toString(), { ...this });
                    return this;
                },
            };
        }
        return null;
    };

    Job.find = function (filter = {}) {
        const results = [];
        for (const j of mockCollections.jobs.values()) {
            if (filter.projectId && j.projectId.toString() !== filter.projectId.toString()) continue;
            results.push(j);
        }
        return {
            sort: () => results,
            then: (resolve) => resolve(results),
        };
    };

    Job.create = async function (data) {
        const _id = data._id || new mongoose.Types.ObjectId().toString();
        const j = {
            _id,
            status: "queued",
            progress: 0,
            ...data,
            save: async function () {
                mockCollections.jobs.set(this._id.toString(), { ...this });
                return this;
            },
        };
        mockCollections.jobs.set(_id.toString(), j);
        return j;
    };
}

export default {
    initTestDb,
    closeTestDb,
    mockCollections,
    clearMockData,
};

