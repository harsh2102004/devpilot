import mongoose from "mongoose";

const failureItemSchema = new mongoose.Schema(
    {
        testTitle: {
            type: String,
            required: true,
            trim: true,
        },
        suiteName: {
            type: String,
            default: "",
            trim: true,
        },
        filePath: {
            type: String,
            default: "",
            trim: true,
        },
        line: {
            type: Number,
            default: 0,
        },
        column: {
            type: Number,
            default: 0,
        },
        errorName: {
            type: String,
            default: "AssertionError",
            trim: true,
        },
        errorMessage: {
            type: String,
            default: "",
        },
        stackTrace: {
            type: String,
            default: "",
        },
        codeSnippet: {
            type: String,
            default: "",
        },
    },
    { _id: true }
);

const testRunSchema = new mongoose.Schema(
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
        jobId: {
            type: String,
            default: "",
        },
        jobRecordId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Job",
            default: null,
        },
        status: {
            type: String,
            enum: ["queued", "running", "passed", "failed", "timed_out", "error"],
            default: "queued",
            index: true,
        },
        trigger: {
            type: String,
            enum: ["manual", "ai-debug", "webhook"],
            default: "manual",
        },
        environment: {
            type: String,
            enum: ["docker", "local-process"],
            default: "local-process",
        },
        runtime: {
            type: String,
            default: "node",
        },
        runner: {
            type: String,
            default: "generic",
        },
        testCommand: {
            type: String,
            default: "",
        },
        summary: {
            total: { type: Number, default: 0 },
            passed: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
            skipped: { type: Number, default: 0 },
            durationMs: { type: Number, default: 0 },
            exitCode: { type: Number, default: 0 },
        },
        failures: {
            type: [failureItemSchema],
            default: [],
        },
        rawOutput: {
            type: String,
            default: "",
        },
        startedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// Method to mark test run as currently running in sandbox
testRunSchema.methods.markRunning = async function () {
    this.status = "running";
    this.startedAt = new Date();
    return await this.save();
};

// Method to mark test run as finished with parsed report
testRunSchema.methods.markFinished = async function ({
    success = false,
    timedOut = false,
    summary = {},
    failures = [],
    rawOutput = "",
    environment = "local-process",
    runtime = "node",
    runner = "generic",
}) {
    if (timedOut) {
        this.status = "timed_out";
    } else if (success) {
        this.status = "passed";
    } else {
        this.status = "failed";
    }

    this.environment = environment;
    this.runtime = runtime;
    this.runner = runner;
    this.summary = {
        total: summary.total ?? 0,
        passed: summary.passed ?? 0,
        failed: summary.failed ?? 0,
        skipped: summary.skipped ?? 0,
        durationMs: summary.durationMs ?? 0,
        exitCode: summary.exitCode ?? 0,
    };
    this.failures = failures;

    // Safety truncation on raw output if exceeding 2MB
    const MAX_STORED_OUTPUT_BYTES = 2 * 1024 * 1024;
    this.rawOutput = rawOutput.length > MAX_STORED_OUTPUT_BYTES
        ? rawOutput.slice(0, MAX_STORED_OUTPUT_BYTES) + "\n... [Logs truncated at 2MB limit]"
        : rawOutput;

    this.completedAt = new Date();
    return await this.save();
};

// Method to mark test run as errored
testRunSchema.methods.markError = async function (errorMessage = "Unexpected execution error") {
    this.status = "error";
    this.completedAt = new Date();
    this.rawOutput = (this.rawOutput ? this.rawOutput + "\n" : "") + `Execution Error: ${errorMessage}`;
    return await this.save();
};

export const TestRun = mongoose.model("TestRun", testRunSchema);
export default TestRun;
