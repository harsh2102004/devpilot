import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { encryptToken, decryptToken, isEncryptedToken } from '../services/tokenEncryption.service.js';

const userSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            trim: true
        },
        name: {
            type: String,
            trim: true
        },
        username: {
            type: String,
            lowercase: true,
            trim: true,
            index: true
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true
        },
        password: {
            type: String,
            required: [true, 'Password is required']
        },
        avatar: {
            type: String,
            default: ""
        },
        refreshToken: {
            type: String
        },
        githubAccessToken: {
            type: String,
            select: false
        },
        githubUsername: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

// Hash password before saving if modified
userSchema.pre("save", async function () {
    if (this.isModified("password") && this.password) {
        this.password = await bcrypt.hash(this.password, 10);
    }

    // Encrypt githubAccessToken using AES-256-GCM before saving to MongoDB (Task 4)
    if (this.isModified("githubAccessToken") && this.githubAccessToken) {
        if (!isEncryptedToken(this.githubAccessToken)) {
            this.githubAccessToken = encryptToken(this.githubAccessToken);
        }
    }
});

// Compare password method
userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};

// Decrypt GitHub Access Token for internal service execution
userSchema.methods.getDecryptedGitHubToken = function () {
    if (!this.githubAccessToken) return null;
    return decryptToken(this.githubAccessToken);
};

// Generate access token
userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            user: {
                id: this._id,
                email: this.email,
                name: this.fullName || this.name || this.username
            }
        },
        env.ACCESS_TOKEN_SECRET,
        { expiresIn: env.ACCESS_TOKEN_EXPIRY || '1d' }
    );
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        {
            _id: this._id
        },
        env.REFRESH_TOKEN_SECRET,
        { expiresIn: env.REFRESH_TOKEN_EXPIRY || '10d' }
    );
};

const User = mongoose.model("User", userSchema);

export { User };
export default User;


