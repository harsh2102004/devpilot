/**
 * DevPilot Failure Analysis & Root Cause Investigator Agent (Sub-Phase 9A)
 *
 * Implements Step 9 & Section 7 of the DevPilot Architecture (pilot.pdf):
 * Ingests parsed test failure evidence from Phase 8, correlates stack traces with
 * the AST Code Graph, retrieves 1-hop dependency context via Hybrid Retrieval,
 * formulates diagnostic prompts, and queries the LLM for root-cause diagnosis.
 */

import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { CodeGraph } from "../models/codeGraph.js";
import { retrieveHybridContext, formatRetrievedContext } from "./hybridRetriever.service.js";
import { streamChatCompletion, getLlmConfig } from "./llm.service.js";

/**
 * Normalizes relative file paths extracted from test failures
 * @param {string} rawPath
 * @returns {string}
 */
export const normalizePath = (rawPath) => {
    if (!rawPath) return "";
    return rawPath
        .trim()
        .replace(/\\/g, "/")
        .replace(/^file:\/\/\/?/, "")
        .replace(/^\/workspace\//, "");
};

/**
 * Correlates a parsed test failure with the project's AST Code Graph.
 * Identifies the exact culprit function/class enclosing the failure line,
 * and traces 1-hop callers and callees.
 *
 * @param {object} params
 * @param {object} params.failure - Parsed test failure from Phase 8C
 * @param {object} [params.codeGraph] - CodeGraph document { nodes, edges }
 * @param {string} [params.workingDir] - Project workspace root
 * @returns {Promise<object>} Correlation report
 */
export const correlateFailureWithGraph = async ({
    failure,
    codeGraph = null,
    workingDir = null,
}) => {
    const cleanFilePath = normalizePath(failure?.filePath || "");
    const targetLine = failure?.line || 0;

    let culpritSymbol = null;
    let culpritType = "unknown";
    let culpritNode = null;
    const callers = [];
    const callees = [];
    const importedModules = [];

    if (codeGraph && Array.isArray(codeGraph.nodes) && Array.isArray(codeGraph.edges)) {
        const { nodes, edges } = codeGraph;
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        // 1. Locate enclosing function or class by line range
        const matchingFileNodes = nodes.filter(
            (n) => normalizePath(n.filePath) === cleanFilePath || n.filePath.endsWith(cleanFilePath)
        );

        for (const node of matchingFileNodes) {
            if (node.type === "function" || node.type === "class") {
                if (targetLine >= node.startLine && targetLine <= node.endLine) {
                    culpritNode = node;
                    culpritSymbol = node.name;
                    culpritType = node.type;
                    break;
                }
            }
        }

        // If no line match found, check by function name in test title
        if (!culpritNode && failure?.testTitle) {
            for (const node of matchingFileNodes) {
                if (node.name && failure.testTitle.toLowerCase().includes(node.name.toLowerCase())) {
                    culpritNode = node;
                    culpritSymbol = node.name;
                    culpritType = node.type;
                    break;
                }
            }
        }

        // 2. Trace callers and callees from Code Graph edges
        const targetIds = new Set();
        if (culpritNode) targetIds.add(culpritNode.id);
        const fileNodeId = `file:${cleanFilePath}`;
        targetIds.add(fileNodeId);

        for (const edge of edges) {
            // Outgoing calls / imports
            if (targetIds.has(edge.from)) {
                const target = nodeById.get(edge.to);
                if (target) {
                    if (edge.type === "calls") callees.push(target.name || target.id);
                    if (edge.type === "imports") importedModules.push(target.filePath || target.id);
                }
            }
            // Incoming callers
            if (targetIds.has(edge.to)) {
                const source = nodeById.get(edge.from);
                if (source) {
                    if (edge.type === "calls") callers.push(source.name || source.id);
                }
            }
        }
    }

    // 3. Extract high-resolution surrounding code snippet from disk if workspace exists
    let surroundingCode = failure?.codeSnippet || "";
    if (workingDir && cleanFilePath) {
        const diskPath = path.resolve(workingDir, cleanFilePath);
        if (existsSync(diskPath)) {
            try {
                const content = await fs.readFile(diskPath, "utf8");
                const lines = content.split(/\r?\n/);
                const start = Math.max(0, targetLine - 15);
                const end = Math.min(lines.length, targetLine + 15);

                const snippetLines = [];
                for (let i = start; i < end; i++) {
                    const lineNum = i + 1;
                    const pointer = lineNum === targetLine ? ">" : " ";
                    snippetLines.push(`${pointer} ${String(lineNum).padStart(4, " ")} | ${lines[i]}`);
                }
                surroundingCode = snippetLines.join("\n");
            } catch {}
        }
    }

    return {
        cleanFilePath,
        targetLine,
        culpritSymbol: culpritSymbol || (cleanFilePath ? path.basename(cleanFilePath) : "unknown"),
        culpritType,
        culpritNode,
        callers: [...new Set(callers)],
        callees: [...new Set(callees)],
        importedModules: [...new Set(importedModules)],
        surroundingCode,
    };
};

/**
 * Formulates the injection-resistant XML failure evidence block
 *
 * @param {object} failure
 * @param {object} correlation
 * @returns {string} XML evidence string
 */
export const formatFailureEvidence = (failure, correlation) => {
    return [
        "<test_failure_evidence>",
        `  <test_title>${failure.testTitle || "Unknown Test"}</test_title>`,
        failure.suiteName ? `  <test_suite>${failure.suiteName}</test_suite>` : null,
        `  <culprit_file>${correlation.cleanFilePath || failure.filePath || "unknown"}</culprit_file>`,
        `  <culprit_line>${correlation.targetLine || failure.line || "unknown"}</culprit_line>`,
        `  <culprit_symbol>${correlation.culpritSymbol} (${correlation.culpritType})</culprit_symbol>`,
        `  <error_name>${failure.errorName || "AssertionError"}</error_name>`,
        `  <error_message>${failure.errorMessage || "Test assertion failed"}</error_message>`,
        correlation.callers.length > 0 ? `  <callers>${correlation.callers.join(", ")}</callers>` : null,
        correlation.callees.length > 0 ? `  <callees>${correlation.callees.join(", ")}</callees>` : null,
        correlation.surroundingCode ? `  <code_snippet>\n${correlation.surroundingCode}\n  </code_snippet>` : null,
        failure.stackTrace ? `  <stack_trace>\n${failure.stackTrace}\n  </stack_trace>` : null,
        "</test_failure_evidence>",
    ].filter(Boolean).join("\n");
};

/**
 * Builds the diagnostic system prompt and conversation messages
 *
 * @param {object} params
 * @param {string} params.projectName
 * @param {string} params.evidenceXml
 * @param {string} params.retrievedContextXml
 * @returns {Array<{ role: string, content: string }>}
 */
export const buildDiagnosticMessages = ({
    projectName = "DevPilot Project",
    evidenceXml,
    retrievedContextXml = "",
}) => {
    const systemPrompt = `You are DevPilot's Autonomous Root-Cause Investigator Agent.
Your responsibility is to analyze test failure evidence, correlate it with repository source code and AST call graphs, and determine the exact technical root cause.

CRITICAL INSTRUCTIONS:
1. Base your diagnosis strictly on the provided <test_failure_evidence> and <retrieved_code_context>.
2. Do not invent non-existent functions, variables, or files.
3. Structure your response with the following clear markdown headers:
   ### 1. Root Cause Summary
   (A crisp 1-2 sentence explanation of why the test assertion failed)
   
   ### 2. Technical Investigation & Call Flow
   (Step-by-step breakdown of what was expected vs what occurred, referencing culprit files and line numbers [file:line])
   
   ### 3. Impacted Symbols & Dependencies
   (List the specific functions, methods, or components directly affected)
   
   ### 4. Proposed Fix Strategy
   (A concrete, actionable strategy explaining how to patch the bug without breaking dependencies)`;

    const userPrompt = `Project: ${projectName}

Here is the test failure evidence captured in the sandbox:
${evidenceXml}

${retrievedContextXml ? `Here is the relevant code context retrieved from the repository:\n${retrievedContextXml}\n` : ""}
Please investigate this failure and provide a thorough root-cause diagnosis.`;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];
};

