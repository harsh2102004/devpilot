import express from 'express';
import { auth } from '../middleware/auth.js';
import { getprojectscanhistory, getjobstatus, startScan } from '../controllers/scan.controller.js';

const router = express.Router();

router.post("/:projectId", auth, startScan);
router.get("/job/:jobId", auth, getjobstatus);
router.get("/project/:projectId", auth, getprojectscanhistory);

export default router;  