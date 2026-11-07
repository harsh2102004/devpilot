import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCode } from "../src/services/ast.services.js";
import { chunkCodeFile, createChunk, sliceLines } from "../src/services/chunker.service.js";
import { resolveImportPath, getDependents, getDependencies } from "../src/services/codeGraph.service.js";

describe("Task 9: AST Parser & Semantic Code Graph Unit Tests", () => {
    const sampleJsFixture = `
import express from "express";
import { calculateTax, formatCurrency } from "./utils/math.js";

/**
 * Calculates order discount
 */
export function applyDiscount(subtotal, discountRate = 0.1) {
    if (subtotal <= 0) return 0;
    return subtotal * (1 - discountRate);
}

export const processPayment = async (orderId, amount) => {
    const tax = calculateTax(amount);
    return { orderId, total: amount + tax };
};

export class OrderService {
    constructor(db) {
        this.db = db;
    }

    async getOrder(id) {
        return this.db.find(id);
    }
}

export default OrderService;
`;

    describe("AST Parser (parseCode)", () => {
        it("Extracts module imports with sources and specifiers", () => {
            const result = parseCode(sampleJsFixture, "src/services/order.js");

            assert.strictEqual(result.filePath, "src/services/order.js");
            assert.strictEqual(result.imports.length, 2);

            const expressImport = result.imports.find((i) => i.source === "express");
            assert.ok(expressImport);
            assert.strictEqual(expressImport.specifiers[0], "express");

            const mathImport = result.imports.find((i) => i.source === "./utils/math.js");
            assert.ok(mathImport);
            assert.ok(mathImport.specifiers.includes("calculateTax"));
            assert.ok(mathImport.specifiers.includes("formatCurrency"));
        });

        it("Extracts function declarations and arrow functions with params", () => {
            const result = parseCode(sampleJsFixture, "src/services/order.js");

            const fn = result.functions.find((f) => f.name === "applyDiscount");
            assert.ok(fn, "applyDiscount function must be detected");
            assert.ok(fn.params.includes("subtotal"));
            assert.strictEqual(fn.isAsync, false);
            assert.ok(fn.startLine > 0 && fn.endLine >= fn.startLine);

            const arrowFn = result.functions.find((f) => f.name === "processPayment");
            assert.ok(arrowFn, "processPayment arrow function must be detected");
            assert.strictEqual(arrowFn.isAsync, true);
            assert.ok(arrowFn.params.includes("orderId"));
            assert.ok(arrowFn.params.includes("amount"));
        });

        it("Extracts class declarations and methods", () => {
            const result = parseCode(sampleJsFixture, "src/services/order.js");

            const cls = result.classes.find((c) => c.name === "OrderService");
            assert.ok(cls, "OrderService class must be detected");
            assert.ok(cls.methods.some((m) => m.name === "constructor"));
            assert.ok(cls.methods.some((m) => m.name === "getOrder"));
        });

        it("Handles empty, null, or invalid code gracefully without crashing", () => {
            const emptyResult = parseCode("", "empty.js");
            assert.deepStrictEqual(emptyResult.functions, []);
            assert.deepStrictEqual(emptyResult.imports, []);

            const nullResult = parseCode(null, "null.js");
            assert.deepStrictEqual(nullResult.functions, []);

            const invalidResult = parseCode("function invalid( { let 123", "broken.js");
            assert.ok(Array.isArray(invalidResult.functions));
        });
    });

    describe("AST-Aware Semantic Chunker (chunkCodeFile)", () => {
        it("Slices lines accurately using 1-indexed boundaries", () => {
            const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
            const sliced = sliceLines(lines, 2, 4);
            assert.strictEqual(sliced, "line 2\nline 3\nline 4");
        });

        it("Creates structured chunks with metadata banner", () => {
            const chunk = createChunk({
                projectId: "proj_999",
                filePath: "src/math.js",
                symbolName: "calculateSum",
                chunkType: "function",
                startLine: 10,
                endLine: 20,
                rawCode: "function calculateSum(a, b) { return a + b; }",
                params: ["a", "b"],
            });

            assert.ok(chunk.chunkId.includes("src/math.js:function:calculateSum:10-20"));
            assert.strictEqual(chunk.symbolName, "calculateSum");
            assert.strictEqual(chunk.lineCount, 11);
            assert.ok(chunk.content.includes("// DevPilot Code Chunk"));
            assert.ok(chunk.content.includes("// Symbol: calculateSum (function)"));
            assert.ok(chunk.content.includes("function calculateSum(a, b) { return a + b; }"));
        });

        it("Chunks complete code fixture along semantic syntax boundaries", () => {
            const chunks = chunkCodeFile({
                content: sampleJsFixture,
                filePath: "src/services/order.js",
                projectId: "test_project_1",
            });

            assert.ok(Array.isArray(chunks));
            assert.ok(chunks.length >= 2, "Must produce chunks for functions and classes");

            const fnChunk = chunks.find((c) => c.symbolName === "applyDiscount");
            assert.ok(fnChunk, "Chunk for applyDiscount must exist");
            assert.strictEqual(fnChunk.chunkType, "function");
            assert.strictEqual(fnChunk.filePath, "src/services/order.js");

            const classChunk = chunks.find((c) => c.symbolName === "OrderService");
            assert.ok(classChunk, "Chunk for OrderService must exist");
            assert.strictEqual(classChunk.chunkType, "class");
        });
    });

    describe("Code Graph & Import Resolution (codeGraph.service)", () => {
        it("Returns null for external library imports (npm modules)", () => {
            const known = new Set(["src/app.js", "src/utils.js"]);
            assert.strictEqual(resolveImportPath("src/app.js", "express", known), null);
            assert.strictEqual(resolveImportPath("src/app.js", "mongoose", known), null);
            assert.strictEqual(resolveImportPath("src/app.js", "@babel/parser", known), null);
        });

        it("Resolves relative imports with exact path and file extensions", () => {
            const known = new Set([
                "src/services/order.service.js",
                "src/utils/math.js",
                "src/models/user.model.js",
            ]);

            const resolvedWithExt = resolveImportPath(
                "src/services/order.service.js",
                "../utils/math.js",
                known
            );
            assert.strictEqual(resolvedWithExt, "src/utils/math.js");

            const resolvedWithoutExt = resolveImportPath(
                "src/services/order.service.js",
                "../utils/math",
                known
            );
            assert.strictEqual(resolvedWithoutExt, "src/utils/math.js");
        });

        it("Calculates dependents and dependencies from graph structure", () => {
            const mockGraph = {
                nodes: [
                    { id: "file:src/app.js", path: "src/app.js" },
                    { id: "file:src/routes.js", path: "src/routes.js" },
                    { id: "file:src/controller.js", path: "src/controller.js" },
                ],
                edges: [
                    { from: "file:src/app.js", to: "file:src/routes.js", type: "imports" },
                    { from: "file:src/routes.js", to: "file:src/controller.js", type: "imports" },
                ],
            };

            const appDeps = getDependencies(mockGraph, "src/app.js");
            assert.deepStrictEqual(appDeps, ["src/routes.js"]);

            const ctrlDependents = getDependents(mockGraph, "src/controller.js");
            assert.deepStrictEqual(ctrlDependents, ["src/routes.js"]);
        });
    });
});
