/**
 * DevPilot AST-Aware Semantic Code Chunker
 * Slices source code files along syntax boundaries (functions, classes)
 * with contextual breadcrumb enrichment for vector embeddings.
 */

import { parseCode } from "./ast.services.js";

/**
 * Extracts line slice from an array of lines (1-indexed, inclusive)
 * @param {string[]} lines - Array of code lines from file
 * @param {number} startLine - 1-indexed start line
 * @param {number} endLine - 1-indexed end line
 * @returns {string} Sliced code block joined with newlines
 */
export const sliceLines = (lines, startLine, endLine) => {
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length, endLine);
    return lines.slice(startIdx, endIdx).join("\n");
};

/**
 * Builds rich semantic context banner to prepend to code chunks
 * @param {object} params
 * @param {string} [params.projectId]
 * @param {string} params.filePath
 * @param {string} [params.symbolName]
 * @param {string} params.chunkType - "function" | "class" | "file-block"
 * @param {number} params.startLine
 * @param {number} params.endLine
 * @param {string[]} [params.params]
 * @param {boolean} [params.isAsync]
 * @returns {string} Formatted banner string with trailing newline
 */
export const buildContextBanner = ({
    projectId = "",
    filePath,
    symbolName = "",
    chunkType,
    startLine,
    endLine,
    params = [],
    isAsync = false,
}) => {
    const parts = [
        `// DevPilot Code Chunk`,
        projectId ? `// Project: ${projectId}` : null,
        `// File: ${filePath}`,
        symbolName ? `// Symbol: ${symbolName} (${chunkType})` : `// Block Type: ${chunkType}`,
        params.length > 0 ? `// Parameters: (${params.join(", ")})` : null,
        isAsync ? `// Modifiers: async` : null,
        `// Lines: ${startLine}-${endLine}`,
        `// --- Code ---`,
    ].filter(Boolean);

    return parts.join("\n") + "\n";
};

/**
 * Creates standardized chunk object with enriched content and clean metadata
 */
export const createChunk = ({
    projectId = "",
    filePath,
    symbolName = "",
    chunkType,
    startLine,
    endLine,
    rawCode,
    params = [],
    isAsync = false,
}) => {
    const banner = buildContextBanner({
        projectId,
        filePath,
        symbolName,
        chunkType,
        startLine,
        endLine,
        params,
        isAsync,
    });

    const safeSymbol = symbolName || `L${startLine}`;
    const cleanChunkId = `${filePath}:${chunkType}:${safeSymbol}:${startLine}-${endLine}`
        .replace(/\\/g, "/")
        .replace(/\s+/g, "_");

    return {
        chunkId: cleanChunkId,
        projectId,
        filePath: filePath.replace(/\\/g, "/"),
        symbolName,
        chunkType,
        startLine,
        endLine,
        lineCount: endLine - startLine + 1,
        content: banner + rawCode.trim(),
        rawCode: rawCode.trim(),
    };
};

/**
 * Sliding Window Slicer: Splits code blocks (> maxLines) into overlapping sub-chunks
 * @param {string[]} lines - Array of file lines
 * @param {number} startLine - Start line of the block (1-indexed)
 * @param {number} endLine - End line of the block (1-indexed)
 * @param {object} baseParams - Shared metadata (filePath, projectId, etc.)
 * @param {number} [maxLines=80] - Maximum window size in lines
 * @param {number} [overlapLines=15] - Number of lines to overlap between adjacent windows
 * @returns {Array<object>} Array of chunk objects
 */
export const splitLargeBlock = (
    lines,
    startLine,
    endLine,
    baseParams,
    maxLines = 80,
    overlapLines = 15
) => {
    const chunks = [];
    let currentStart = startLine;

    while (currentStart <= endLine) {
        const currentEnd = Math.min(currentStart + maxLines - 1, endLine);
        const rawCode = sliceLines(lines, currentStart, currentEnd);

        if (rawCode.trim()) {
            chunks.push(
                createChunk({
                    ...baseParams,
                    startLine: currentStart,
                    endLine: currentEnd,
                    rawCode,
                })
            );
        }

        if (currentEnd >= endLine) break;
        currentStart = currentEnd - overlapLines + 1;
    }

    return chunks;
};

/**
 * AST-Aware Chunking: Slices code file into semantic chunks bounded by
 * function and class declarations, with contextual preambles and sliding window fallback.
 *
 * @param {object} options
 * @param {string} options.filePath - Relative file path (e.g. "src/controllers/scan.controller.js")
 * @param {string} options.content - Full source text
 * @param {object} [options.astMetadata=null] - Pre-computed AST metadata or null to parse dynamically
 * @param {string} [options.projectId=""] - Associated project ID
 * @param {number} [options.maxChunkLines=90] - Max lines before sub-splitting
 * @returns {Array<object>} Array of standardized code chunks matching schema:
 *   { chunkId, filePath, symbolName, chunkType, startLine, endLine, content, rawCode }
 */
