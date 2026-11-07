import express from 'express';
import {
    connectGitHub,
    getGitHubStatus,
    getUserRepositories,
    getRepoBranches,
} from '../controllers/github.controller.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// All GitHub routes require authentication
router.use(auth);

// POST /api/github/connect
router.post('/connect', connectGitHub);

// GET /api/github/status
router.get('/status', getGitHubStatus);

// GET /api/github/repos
router.get('/repos', getUserRepositories);

// GET /api/github/repos/:owner/:repo/branches
router.get('/repos/:owner/:repo/branches', getRepoBranches);

export default router;

