import { Router } from "express";
import { auth } from "../middleware/auth.js";
import {
    startScan,
    getjobstatus,
    getprojectscanhistory
} from "../controllers/scan.controller.js";

const router = Router();

// Protect all scan routes with JWT auth middleware
router.use(auth);

// POST /api/scan/:projectId - Trigger a repository scan
router.post("/:projectId", startScan);

// GET /api/scan/job/:jobId - Poll job status, progress & logs
router.get("/job/:jobId", getjobstatus);

// GET /api/scan/project/:projectId - View scan history for a project
router.get("/project/:projectId", getprojectscanhistory);

export default router;
