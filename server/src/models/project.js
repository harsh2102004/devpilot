import mongoose from "mongoose";
import { isValidRepoUrl, isValidRepoBranch } from "../services/repoCloner.service.js";

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
        validate: {
            validator: function (v) {
                if (!v || v === "") return true;
                return isValidRepoUrl(v);
            },
            message: (props) => `Invalid repository URL "${props.value}". Only GitHub repositories (https://github.com/<owner>/<repo> or <owner>/<repo>) are permitted.`
        },
        match: [
            /^(?:$|https:\/\/github\.com\/[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\.git)?\/?|[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\.git)?)$/,
            "Invalid repository URL format"
        ],
    },
    repoBranch: {
        type: String,
        default: "main",
        trim: true,
        validate: {
            validator: function (v) {
                if (!v || v === "") return true;
                return isValidRepoBranch(v);
            },
            message: (props) => `Invalid branch name "${props.value}". Must match /^[A-Za-z0-9._\\/-]{1,100}$/ and cannot start with '-'.`
        },
        match: [
            /^(?!-)[A-Za-z0-9._\/-]{1,100}$/,
            "Invalid branch name format"
        ],
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
    vectorStats: {
        totalChunksIndexed: { type: Number, default: 0 },
        vectorNamespace: { type: String, default: "" },
        lastIndexedAt: { type: Date, default: null },
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