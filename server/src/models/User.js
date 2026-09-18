import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

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
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 10);
});

// Compare password method
userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
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
        process.env.ACCESS_TOKEN_SECRET || 'fallback_secret',
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d' }
    );
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        {
            _id: this._id
        },
        process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_secret',
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '10d' }
    );
};

const User = mongoose.model("User", userSchema);

export { User };
export default User;


