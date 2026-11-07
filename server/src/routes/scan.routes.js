import express from 'express';
import { auth } from '../middleware/auth.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import {
    getprojectscanhistory,
    getjobstatus,
    startScan,
    getProjectCodeGraph,
    searchProjectCode,
} from '../controllers/scan.controller.js';

const router = express.Router();

// Task 6: validateObjectId middleware on every :projectId / :jobId route
router.post("/:projectId", auth, validateObjectId("projectId"), startScan);
router.get("/job/:jobId", auth, validateObjectId("jobId"), getjobstatus);
router.get("/project/:projectId", auth, validateObjectId("projectId"), getprojectscanhistory);
router.get("/project/:projectId/graph", auth, validateObjectId("projectId"), getProjectCodeGraph);
router.post("/project/:projectId/search", auth, validateObjectId("projectId"), searchProjectCode);

export default router;
  