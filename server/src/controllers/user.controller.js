import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

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
        .json(new ApiResponse(200, {}, "User logged out successfully"));
});

export { getCurrentUser, logoutUser };
