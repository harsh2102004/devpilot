import mongoose from "mongoose";

const logEntrySchema = new mongoose.Schema(
    {
        level: {
            type: String,
            enum: ["info", "warn", "error", "success"],
            default: "info",
        },
        message: {
            type: String,
            required: true,
        },
        timestamp: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

const jobSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ["scan", "ast-parse", "test-run", "ai-fix"],
            default: "scan",
        },
        status: {
            type: String,
            enum: ["queued", "active", "completed", "failed"],
            default: "queued",
        },
        progress: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        bullJobId: {
            type: String,
            default: "",
        },
        logs: {
            type: [logEntrySchema],
            default: [],
        },
        error: {
            type: String,
            default: null,
        },
        startedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        codeGraph: {
            stats: {
                totalFilesScanned: { type: Number, default: 0 },
                codeFilesParsed: { type: Number, default: 0 },
                totalNodes: { type: Number, default: 0 },
                totalEdges: { type: Number, default: 0 },
                functionsFound: { type: Number, default: 0 },
                classesFound: { type: Number, default: 0 },
            },
            nodesCount: { type: Number, default: 0 },
            edgesCount: { type: Number, default: 0 },
            graphId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "CodeGraph",
                default: null,
            },
        },
    },
    { timestamps: true }
);

jobSchema.methods.markActive = async function () {
    this.status = "active";
    this.startedAt = new Date();
    this.logs.push({ level: "info", message: "Scan job started" });
    return this.save();
};

jobSchema.methods.updateProgress = async function (percent, message) {
    this.progress = Math.min(Math.max(percent, 0), 100);
    if (message) {
        this.logs.push({ level: "info", message });
    }
    return this.save();
};

jobSchema.methods.markCompleted = async function (codeGraphData) {
    this.status = "completed";
    this.progress = 100;
    this.completedAt = new Date();
    if (codeGraphData?.stats) {
        this.codeGraph = {
            stats: codeGraphData.stats,
            nodesCount: codeGraphData.nodes?.length || codeGraphData.stats.totalNodes || 0,
            edgesCount: codeGraphData.edges?.length || codeGraphData.stats.totalEdges || 0,
            graphId: codeGraphData.graphId || codeGraphData._id || null,
        };
    }
    this.logs.push({ level: "success", message: "Scan completed successfully" });
    return this.save();
};

jobSchema.methods.markFailed = async function (errorMessage) {
    this.status = "failed";
    this.completedAt = new Date();
    this.error = errorMessage || "Scan failed";
    this.logs.push({ level: "error", message: `Scan failed: ${this.error}` });
    return this.save();
};

export const Job = mongoose.model("Job", jobSchema);
export default Job;
