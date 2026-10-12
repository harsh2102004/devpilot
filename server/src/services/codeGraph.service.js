import path from "path";
import fs from "fs/promises";
import { parseCode } from "./ast.services.js";
import { walkDirectory, isSupportedCodeFile } from "./fileWalker.service.js";

/**
 * Resolves an import statement path relative to the importer file path
 * @param {string} importerRelPath - Relative path of the file containing the import (e.g., "src/controllers/scan.controller.js")
 * @param {string} importSource - Import string (e.g., "../models/project.js", "./auth")
 * @param {Set<string>} knownFiles - Set of all known relative file paths in the repo
 * @returns {string|null} Resolved relative file path or null if external package (e.g. "express")
 */
export const resolveImportPath = (importerRelPath, importSource, knownFiles) => {
    // If it doesn't start with '.' or '/', it's an external library (npm package like 'express' or 'mongoose')
    if (!importSource.startsWith(".")) {
        return null;
    }

    const importerDir = path.posix.dirname(importerRelPath);
    let candidate = path.posix.normalize(path.posix.join(importerDir, importSource));

    // Try exact match first
    if (knownFiles.has(candidate)) {
        return candidate;
    }

    // Try standard extensions if omitted (.js, .jsx, .ts, .tsx, .json)
    const possibleExtensions = [".js", ".jsx", ".ts", ".tsx", ".json", "/index.js", "/index.ts"];
    for (const ext of possibleExtensions) {
        const testPath = candidate + ext;
        if (knownFiles.has(testPath)) {
            return testPath;
        }
    }

    return candidate;
};

/**
 * Builds a complete Code Graph from a directory of source files
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, stats: object }>}
 */
export const buildCodeGraph = async (projectRoot) => {
    const nodes = [];
    const edges = [];
    const fileMetadataMap = new Map();

    // 1. Walk directory to find all valid source files
    const allFiles = await walkDirectory(projectRoot);
    const codeFiles = allFiles.filter((f) => f.isCode);
    const knownFiles = new Set(allFiles.map((f) => f.relativePath));

    // 2. Parse AST for each code file
    for (const file of codeFiles) {
        try {
            const content = await fs.readFile(file.absolutePath, "utf8");
            const metadata = parseCode(content, file.relativePath);
            fileMetadataMap.set(file.relativePath, metadata);

            // Add File Node
            const fileNodeId = `file:${file.relativePath}`;
            nodes.push({
                id: fileNodeId,
                type: "file",
                name: file.fileName,
                filePath: file.relativePath,
                size: file.size,
                exports: metadata.exports,
            });

            // Add Function Nodes & 'defines' edges
            metadata.functions.forEach((fn) => {
                const funcNodeId = `func:${file.relativePath}:${fn.name}`;
                nodes.push({
                    id: funcNodeId,
                    type: "function",
                    name: fn.name,
                    filePath: file.relativePath,
                    params: fn.params,
                    isAsync: fn.isAsync,
                    startLine: fn.startLine,
                    endLine: fn.endLine,
                });

                edges.push({
                    from: fileNodeId,
                    to: funcNodeId,
                    type: "defines",
                });
            });

            // Add Class Nodes & 'defines' edges
            metadata.classes.forEach((cls) => {
                const classNodeId = `class:${file.relativePath}:${cls.name}`;
                nodes.push({
                    id: classNodeId,
                    type: "class",
                    name: cls.name,
                    filePath: file.relativePath,
                    methods: cls.methods,
                    startLine: cls.startLine,
                    endLine: cls.endLine,
                });

                edges.push({
                    from: fileNodeId,
                    to: classNodeId,
                    type: "defines",
                });
            });
        } catch (err) {
            console.error(`Failed to process ${file.relativePath}:`, err.message);
        }
    }

    // 3. Connect Edges: Import dependencies and Function Calls
    for (const [filePath, metadata] of fileMetadataMap.entries()) {
        const fromFileNodeId = `file:${filePath}`;

        // 3a. File-to-File Imports
        for (const imp of metadata.imports) {
            const resolvedPath = resolveImportPath(filePath, imp.source, knownFiles);

            if (resolvedPath) {
                const targetFileNodeId = `file:${resolvedPath}`;
                edges.push({
                    from: fromFileNodeId,
                    to: targetFileNodeId,
                    type: "imports",
                    specifiers: imp.specifiers,
                    line: imp.line,
                });
            } else {
                // External package (e.g. 'express', 'mongoose', 'bullmq')
                const extPkgNodeId = `pkg:${imp.source}`;
                if (!nodes.find((n) => n.id === extPkgNodeId)) {
                    nodes.push({
                        id: extPkgNodeId,
                        type: "package",
                        name: imp.source,
                    });
                }
                edges.push({
                    from: fromFileNodeId,
                    to: extPkgNodeId,
                    type: "imports",
                    specifiers: imp.specifiers,
                    line: imp.line,
                });
            }
        }

        // 3b. Function Calls (connecting callers to defined functions/methods)
        for (const call of metadata.calls) {
            // Find if this callee matches any defined function in the graph
            const targetFunctionNode = nodes.find(
                (n) => n.type === "function" && n.name === call.callee
            );

            if (targetFunctionNode) {
                edges.push({
                    from: fromFileNodeId,
                    to: targetFunctionNode.id,
                    type: "calls",
                    line: call.line,
                });
            }
        }
    }

    const stats = {
        totalFilesScanned: allFiles.length,
        codeFilesParsed: codeFiles.length,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        functionsFound: nodes.filter((n) => n.type === "function").length,
        classesFound: nodes.filter((n) => n.type === "class").length,
    };

    return { nodes, edges, stats };
};

/**
 * Helper to query dependent files (which files import this file?)
 */
export const getDependents = (graph, targetFilePath) => {
    const targetFileNodeId = `file:${targetFilePath}`;
    return graph.edges
        .filter((e) => e.to === targetFileNodeId && e.type === "imports")
        .map((e) => e.from.replace("file:", ""));
};

/**
 * Helper to query dependencies of a file (what does this file import?)
 */
export const getDependencies = (graph, sourceFilePath) => {
    const sourceFileNodeId = `file:${sourceFilePath}`;
    return graph.edges
        .filter((e) => e.from === sourceFileNodeId && e.type === "imports")
        .map((e) => e.to.replace("file:", "").replace("pkg:", ""));
};

export default {
    buildCodeGraph,
    resolveImportPath,
    getDependents,
    getDependencies,
};
