import express from 'express';
import { registerUser } from '../controllers/registeruser.js';
import { loginUser } from '../controllers/loginuser.js';
import { getCurrentUser, logoutUser, revokeAllSessions } from '../controllers/user.controller.js';
import { auth } from '../middleware/auth.js';
import { upload } from '../middleware/multer.middleware.js';

const router = express.Router();

// Register with Multer avatar upload support
router.route('/register').post(
    upload.fields([
        {
            name: "avatar",
            maxCount: 1
        }
    ]),
    registerUser
);

// Login
router.route('/login').post(loginUser);

// Current user profile
router.route('/me').get(auth, getCurrentUser);

// Logout (revokes access token and refresh token)
router.route('/logout').post(auth, logoutUser);

// Revoke all active user sessions (Sub-Phase 10B)
router.route('/revoke-all').post(auth, revokeAllSessions);

export default router;
export { router };
