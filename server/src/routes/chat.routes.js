import express from "express";
import { auth } from "../middleware/auth.js";
import { streamChat, askQuestion } from "../controllers/chat.controller.js";

const router = express.Router();

// SSE Streaming Codebase Chat
router.post("/stream", auth, streamChat);

// Standard JSON Chat
router.post("/ask", auth, askQuestion);
router.post("/", auth, askQuestion);

export default router;
