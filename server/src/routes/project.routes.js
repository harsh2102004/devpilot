import express from 'express';
import {
    createProject,
    getUserProjects,
    getProjectById,
    updateProject,
    deleteProject
} from '../controllers/project.controller.js';
import { linkRepoToProject } from '../controllers/github.controller.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Apply auth middleware to ALL routes in this router!
router.use(auth);

// /api/projects
router.route('/')
    .get(getUserProjects)
    .post(createProject);

// /api/projects/:projectId/link-repo (Task 4)
router.route('/:projectId/link-repo')
    .post(linkRepoToProject);

// /api/projects/:projectId
router.route('/:projectId')
    .get(getProjectById)
    .patch(updateProject)
    .delete(deleteProject);

export default router;
