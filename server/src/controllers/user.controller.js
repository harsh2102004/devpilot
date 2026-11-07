import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { revokeToken, revokeAllUserTokens } from '../services/tokenRevocation.service.js';

const getCurrentUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select("-password -refreshToken");
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    return res.status(200).json(
        new ApiResponse(200, { user }, "Current user fetched successfully")
    );
});

const logoutUser = asyncHandler(async (req, res) => {
    // 1. Revoke the active JWT access token so it cannot be used again
    if (req.token) {
        await revokeToken({ token: req.token });
    }

    // 2. Unset refresh token in DB
    if (req.user?.id) {
        await User.findByIdAndUpdate(
            req.user.id,
            {
                $unset: { refreshToken: 1 }
            },
            { new: true }
        );
    }

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    };

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, { revoked: true }, "User logged out successfully and token revoked"));
});

const revokeAllSessions = asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    // Invalidate all tokens issued before now
    await revokeAllUserTokens(userId);

    // Unset refresh token in database
    await User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });

    return res.status(200).json(
        new ApiResponse(200, { userId, revokedAt: new Date().toISOString() }, "All user sessions revoked successfully")
    );
});

export { getCurrentUser, logoutUser, revokeAllSessions };
