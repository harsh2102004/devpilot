/**
 * DevPilot Sub-Phase 9A Live Verification Test
 * 
 * Verifies:
 * 1. Failure investigation agent service (debugAgent.service.js)
 * 2. Correlation of failure stack traces with AST Code Graph nodes & edges
 * 3. Injection-resistant XML evidence formatting
 * 4. Diagnostic prompt construction and LLM root-cause diagnosis query
 */

import path from "path";
import {
    normalizePath,
    correlateFailureWithGraph,
    formatFailureEvidence,
    buildDiagnosticMessages,
    investigateFailure,
} from "./src/services/debugAgent.service.js";

console.log("=================================================================");
console.log("  DevPilot Failure Analysis & Debug Agent (Sub-Phase 9A Live Test)");
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

async function runTests() {
    // -------------------------------------------------------------
    // Test 1: Path Normalization
    // -------------------------------------------------------------
    console.log("--- Group 1: Path Normalization ---");
    assert(normalizePath("C:\\Users\\dev\\src\\index.js") === "C:/Users/dev/src/index.js", "Converts Windows backslashes");
    assert(normalizePath("/workspace/src/controllers/auth.js") === "src/controllers/auth.js", "Strips /workspace/ prefix");
    assert(normalizePath("file:///src/models/User.js") === "src/models/User.js", "Strips file:/// URI prefix");

    // -------------------------------------------------------------
    // Test 2: AST Code Graph Correlation (Item 2)
    // -------------------------------------------------------------
    console.log("\n--- Group 2: AST Code Graph Correlation ---");
    
    // Construct simulated AST Code Graph representing an Auth flow
    const sampleCodeGraph = {
        nodes: [
            { id: "file:src/controllers/auth.js", filePath: "src/controllers/auth.js", type: "file" },
            {
                id: "func:src/controllers/auth.js:loginUser",
                name: "loginUser",
                filePath: "src/controllers/auth.js",
                type: "function",
                startLine: 20,
                endLine: 65,
                params: ["req", "res"],
            },
            {
                id: "func:src/services/token.js:generateAccessToken",
                name: "generateAccessToken",
                filePath: "src/services/token.js",
                type: "function",
                startLine: 10,
                endLine: 25,
            },
            { id: "file:src/routes/auth.routes.js", filePath: "src/routes/auth.routes.js", type: "file" },
        ],
        edges: [
            { from: "func:src/controllers/auth.js:loginUser", to: "func:src/services/token.js:generateAccessToken", type: "calls" },
            { from: "file:src/routes/auth.routes.js", to: "func:src/controllers/auth.js:loginUser", type: "calls" },
        ],
    };

    const sampleFailure = {
        testTitle: "should return 401 when password mismatch",
        suiteName: "Auth Controller Test",
        filePath: "src/controllers/auth.js",
        line: 42,
        column: 15,
        errorName: "AssertionError",
        errorMessage: "Expected status 401 but received 200",
        stackTrace: "at Object.<anonymous> (src/controllers/auth.js:42:15)\nat async loginUser (src/controllers/auth.js:42:15)",
        codeSnippet: "> 42 | expect(res.status).toBe(401);",
    };

    const correlation = await correlateFailureWithGraph({
        failure: sampleFailure,
        codeGraph: sampleCodeGraph,
        workingDir: ".",
    });

    assert(correlation.culpritSymbol === "loginUser", `Correctly identified enclosing function as "loginUser" (actual: "${correlation.culpritSymbol}")`);
    assert(correlation.culpritType === "function", `Culprit type is function (actual: "${correlation.culpritType}")`);
    assert(correlation.targetLine === 42, `Enclosing line is 42`);
    assert(correlation.callees.includes("generateAccessToken"), "Identified callee 'generateAccessToken' from AST edges");

    // -------------------------------------------------------------
    // Test 3: Failure Evidence XML Formatting
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Failure Evidence XML Formatting ---");
    const evidenceXml = formatFailureEvidence(sampleFailure, correlation);
    assert(evidenceXml.includes("<test_failure_evidence>"), "Contains root test_failure_evidence tag");
    assert(evidenceXml.includes("<culprit_symbol>loginUser (function)</culprit_symbol>"), "Embeds culprit symbol in XML");
    assert(evidenceXml.includes("<error_message>Expected status 401 but received 200</error_message>"), "Embeds error message in XML");
    assert(evidenceXml.includes("<callees>generateAccessToken</callees>"), "Embeds connected callees in XML");

    // -------------------------------------------------------------
    // Test 4: Diagnostic Prompt Construction (Item 3)
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Diagnostic Prompt Construction ---");
    const messages = buildDiagnosticMessages({
        projectName: "DevPilot Test App",
        evidenceXml,
        retrievedContextXml: "<retrieved_code_context></retrieved_code_context>",
    });

    assert(messages.length === 2, "Constructed system and user messages");
    assert(messages[0].role === "system", "First message is system prompt");
    assert(messages[0].content.includes("Root Cause Summary"), "System prompt instructs Root Cause Summary header");
    assert(messages[0].content.includes("Proposed Fix Strategy"), "System prompt instructs Proposed Fix Strategy header");
    assert(messages[1].role === "user", "Second message is user prompt with failure evidence");

    // -------------------------------------------------------------
    // Test 5: End-to-End Failure Investigation Pipeline
    // -------------------------------------------------------------
    console.log("\n--- Group 5: End-to-End Failure Investigation ---");
    let streamedTokens = 0;
    const report = await investigateFailure({
        projectId: "670f1a2b3c4d5e6f7a8b9c0d",
        projectName: "DevPilot Backend",
        failure: sampleFailure,
        codeGraph: sampleCodeGraph,
        workingDir: ".",
        onToken: (tok) => {
            if (tok) streamedTokens++;
        },
    });

    assert(typeof report.investigationId === "string" && report.investigationId.startsWith("inv-"), "Generated unique investigationId");
    assert(report.culprit.symbolName === "loginUser", "Report pinpoints culprit symbol 'loginUser'");
    assert(report.evidence.testTitle === sampleFailure.testTitle, "Report links failing test title");
    assert(typeof report.diagnosticReport === "string" && report.diagnosticReport.length > 50, "Generated comprehensive diagnostic report");
    assert(report.diagnosticReport.includes("Root Cause Summary"), "Diagnostic report includes 'Root Cause Summary'");
    assert(report.diagnosticReport.includes("Proposed Fix Strategy"), "Diagnostic report includes 'Proposed Fix Strategy'");
    assert(streamedTokens > 0, `Streamed diagnostic tokens in real-time (${streamedTokens} tokens)`);

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
