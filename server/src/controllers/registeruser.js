import fs from 'fs';
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { registerSchema } from '../validators/auth.validator.js';
import { verifyImageMagicBytes } from '../middleware/multer.middleware.js';

const registerUser = asyncHandler(async (req, res) => {
    // 1. Zod input validation (strict types, format, bounds)
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
        // Clean up any uploaded avatar file if body validation fails
        const uploadedPath = req.files?.avatar?.[0]?.path || req.file?.path;
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            try {
                fs.unlinkSync(uploadedPath);
            } catch {}
        }
        const errorMessage = validation.error.issues?.[0]?.message || "Validation failed";
        throw new ApiError(400, errorMessage);
    }

    const { fullName, email, username, password } = validation.data;

    // 2. Check for duplicate user (case-insensitive username & email)
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    const existedUser = await User.findOne({
        $or: [{ username: normalizedUsername }, { email: normalizedEmail }]
    });

    if (existedUser) {
        // Clean up uploaded file if duplicate user
        const uploadedPath = req.files?.avatar?.[0]?.path || req.file?.path;
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            try {
                fs.unlinkSync(uploadedPath);
            } catch {}
        }
        throw new ApiError(400, "User with this username or email already exists");
    }

    // 3. Optional avatar handling with magic bytes verification
    let avatarLocalPath = req.files?.avatar?.[0]?.path || req.file?.path || "";

    if (avatarLocalPath) {
        const isValidImage = verifyImageMagicBytes(avatarLocalPath);
        if (!isValidImage) {
            if (fs.existsSync(avatarLocalPath)) {
                try {
                    fs.unlinkSync(avatarLocalPath);
                } catch {}
            }
            throw new ApiError(400, "Invalid file signature: Only legitimate PNG, JPEG, or WebP images are allowed");
        }
    }

    // 4. Create user in database
    const user = await User.create({
        fullName,
        username: normalizedUsername,
        avatar: avatarLocalPath || "",
        email: normalizedEmail,
        password
    });

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );

    if (!createdUser) {
        throw new ApiError(500, "User could not be created, please try again");
    }

    return res
        .status(201)
        .json(new ApiResponse(201, createdUser, "User registered successfully"));
});

export { registerUser };
export default registerUser;