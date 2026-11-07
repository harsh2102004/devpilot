import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { loginSchema } from '../validators/auth.validator.js';

// Helper function to generate both tokens and save refresh token to user
const generateAccessAndRefereshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating access and refresh token");
    }
};

const loginUser = asyncHandler(async (req, res) => {
    // 1. Validate input strictly against Zod schema (prevents query injection objects)
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
        const errorMessage = validation.error.issues?.[0]?.message || "Invalid credentials format";
        throw new ApiError(400, errorMessage);
    }

    const { username, email, password } = validation.data;

    // 2. Query with normalized, lower-cased string identifiers
    const queryConditions = [];
    if (username) {
        queryConditions.push({ username: username.toLowerCase().trim() });
    }
    if (email) {
        queryConditions.push({ email: email.toLowerCase().trim() });
    }

    const user = await User.findOne({
        $or: queryConditions
    });

    // 3. User enumeration defense: return identical 401 response whether user exists or not
    if (!user) {
        throw new ApiError(401, "Invalid credentials");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    // 4. Issue session tokens
    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken,
                    token: accessToken
                },
                "User logged In Successfully"
            )
        );
});

export { loginUser, generateAccessAndRefereshTokens };
export default loginUser;
