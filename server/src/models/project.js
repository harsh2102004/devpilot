import mongoose from "mongoose";


const projectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    repoUrl: {
        type: String,
        trim: true,
        default: "",
    },
    repoBranch: {
        type: String,
        default: "main",
    },
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'scanning', 'indexed', 'scan-failed'],
        default: 'disconnected',
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    codeGraphStats: {
        totalFilesScanned: { type: Number, default: 0 },
        codeFilesParsed: { type: Number, default: 0 },
        totalNodes: { type: Number, default: 0 },
        totalEdges: { type: Number, default: 0 },
        functionsFound: { type: Number, default: 0 },
        classesFound: { type: Number, default: 0 },
    },
    codeGraph: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CodeGraph',
        default: null,
    },
    lastScannedAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true })

export const Project = mongoose.model('Project', projectSchema)
export default Project