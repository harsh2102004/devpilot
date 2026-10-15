import mongoose from "mongoose";

const codeGraphStatsSchema = new mongoose.Schema(
    {
        totalFilesScanned: { type: Number, default: 0 },
        codeFilesParsed: { type: Number, default: 0 },
        totalNodes: { type: Number, default: 0 },
        totalEdges: { type: Number, default: 0 },
        functionsFound: { type: Number, default: 0 },
        classesFound: { type: Number, default: 0 },
    },
    { _id: false }
);

const codeGraphSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Job",
            default: null,
        },
        nodes: {
            type: Array,
            default: [],
        },
        edges: {
            type: Array,
            default: [],
        },
        stats: {
            type: codeGraphStatsSchema,
            default: () => ({}),
        },
    },
    { timestamps: true }
);

export const CodeGraph = mongoose.model("CodeGraph", codeGraphSchema);
export default CodeGraph;