export const chunkCodeFile = ({
    filePath,
    content,
    astMetadata = null,
    projectId = "",
    maxChunkLines = 90,
}) => {
    if (!content || !content.trim()) {
        return [];
    }

    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const chunks = [];

    // 1. Obtain AST Metadata if not provided
    let metadata = astMetadata;
    if (!metadata) {
        try {
            metadata = parseCode(content, filePath);
        } catch {
            metadata = { functions: [], classes: [], imports: [], exports: [] };
        }
    }

    const coveredIntervals = [];

    // 2. Extract Class Chunks
    if (metadata.classes && metadata.classes.length > 0) {
        for (const cls of metadata.classes) {
            const startLine = cls.startLine || 1;
            const endLine = cls.endLine || totalLines;
            coveredIntervals.push([startLine, endLine]);

            if (endLine - startLine + 1 > maxChunkLines) {
                chunks.push(
                    ...splitLargeBlock(
                        lines,
                        startLine,
                        endLine,
                        {
                            projectId,
                            filePath,
                            symbolName: cls.name,
                            chunkType: "class",
                        },
                        maxChunkLines
                    )
                );
            } else {
                const rawCode = sliceLines(lines, startLine, endLine);
                if (rawCode.trim()) {
                    chunks.push(
                        createChunk({
                            projectId,
                            filePath,
                            symbolName: cls.name,
                            chunkType: "class",
                            startLine,
                            endLine,
                            rawCode,
                        })
                    );
                }
            }
        }
    }

    // 3. Extract Function Chunks (excluding methods inside classes that were already covered)
    if (metadata.functions && metadata.functions.length > 0) {
        for (const fn of metadata.functions) {
            const startLine = fn.startLine;
            const endLine = fn.endLine;

            // Check if this function is already enclosed by an existing class interval
            const isInsideClass = coveredIntervals.some(
                ([clsStart, clsEnd]) => startLine >= clsStart && endLine <= clsEnd
            );

            if (isInsideClass) {
                continue;
            }

            coveredIntervals.push([startLine, endLine]);

            if (endLine - startLine + 1 > maxChunkLines) {
                chunks.push(
                    ...splitLargeBlock(
                        lines,
                        startLine,
                        endLine,
                        {
                            projectId,
                            filePath,
                            symbolName: fn.name,
                            chunkType: "function",
                            params: fn.params,
                            isAsync: fn.isAsync,
                        },
                        maxChunkLines
                    )
                );
            } else {
                const rawCode = sliceLines(lines, startLine, endLine);
                if (rawCode.trim()) {
                    chunks.push(
                        createChunk({
                            projectId,
                            filePath,
                            symbolName: fn.name,
                            chunkType: "function",
                            startLine,
                            endLine,
                            rawCode,
                            params: fn.params,
                            isAsync: fn.isAsync,
                        })
                    );
                }
            }
        }
    }

    // 4. Capture Uncovered Sections (File Preamble, Configs, Route Handlers, Schemas)
    coveredIntervals.sort((a, b) => a[0] - b[0]);

    let cursor = 1;
    for (const [start, end] of coveredIntervals) {
        if (start > cursor + 3) {
            const gapStart = cursor;
            const gapEnd = start - 1;
            const rawCode = sliceLines(lines, gapStart, gapEnd);

            // Only chunk if contains non-trivial code (> 20 non-whitespace chars)
            if (rawCode.trim().length > 20) {
                const chunkType = cursor === 1 ? "module-preamble" : "code-block";
                chunks.push(
                    ...splitLargeBlock(
                        lines,
                        gapStart,
                        gapEnd,
                        {
                            projectId,
                            filePath,
                            symbolName: chunkType,
                            chunkType,
                        },
                        maxChunkLines
                    )
                );
            }
        }
        cursor = Math.max(cursor, end + 1);
    }

    // Trailing uncovered section after the last symbol
    if (cursor <= totalLines) {
        const rawCode = sliceLines(lines, cursor, totalLines);
        if (rawCode.trim().length > 20) {
            const chunkType = coveredIntervals.length === 0 ? "file-content" : "code-block";
            chunks.push(
                ...splitLargeBlock(
                    lines,
                    cursor,
                    totalLines,
                    {
                        projectId,
                        filePath,
                        symbolName: chunkType,
                        chunkType,
                    },
                    maxChunkLines
                )
            );
        }
    }

    // Sort chunks by startLine for deterministic reading order
    chunks.sort((a, b) => a.startLine - b.startLine);

    return chunks;
};

export default {
    sliceLines,
    buildContextBanner,
    createChunk,
    splitLargeBlock,
    chunkCodeFile,
};
