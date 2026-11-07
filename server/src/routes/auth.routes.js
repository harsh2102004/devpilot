import express from 'express';
import path from 'path';
import fs from 'fs';
import { registerUser } from '../controllers/registeruser.js';
import { loginUser } from '../controllers/loginuser.js';
import { getCurrentUser, logoutUser, revokeAllSessions } from '../controllers/user.controller.js';
import { auth } from '../middleware/auth.js';
import { uploadAvatarMiddleware } from '../middleware/multer.middleware.js';
import { ApiError } from '../utils/ApiError.js';

const router = express.Router();

// Register with secure avatar upload middleware (optional avatar, fileFilter, size limit)
router.route('/register').post(
    uploadAvatarMiddleware,
    registerUser
);

// Login (strict validation against query injection, unified 401 error message)
router.route('/login').post(loginUser);

// Controlled avatar serving endpoint with path traversal protection
router.route('/avatar/:filename').get((req, res, next) => {
    const safeFilename = path.basename(req.params.filename || '');
    if (!safeFilename || safeFilename.startsWith('.')) {
        return next(new ApiError(400, "Invalid avatar filename"));
    }
    const avatarPath = path.resolve('./uploads/avatars', safeFilename);
    if (!fs.existsSync(avatarPath)) {
        return next(new ApiError(404, "Avatar not found"));
    }
    return res.sendFile(avatarPath);
});

// Current user profile
router.route('/me').get(auth, getCurrentUser);

// Logout (revokes access token and refresh token)
router.route('/logout').post(auth, logoutUser);

// Revoke all active user sessions (Sub-Phase 10B)
router.route('/revoke-all').post(auth, revokeAllSessions);

export default router;
export { router };
