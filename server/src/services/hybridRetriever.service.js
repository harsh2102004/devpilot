/**
 * DevPilot Hybrid Retrieval Engine (Sub-Phase 7A)
 * Fuses dense semantic vector search (Pinecone) with structural dependency
 * graph traversal (AST CodeGraph in MongoDB) to power high-precision codebase chat.
 */

import { searchCodebase, fetchVectorsByIds } from "./vectorDb.service.js";
import { CodeGraph } from "../models/codeGraph.js";
import fs from "fs/promises";
import path from "path";

/**
 * Estimates token count for a text string.
 * Uses ~3.8 characters per token for mixed source code and docstrings.
 * @param {string} text
 * @returns {number} Estimated token count
 */
export const estimateTokens = (text = "") => {
    if (!text || typeof text !== "string") return 0;
    return Math.ceil(text.length / 3.8);
};

/**
 * Traverses the AST CodeGraph to find 1-hop connected symbols (callees, callers, imports)
 * for a list of seed vector search chunks.
 *
 * @param {object} codeGraph - Graph document containing nodes and edges
 * @param {Array<object>} seedChunks - Primary chunks retrieved from Pinecone
 * @returns {Array<object>} Deduplicated connected symbols with relationship metadata
 */
export const findConnectedSymbols = (codeGraph, seedChunks = []) => {
    if (!codeGraph || !Array.isArray(codeGraph.nodes) || !Array.isArray(codeGraph.edges)) {
        return [];
    }

    const { nodes, edges } = codeGraph;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const connectedSymbols = [];
    const seenNodeIds = new Set();

    // Collect all seed identifiers to avoid returning self-connections
    const seedFilePaths = new Set(seedChunks.map((c) => c.filePath));
    const seedSymbolNames = new Set(seedChunks.map((c) => c.symbolName).filter(Boolean));

    for (const chunk of seedChunks) {
        const fileNodeId = `file:${chunk.filePath}`;
        const funcNodeId = chunk.symbolName ? `func:${chunk.filePath}:${chunk.symbolName}` : null;
        const classNodeId = chunk.symbolName ? `class:${chunk.filePath}:${chunk.symbolName}` : null;

        // 1. Inspect function calls (functions called by this file/symbol)
        for (const edge of edges) {
            if (edge.type === "calls") {
                // If this file/function calls another function
                if (edge.from === fileNodeId || (funcNodeId && edge.from === funcNodeId)) {
                    const targetNode = nodeById.get(edge.to);
                    if (targetNode && !seenNodeIds.has(targetNode.id)) {
                        seenNodeIds.add(targetNode.id);
                        connectedSymbols.push({
                            node: targetNode,
                            relationship: "called-by-seed",
                            seedSymbol: chunk.symbolName || chunk.filePath,
                            edgeType: "calls",
                            line: edge.line,
                        });
                    }
                }
                // If another function calls this function (callers)
                if (funcNodeId && edge.to === funcNodeId) {
                    const callerNode = nodeById.get(edge.from);
                    if (callerNode && !seenNodeIds.has(callerNode.id)) {
                        seenNodeIds.add(callerNode.id);
                        connectedSymbols.push({
                            node: callerNode,
                            relationship: "calls-seed",
                            seedSymbol: chunk.symbolName,
                            edgeType: "calls",
                            line: edge.line,
                        });
                    }
                }
            }

            // 2. Inspect file imports (modules directly imported by the seed file)
            if (edge.type === "imports" && edge.from === fileNodeId) {
                const importedNode = nodeById.get(edge.to);
                // Exclude external third-party npm packages (e.g. 'express') to keep code context focused
                if (importedNode && importedNode.type === "file" && !seenNodeIds.has(importedNode.id)) {
                    // Do not repeat the seed file itself
                    if (!seedFilePaths.has(importedNode.filePath)) {
                        seenNodeIds.add(importedNode.id);
                        connectedSymbols.push({
                            node: importedNode,
                            relationship: "imported-by-seed",
                            seedSymbol: chunk.filePath,
                            edgeType: "imports",
                            specifiers: edge.specifiers,
                            line: edge.line,
                        });
                    }
                }
            }
        }
    }

    return connectedSymbols;
};

/**
 * Helper to locate source files across relative and server roots
 */
export const findExistingFilePath = async (relPath) => {
    if (!relPath) return null;
    const candidates = [
        path.resolve(relPath),
        path.resolve("src", relPath),
        path.resolve("server/src", relPath),
        path.resolve("../server/src", relPath),
    ];
    for (const cand of candidates) {
        try {
            await fs.access(cand);
            return cand;
        } catch {
            // try next candidate
        }
    }
    return null;
};