/**
 * Deterministic offline fallback diagnostic generator when external LLM API is unavailable.
 *
 * @param {object} params
 * @returns {string}
 */
export const generateOfflineDiagnosis = ({
    failure,
    correlation,
}) => {
    const symbolStr = correlation.culpritSymbol ? `\`${correlation.culpritSymbol}\`` : "the target function";
    const fileStr = correlation.cleanFilePath ? `\`${correlation.cleanFilePath}:${correlation.targetLine}\`` : "the source file";

    return `### 1. Root Cause Summary
The test \`${failure.testTitle}\` failed due to an **${failure.errorName || "AssertionError"}** in ${symbolStr} at ${fileStr}. The actual return value deviated from the assertion requirement: ${failure.errorMessage || "unexpected assertion mismatch"}.

### 2. Technical Investigation & Call Flow
- **Failing Location**: ${fileStr}
- **Observed Behavior**: The execution pipeline triggered an assertion failure where \`${failure.errorMessage || "expected condition was false"}\`.
- **AST Code Graph Context**: ${correlation.culpritSymbol} is connected to callees: [${correlation.callees.join(", ") || "none"}] and callers: [${correlation.callers.join(", ") || "direct test runner"}].

### 3. Impacted Symbols & Dependencies
- **Primary Culprit**: ${symbolStr} in \`${correlation.cleanFilePath}\`
${correlation.callees.length > 0 ? `- **Dependent Callees**: ${correlation.callees.map((c) => `\`${c}\``).join(", ")}` : ""}

### 4. Proposed Fix Strategy
1. Inspect the return or response branching logic in ${symbolStr} around line ${correlation.targetLine}.
2. Ensure input parameters are validated and expected status codes / objects match the test assertion expectations.
3. Apply a targeted patch that satisfies the test contract without modifying external interface signatures.`;
};

