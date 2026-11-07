import express from "express";
import { auth } from "../middleware/auth.js";
import { validateObjectId } from "../middleware/validateObjectId.js";
import {
    runProjectTests,
    getProjectTestRuns,
    getTestRunById,
    deleteTestRun,
    verifyAutonomousFix,
    createPullRequestForFix,
} from "../controllers/test.controller.js";

const router = express.Router();

// Trigger a test run on project (Task 6: validateObjectId on :projectId)
router.post("/:projectId/run", auth, validateObjectId("projectId"), runProjectTests);

// Trigger autonomous fix & verification loop on a failing test
router.post("/:projectId/verify-fix", auth, validateObjectId("projectId"), verifyAutonomousFix);

// Automate GitHub branch creation, fix commit, and PR creation (Sub-Phase 9E)
router.post("/:projectId/create-pr", auth, validateObjectId("projectId"), createPullRequestForFix);

// Get historical test runs for project
router.get("/:projectId/runs", auth, validateObjectId("projectId"), getProjectTestRuns);

// Get detailed test run report (Task 6: validateObjectId on :runId)
router.get("/run/:runId", auth, validateObjectId("runId"), getTestRunById);

// Delete a test run
router.delete("/run/:runId", auth, validateObjectId("runId"), deleteTestRun);

export default router;