/**
 * Resolves raw code snippet for a connected node either via Pinecone vector fetch,
 * metadata query, or local source file.
 * @param {string} projectId
 * @param {object} connection - Connection metadata containing node
 * @returns {Promise<object|null>} Standardized chunk object or null
 */
export const resolveConnectedChunk = async (projectId, connection) => {
    const { node, relationship, seedSymbol } = connection;
    if (!node) return null;

    // 1. If node is a function or class with explicit startLine and endLine
    if (node.type === "function" || node.type === "class") {
        const expectedChunkId = `${node.filePath}:${node.type}:${node.name}:${node.startLine}-${node.endLine}`
            .replace(/\\/g, "/")
            .replace(/\s+/g, "_");

        // Try Pinecone direct fetch first
        const fetched = await fetchVectorsByIds(projectId, [expectedChunkId]);
        if (fetched.length > 0) {
            return {
                ...fetched[0],
                relationship,
                seedSymbol,
                isDependency: true,
            };
        }

        // Try reading source snippet if file exists locally
        const existingPath = await findExistingFilePath(node.filePath);
        if (existingPath) {
            try {
                const content = await fs.readFile(existingPath, "utf-8");
                const lines = content.split(/\r?\n/);
                const rawSnippet = lines.slice(Math.max(0, node.startLine - 1), node.endLine).join("\n");

                const banner = [
                    `// DevPilot Connected Dependency (${relationship} '${seedSymbol}')`,
                    `// File: ${node.filePath}`,
                    `// Symbol: ${node.name} (${node.type})`,
                    node.params?.length > 0 ? `// Parameters: (${node.params.join(", ")})` : null,
                    node.isAsync ? `// Modifiers: async` : null,
                    `// Lines: ${node.startLine}-${node.endLine}`,
                    `// --- Code ---`,
                ].filter(Boolean).join("\n") + "\n";

                return {
                    chunkId: expectedChunkId,
                    filePath: node.filePath,
                    symbolName: node.name,
                    chunkType: node.type,
                    startLine: node.startLine,
                    endLine: node.endLine,
                    lineCount: node.endLine - node.startLine + 1,
                    content: banner + rawSnippet.trim(),
                    relationship,
                    seedSymbol,
                    isDependency: true,
                };
            } catch {
                // fallback
            }
        }
    }

    // 2. If node is a file node, extract the exported symbol signatures or top lines
    if (node.type === "file") {
        const existingPath = await findExistingFilePath(node.filePath);
        if (existingPath) {
            try {
                const content = await fs.readFile(existingPath, "utf-8");
                const lines = content.split(/\r?\n/);
                const maxLine = Math.min(lines.length, 45);
                const snippet = lines.slice(0, maxLine).join("\n");

                const banner = [
                    `// DevPilot Connected Module (${relationship} '${seedSymbol}')`,
                    `// File: ${node.filePath}`,
                    `// Exports: ${node.exports?.join(", ") || "(default/commonjs)"}`,
                    `// Lines: 1-${maxLine}`,
                    `// --- Code ---`,
                ].filter(Boolean).join("\n") + "\n";

                return {
                    chunkId: `file:${node.filePath}:head`,
                    filePath: node.filePath,
                    symbolName: path.basename(node.filePath),
                    chunkType: "module-overview",
                    startLine: 1,
                    endLine: maxLine,
                    lineCount: maxLine,
                    content: banner + snippet.trim(),
                    relationship,
                    seedSymbol,
                    isDependency: true,
                };
            } catch {
                // fallback
            }
        }
    }

    return null;
};


/**
 * Builds the unified, injection-resistant XML prompt context ready for LLM consumption.
 * @param {Array<object>} primaryChunks - Top-K direct vector matches
 * @param {Array<object>} dependencyChunks - 1-hop connected code graph symbols
 * @returns {string} Fully formatted prompt context
 */
