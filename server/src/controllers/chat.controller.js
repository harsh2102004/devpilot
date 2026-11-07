import asyncHandler from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Project } from "../models/project.js";
import { isValidObjectId } from "../middleware/validateObjectId.js";
import { retrieveHybridContext } from "../services/hybridRetriever.service.js";
import {
    buildSystemPrompt,
    buildChatMessages,
    streamChatCompletion,
    getLlmConfig,
} from "../services/llm.service.js";

/**
 * Server-Sent Events (SSE) Streaming Chat Endpoint
 * POST /api/chat/stream
 *
 * Request Body:
 * {
 *   projectId: string,
 *   query: string,
 *   history?: Array<{ role: 'user' | 'assistant', content: string }>,
 *   maxTokens?: number,
 *   topK?: number
 * }
 */
export const streamChat = asyncHandler(async (req, res) => {
    const { projectId, query, history = [], maxTokens = 3500, topK = 3 } = req.body;

    if (!projectId || !isValidObjectId(projectId)) {
        throw new ApiError(400, "Valid projectId is required for codebase chat");
    }

    if (!query || typeof query !== "string" || !query.trim()) {
        throw new ApiError(400, "query is required for codebase chat");
    }

    // Task 6: Filter query by owner, returning 404 for not found and not yours
    const project = await Project.findOne({
        _id: projectId,
        owner: req.user._id,
    });
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    // Set Server-Sent Events headers
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    const sendEvent = (type, payload = {}) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    const abortController = new AbortController();
    req.on("close", () => {
        abortController.abort();
    });

    try {
        // Step 1: Notify client retrieval phase has started
        sendEvent("status", { message: "Retrieving hybrid codebase context (vectors + AST graph)..." });

        // Step 2: Retrieve hybrid context (Pinecone + MongoDB CodeGraph 1-hop expansion)
        const hybridResult = await retrieveHybridContext({
            projectId: project._id.toString(),
            query: query.trim(),
            topK: Math.min(Math.max(parseInt(topK, 10) || 3, 1), 6),
            maxTokens: Math.min(Math.max(parseInt(maxTokens, 10) || 3500, 1000), 8000),
            includeGraphHops: true,
        });

        // Step 3: Emit retrieved context & citations metadata
        sendEvent("context", {
            data: {
                totalChunks: hybridResult.totalChunks,
                primaryCount: hybridResult.primaryCount,
                dependencyCount: hybridResult.dependencyCount,
                totalEstimatedTokens: hybridResult.totalEstimatedTokens,
                primaryMatches: hybridResult.primaryMatches.map((m) => ({
                    filePath: m.filePath,
                    symbolName: m.symbolName,
                    chunkType: m.chunkType,
                    startLine: m.startLine,
                    endLine: m.endLine,
                    score: m.score,
                })),
                connectedDependencies: hybridResult.connectedDependencies.map((d) => ({
                    filePath: d.filePath,
                    symbolName: d.symbolName,
                    chunkType: d.chunkType,
                    startLine: d.startLine,
                    endLine: d.endLine,
                    relationship: d.relationship,
                    seedSymbol: d.seedSymbol,
                })),
            },
        });

        // Step 4: Assemble prompt with Primacy/Recency ordering
        sendEvent("status", { message: "Generating grounded AI response..." });

        const systemPrompt = buildSystemPrompt({ projectName: project.name });
        const messages = buildChatMessages({
            systemPrompt,
            retrievedContext: hybridResult.assembledContext,
            query: query.trim(),
            history,
        });

        let totalTokens = 0;
        const config = getLlmConfig();

        // Step 5: Stream completion tokens to client
        await streamChatCompletion({
            messages,
            query: query.trim(),
            retrievedContext: hybridResult.assembledContext,
            onToken: (token) => {
                totalTokens++;
                sendEvent("token", { token });
            },
            signal: abortController.signal,
        });

        // Step 6: Emit stream completion event
        sendEvent("done", {
            totalTokens,
            provider: config.provider,
            model: config.model,
        });

        res.end();
    } catch (err) {
        console.error("[ChatController] Streaming error:", err.message);
        sendEvent("error", { message: err.message || "Chat stream encountered an error" });
        res.end();
    }
});

/**
 * Standard Non-Streaming Chat Endpoint
 * POST /api/chat/ask
 */
export const askQuestion = asyncHandler(async (req, res) => {
    const { projectId, query, history = [], maxTokens = 3500, topK = 3 } = req.body;

    if (!projectId || !isValidObjectId(projectId)) {
        throw new ApiError(400, "Valid projectId is required");
    }

    if (!query || typeof query !== "string" || !query.trim()) {
        throw new ApiError(400, "query is required");
    }

    // Task 6: Filter query by owner, returning 404 for not found and not yours
    const project = await Project.findOne({
        _id: projectId,
        owner: req.user._id,
    });
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    const hybridResult = await retrieveHybridContext({
        projectId: project._id.toString(),
        query: query.trim(),
        topK: Math.min(Math.max(parseInt(topK, 10) || 3, 1), 6),
        maxTokens: Math.min(Math.max(parseInt(maxTokens, 10) || 3500, 1000), 8000),
        includeGraphHops: true,
    });

    const systemPrompt = buildSystemPrompt({ projectName: project.name });
    const messages = buildChatMessages({
        systemPrompt,
        retrievedContext: hybridResult.assembledContext,
        query: query.trim(),
        history,
    });

    let fullAnswer = "";
    await streamChatCompletion({
        messages,
        query: query.trim(),
        retrievedContext: hybridResult.assembledContext,
        onToken: (tok) => {
            fullAnswer += tok;
        },
    });

    const config = getLlmConfig();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                projectId: project._id,
                query: query.trim(),
                answer: fullAnswer,
                provider: config.provider,
                model: config.model,
                contextMetrics: {
                    totalChunks: hybridResult.totalChunks,
                    primaryCount: hybridResult.primaryCount,
                    dependencyCount: hybridResult.dependencyCount,
                    totalEstimatedTokens: hybridResult.totalEstimatedTokens,
                    primaryMatches: hybridResult.primaryMatches,
                    connectedDependencies: hybridResult.connectedDependencies,
                },
            },
            "Codebase answer generated successfully"
        )
    );
});

export default {
    streamChat,
    askQuestion,
};
