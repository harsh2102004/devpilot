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
import { validateObjectId } from '../middleware/validateObjectId.js';

const router = express.Router();

// Apply auth middleware to ALL routes in this router!
router.use(auth);

// /api/projects
router.route('/')
    .get(getUserProjects)
    .post(createProject);

// /api/projects/:projectId/link-repo (Task 4 & Task 6)
router.route('/:projectId/link-repo')
    .post(validateObjectId('projectId'), linkRepoToProject);

// /api/projects/:projectId (Task 6: validateObjectId validates MongoDB ObjectId)
router.route('/:projectId')
    .get(validateObjectId('projectId'), getProjectById)
    .patch(validateObjectId('projectId'), updateProject)
    .delete(validateObjectId('projectId'), deleteProject);

export default router;