export const formatRetrievedContext = (primaryChunks = [], dependencyChunks = []) => {
    const parts = [
        "<retrieved_code_context>",
        "<!-- INSTRUCTION: The following code snippets are retrieved from the user's project repository.",
        "Use them as the ground truth to answer questions. Cite exact file paths and line ranges. -->\n",
    ];

    if (primaryChunks.length > 0) {
        parts.push("### PRIMARY RELEVANT CHUNKS (Direct Semantic Search Matches)");
        primaryChunks.forEach((chunk, idx) => {
            const scorePercent = chunk.score ? `${(chunk.score * 100).toFixed(1)}%` : "N/A";
            parts.push(
                `<!-- [Primary Match #${idx + 1}] File: ${chunk.filePath} | Lines: ${chunk.startLine}-${chunk.endLine} | Relevance: ${scorePercent} -->`
            );
            parts.push("```" + (chunk.filePath.endsWith(".ts") || chunk.filePath.endsWith(".tsx") ? "typescript" : "javascript"));
            parts.push(chunk.content || chunk.rawCode || "");
            parts.push("```\n");
        });
    }

    if (dependencyChunks.length > 0) {
        parts.push("### CONNECTED ARCHITECTURAL DEPENDENCIES (AST CodeGraph 1-Hop Traversal)");
        dependencyChunks.forEach((chunk, idx) => {
            parts.push(
                `<!-- [Connected Dependency #${idx + 1}] File: ${chunk.filePath} | Symbol: ${chunk.symbolName} | Relation: ${chunk.relationship} '${chunk.seedSymbol}' -->`
            );
            parts.push("```" + (chunk.filePath.endsWith(".ts") || chunk.filePath.endsWith(".tsx") ? "typescript" : "javascript"));
            parts.push(chunk.content || chunk.rawCode || "");
            parts.push("```\n");
        });
    }

    parts.push("</retrieved_code_context>");
    return parts.join("\n");
};

/**
 * Core Hybrid Retrieval Entrypoint
 * Executes vector search, traverses connected CodeGraph symbols, manages token budget,
 * and formats the final high-precision context prompt.
 *
 * @param {object} options
 * @param {string} options.projectId - Target project ID
 * @param {string} options.query - User question or query text
 * @param {number} [options.topK=3] - Number of primary vector chunks to retrieve
 * @param {number} [options.maxTokens=3500] - Hard upper limit for assembled context
 * @param {boolean} [options.includeGraphHops=true] - Whether to expand 1-hop dependencies
 * @returns {Promise<object>} Unified retrieval result with formatted prompt context & metrics
 */
export const retrieveHybridContext = async ({
    projectId,
    query,
    topK = 3,
    maxTokens = 3500,
    includeGraphHops = true,
}) => {
    if (!projectId) {
        throw new Error("projectId is required for hybrid context retrieval");
    }
    if (!query || typeof query !== "string" || !query.trim()) {
        throw new Error("query text is required for hybrid context retrieval");
    }

    // 1. Dense Semantic Vector Search (Pinecone)
    const seedMatches = await searchCodebase({
        projectId: projectId.toString(),
        query: query.trim(),
        topK,
    });

    const primaryChunks = [];
    let currentTokens = 0;

    // Allocate token budget to primary matches first
    for (const match of seedMatches) {
        const tokens = estimateTokens(match.content);
        if (currentTokens + tokens <= maxTokens) {
            primaryChunks.push({
                ...match,
                isPrimary: true,
                estimatedTokens: tokens,
            });
            currentTokens += tokens;
        } else {
            break;
        }
    }

    const dependencyChunks = [];

    // 2. Structural CodeGraph 1-Hop Dependency Expansion
    if (includeGraphHops && primaryChunks.length > 0 && currentTokens < maxTokens) {
        try {
            const graphDoc = await CodeGraph.findOne({ projectId });
            if (graphDoc) {
                const connections = findConnectedSymbols(graphDoc, primaryChunks);

                for (const conn of connections) {
                    if (currentTokens >= maxTokens) break;

                    const depChunk = await resolveConnectedChunk(projectId.toString(), conn);
                    if (depChunk) {
                        const depTokens = estimateTokens(depChunk.content);
                        if (currentTokens + depTokens <= maxTokens) {
                            // Check if this chunk is already in primaryChunks or dependencyChunks
                            const alreadyPresent =
                                primaryChunks.some((p) => p.chunkId === depChunk.chunkId) ||
                                dependencyChunks.some((d) => d.chunkId === depChunk.chunkId);

                            if (!alreadyPresent) {
                                dependencyChunks.push({
                                    ...depChunk,
                                    estimatedTokens: depTokens,
                                });
                                currentTokens += depTokens;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`[HybridRetriever] Warning expanding graph dependencies: ${err.message}`);
        }
    }

    // 3. Assemble and Format Prompt Context
    const assembledContext = formatRetrievedContext(primaryChunks, dependencyChunks);
    const allSelectedChunks = [...primaryChunks, ...dependencyChunks];

    return {
        query: query.trim(),
        projectId: projectId.toString(),
        totalChunks: allSelectedChunks.length,
        primaryCount: primaryChunks.length,
        dependencyCount: dependencyChunks.length,
        totalEstimatedTokens: currentTokens,
        primaryMatches: primaryChunks,
        connectedDependencies: dependencyChunks,
        chunks: allSelectedChunks,
        assembledContext,
    };
};

export default {
    estimateTokens,
    findConnectedSymbols,
    resolveConnectedChunk,
    formatRetrievedContext,
    retrieveHybridContext,
};
