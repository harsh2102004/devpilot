/**
 * Live Verification Test for Sub-Phase 6A: AST-Aware Semantic Code Chunker
 * Tests symbol-aware slicing, banner enrichment, sliding window fallback, and standardized schema.
 */

import fs from "fs";
import path from "path";
import {
    chunkCodeFile,
    buildContextBanner,
    createChunk,
    splitLargeBlock,
    sliceLines,
} from "./src/services/chunker.service.js";

console.log("=================================================================");
console.log("  DevPilot Chunker Verification (Sub-Phase 6A Live Test)");
console.log("=================================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
    total++;
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
    }
}

// -------------------------------------------------------------
// Test 1: Helper unit verification (sliceLines, buildContextBanner)
// -------------------------------------------------------------
console.log("--- Group 1: Helper Units ---");
const testLines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
const sliced = sliceLines(testLines, 2, 4);
assert(sliced === "line 2\nline 3\nline 4", "sliceLines correctly extracts 1-indexed range");

const banner = buildContextBanner({
    projectId: "proj-101",
    filePath: "src/utils/math.js",
    symbolName: "calculateAverage",
    chunkType: "function",
    startLine: 10,
    endLine: 25,
    params: ["nums", "weights"],
    isAsync: true,
});
assert(banner.includes("// Project: proj-101"), "Banner includes project id");
assert(banner.includes("// File: src/utils/math.js"), "Banner includes file path");
assert(banner.includes("// Symbol: calculateAverage (function)"), "Banner includes symbol name & chunk type");
assert(banner.includes("// Parameters: (nums, weights)"), "Banner includes function parameters");
assert(banner.includes("// Modifiers: async"), "Banner captures async modifier");
assert(banner.includes("// Lines: 10-25"), "Banner reflects start and end line ranges");

// -------------------------------------------------------------
// Test 2: Standardized Chunk Schema Structure
// -------------------------------------------------------------
console.log("\n--- Group 2: Chunk Schema Integrity ---");
const singleChunk = createChunk({
    projectId: "proj-101",
    filePath: "src/services/ast.services.js",
    symbolName: "parseCode",
    chunkType: "function",
    startLine: 15,
    endLine: 45,
    rawCode: "export const parseCode = () => {};",
    params: ["code", "filePath"],
    isAsync: false,
});

assert(typeof singleChunk.chunkId === "string" && singleChunk.chunkId.length > 0, "Chunk has unique chunkId");
assert(singleChunk.filePath === "src/services/ast.services.js", "Chunk retains normalized filePath");
assert(singleChunk.symbolName === "parseCode", "Chunk retains symbol name");
assert(singleChunk.chunkType === "function", "Chunk specifies chunkType");
assert(singleChunk.startLine === 15 && singleChunk.endLine === 45, "Chunk has startLine and endLine");
assert(singleChunk.lineCount === 31, "Chunk computes lineCount");
assert(singleChunk.content.includes("// Symbol: parseCode"), "Chunk content includes contextual banner");
assert(singleChunk.rawCode === "export const parseCode = () => {};", "Chunk preserves rawCode");

// -------------------------------------------------------------
// Test 3: AST-Aware Chunking on real codebase files
// -------------------------------------------------------------
console.log("\n--- Group 3: Real Codebase AST Chunking ---");

// File 1: codeGraph.service.js
const codeGraphPath = "./src/services/codeGraph.service.js";
if (fs.existsSync(codeGraphPath)) {
    const code = fs.readFileSync(codeGraphPath, "utf8");
    const chunks = chunkCodeFile({
        filePath: "src/services/codeGraph.service.js",
        content: code,
        projectId: "proj-devpilot",
    });

    assert(chunks.length >= 5, `codeGraph.service.js chunked into ${chunks.length} chunks`);
    const functionChunks = chunks.filter((c) => c.chunkType === "function");
    assert(functionChunks.length >= 3, `Extracted ${functionChunks.length} distinct function chunks`);

    const hasResolve = functionChunks.some((c) => c.symbolName === "resolveImportPath");
    assert(hasResolve, "Found resolveImportPath function chunk");

    const hasBuild = functionChunks.some((c) => c.symbolName === "buildCodeGraph");
    assert(hasBuild, "Found buildCodeGraph function chunk");

    const hasPreamble = chunks.some((c) => c.chunkType === "module-preamble");
    assert(hasPreamble, "Extracted module-preamble with file header imports");
}

// File 2: User.js (Mongoose Model with Schema & Methods)
const userPath = "./src/models/User.js";
if (fs.existsSync(userPath)) {
    const userCode = fs.readFileSync(userPath, "utf8");
    const userChunks = chunkCodeFile({
        filePath: "src/models/User.js",
        content: userCode,
        projectId: "proj-devpilot",
    });

    assert(userChunks.length >= 2, `User.js chunked into ${userChunks.length} chunks via sliding-window`);
    const userChunkTypes = userChunks.map((c) => c.chunkType);
    console.log(`    User.js chunk types found: [${[...new Set(userChunkTypes)].join(", ")}]`);
}

// -------------------------------------------------------------
// Test 4: Sliding Window Fallback for Large Blocks
// -------------------------------------------------------------
console.log("\n--- Group 4: Sliding Window Chunking ---");
const fakeLargeLines = Array.from({ length: 250 }, (_, i) => `const val_${i} = ${i * 42};`);
const splitChunks = splitLargeBlock(
    fakeLargeLines,
    1,
    250,
    { projectId: "p1", filePath: "big.js", symbolName: "bigFile", chunkType: "file-block" },
    80, // maxLines
    15  // overlap
);

assert(splitChunks.length >= 4, `250-line block divided into ${splitChunks.length} sliding windows`);
assert(splitChunks[0].startLine === 1 && splitChunks[0].endLine === 80, "First window spans lines 1 to 80");
// Window 2 starts at 80 - 15 + 1 = 66
assert(splitChunks[1].startLine === 66, `Second window has overlap, starts at line ${splitChunks[1].startLine}`);

console.log("\n=================================================================");
console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
console.log("=================================================================\n");
