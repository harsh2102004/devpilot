import express from "express";
import { auth } from "../middleware/auth.js";
import {
    runProjectTests,
    getProjectTestRuns,
    getTestRunById,
    deleteTestRun,
    verifyAutonomousFix,
} from "../controllers/test.controller.js";

const router = express.Router();

// Trigger a test run on project
router.post("/:projectId/run", auth, runProjectTests);

// Trigger autonomous fix & verification loop on a failing test
router.post("/:projectId/verify-fix", auth, verifyAutonomousFix);

// Get historical test runs for project
router.get("/:projectId/runs", auth, getProjectTestRuns);

// Get detailed test run report (parsed failures, stack traces, logs)
router.get("/run/:runId", auth, getTestRunById);

// Delete a test run
router.delete("/run/:runId", auth, deleteTestRun);

export default router;