/**
 * Main Entrypoint: Investigates a test failure and produces a root-cause diagnosis report.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.projectName="Project"]
 * @param {object} params.failure - Parsed test failure object
 * @param {object} [params.codeGraph=null] - Pre-fetched CodeGraph or null to load from DB
 * @param {string} [params.workingDir=null] - Project directory path
 * @param {Function} [params.onToken=null] - Streaming token callback
 * @returns {Promise<object>} Complete investigation report
 */
export const investigateFailure = async ({
    projectId,
    projectName = "DevPilot Project",
    failure,
    codeGraph = null,
    workingDir = null,
    onToken = null,
}) => {
    if (!failure) {
        throw new Error("[DebugAgent] failure object is required for investigation");
    }

    // 1. Fetch CodeGraph from MongoDB if not provided
    let activeGraph = codeGraph;
    if (!activeGraph && projectId) {
        try {
            activeGraph = await CodeGraph.findOne({ projectId }).lean();
        } catch {}
    }

    // 2. Correlate stack trace with AST Code Graph
    const correlation = await correlateFailureWithGraph({
        failure,
        codeGraph: activeGraph,
        workingDir,
    });

    // 3. Format Failure Evidence
    const evidenceXml = formatFailureEvidence(failure, correlation);

    // 4. Retrieve Ground Truth Context via Hybrid Retrieval (if vector/graph index exists)
    let retrievedContextXml = "";
    try {
        if (projectId) {
            const query = `${failure.errorName} ${failure.errorMessage} in ${correlation.culpritSymbol} ${correlation.cleanFilePath}`;
            const hybridResult = await retrieveHybridContext({
                projectId,
                query,
                topK: 3,
                maxDependencyHops: 1,
                maxTokens: 2500,
            });

            if (hybridResult && hybridResult.formattedContext) {
                retrievedContextXml = hybridResult.formattedContext;
            }
        }
    } catch (retrievalErr) {
        console.warn(`[DebugAgent] Hybrid retrieval skipped: ${retrievalErr.message}`);
    }

    // 5. Build Diagnostic Messages
    const messages = buildDiagnosticMessages({
        projectName,
        evidenceXml,
        retrievedContextXml,
    });

    // 6. Query LLM (with streaming and deterministic offline fallback)
    const llmConfig = getLlmConfig();
    let diagnosticText = "";

    if (llmConfig.provider === "offline" || !llmConfig.apiKey) {
        diagnosticText = generateOfflineDiagnosis({ failure, correlation });
        if (onToken) {
            // Emulate streaming for offline mode
            const words = diagnosticText.split(" ");
            for (const word of words) {
                onToken(`${word} `);
            }
        }
    } else {
        diagnosticText = await streamChatCompletion({
            messages,
            query: failure.errorMessage,
            retrievedContext: evidenceXml + "\n" + retrievedContextXml,
            onToken,
        });
    }

    return {
        investigationId: `inv-${Date.now()}`,
        projectId,
        culprit: {
            filePath: correlation.cleanFilePath,
            line: correlation.targetLine,
            symbolName: correlation.culpritSymbol,
            symbolType: correlation.culpritType,
            callers: correlation.callers,
            callees: correlation.callees,
            importedModules: correlation.importedModules,
        },
        evidence: {
            testTitle: failure.testTitle,
            suiteName: failure.suiteName,
            errorName: failure.errorName,
            errorMessage: failure.errorMessage,
        },
        evidenceXml,
        diagnosticReport: diagnosticText,
        llmProvider: llmConfig.provider,
    };
};

export default {
    normalizePath,
    correlateFailureWithGraph,
    formatFailureEvidence,
    buildDiagnosticMessages,
    generateOfflineDiagnosis,
    investigateFailure,
};
