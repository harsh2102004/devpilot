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


}, { timestamps: true })

export const Project = mongoose.model('Project', projectSchema)
export default Project