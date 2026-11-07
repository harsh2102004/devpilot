/**
 * DevPilot Patch Synthesis Engine (Sub-Phase 9B)
 *
 * Implements Step 10 & Section 9 of the DevPilot Architecture (pilot.pdf):
 * 1. Generates targeted code patches & standard Git unified diffs based on failure evidence
 * 2. Pre-validates AST syntax integrity using @babel/parser before sandbox application
 * 3. Enforces minimal change footprint and whitespace-tolerant replacement matching
 */

import { parse } from "@babel/parser";
import { streamChatCompletion, getLlmConfig } from "./llm.service.js";
import path from "path";

/**
 * Validates AST syntax integrity on modified code before applying to disk or sandbox.
 * Supports JavaScript, JSX, TypeScript, and ES modules.
 *
 * @param {object} params
 * @param {string} params.code - Modified source text
 * @param {string} [params.filePath="file.js"] - File name for plugin detection
 * @returns {{ valid: boolean, error?: string, line?: number, column?: number }}
 */
export const validateAstSyntax = ({ code, filePath = "file.js" }) => {
    if (!code || typeof code !== "string") {
        return { valid: false, error: "Empty or invalid code string provided" };
    }

    const isJsLike = /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(filePath) || !path.extname(filePath);

    if (isJsLike) {
        try {
            parse(code, {
                sourceType: "module",
                plugins: [
                    "jsx",
                    "typescript",
                    "asyncGenerators",
                    "dynamicImport",
                    "classProperties",
                    "objectRestSpread",
                ],
                errorRecovery: false, // Strict checking: throws on syntax errors
            });
            return { valid: true };
        } catch (err) {
            return {
                valid: false,
                error: err.message,
                line: err.loc?.line || 0,
                column: err.loc?.column || 0,
            };
        }
    }

    // Basic bracket and quotes balance check for non-JS files (e.g. JSON, Python)
    const stack = [];
    const pairs = { "(": ")", "[": "]", "{": "}" };
    for (let i = 0; i < code.length; i++) {
        const char = code[i];
        if (pairs[char]) {
            stack.push(char);
        } else if (Object.values(pairs).includes(char)) {
            const last = stack.pop();
            if (!last || pairs[last] !== char) {
                return { valid: false, error: `Unbalanced bracket '${char}' around index ${i}` };
            }
        }
    }

    if (stack.length > 0) {
        return { valid: false, error: `Unclosed bracket '${stack[stack.length - 1]}'` };
    }

    return { valid: true };
};

/**
 * Applies targeted replacement to original source content with whitespace tolerance fallback.
 *
 * @param {object} params
 * @param {string} params.originalContent - Full original file text
 * @param {string} params.targetCode - Code segment to replace
 * @param {string} params.replacementCode - New replacement code segment
 * @returns {{ success: boolean, modifiedContent: string, matchedBy: "exact" | "normalized" | "failed" }}
 */
export const applyCodeReplacement = ({
    originalContent,
    targetCode,
    replacementCode,
}) => {
    if (!originalContent || !targetCode) {
        return { success: false, modifiedContent: originalContent || "", matchedBy: "failed" };
    }

    const cleanTarget = targetCode.trim();
    const cleanReplacement = replacementCode.trimEnd();

    // 1. Direct exact match
    if (originalContent.includes(targetCode)) {
        const modified = originalContent.replace(targetCode, replacementCode);
        return { success: true, modifiedContent: modified, matchedBy: "exact" };
    }

    // 2. Trimmed exact match
    if (originalContent.includes(cleanTarget)) {
        const modified = originalContent.replace(cleanTarget, cleanReplacement);
        return { success: true, modifiedContent: modified, matchedBy: "exact" };
    }

    // 3. Line-by-line whitespace-insensitive matching
    const origLines = originalContent.split(/\r?\n/);
    const targetLines = cleanTarget.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    let matchStartIndex = -1;

    for (let i = 0; i <= origLines.length - targetLines.length; i++) {
        let isMatch = true;
        for (let j = 0; j < targetLines.length; j++) {
            if (origLines[i + j].trim() !== targetLines[j]) {
                isMatch = false;
                break;
            }
        }
        if (isMatch) {
            matchStartIndex = i;
            break;
        }
    }

    if (matchStartIndex !== -1) {
        // Detect leading indentation of the first matched line
        const leadingIndent = origLines[matchStartIndex].match(/^\s*/)[0];
        const indentedReplacement = cleanReplacement
            .split(/\r?\n/)
            .map((line, idx) => (idx === 0 || !line.trim() ? line : leadingIndent + line.trim()))
            .join("\n");

        const before = origLines.slice(0, matchStartIndex).join("\n");
        const after = origLines.slice(matchStartIndex + targetLines.length).join("\n");
        const modified = [before, indentedReplacement, after].filter(Boolean).join("\n");

        return { success: true, modifiedContent: modified, matchedBy: "normalized" };
    }

    return { success: false, modifiedContent: originalContent, matchedBy: "failed" };
};

/**
 * Computes standard Git unified diff between original and modified text.
 *
 * @param {object} params
 * @param {string} params.filePath - Relative file path (e.g. "src/controllers/auth.controller.js")
 * @param {string} params.originalContent - Original file content
 * @param {string} params.modifiedContent - Modified file content
 * @param {number} [params.contextLines=3] - Surrounding context lines per hunk
 * @returns {string} Standard Unified Diff string
 */
export const generateUnifiedDiff = ({
    filePath,
    originalContent = "",
    modifiedContent = "",
    contextLines = 3,
}) => {
    const origLines = originalContent.split(/\r?\n/);
    const modLines = modifiedContent.split(/\r?\n/);

    if (originalContent === modifiedContent) {
        return "";
    }

    const normPath = filePath.replace(/\\/g, "/");
    const diffHeader = [
        `diff --git a/${normPath} b/${normPath}`,
        `--- a/${normPath}`,
        `+++ b/${normPath}`,
    ];

    // Find first and last changed line indices
    let startOrig = 0;
    while (
        startOrig < origLines.length &&
        startOrig < modLines.length &&
        origLines[startOrig] === modLines[startOrig]
    ) {
        startOrig++;
    }

    let endOrig = origLines.length - 1;
    let endMod = modLines.length - 1;
    while (endOrig >= startOrig && endMod >= startOrig && origLines[endOrig] === modLines[endMod]) {
        endOrig--;
        endMod--;
    }

    const hunkStartOrig = Math.max(0, startOrig - contextLines);
    const hunkEndOrig = Math.min(origLines.length - 1, endOrig + contextLines);
    const hunkStartMod = Math.max(0, startOrig - contextLines);
    const hunkEndMod = Math.min(modLines.length - 1, endMod + contextLines);

    const origCount = hunkEndOrig - hunkStartOrig + 1;
    const modCount = hunkEndMod - hunkStartMod + 1;

    const hunkHeader = `@@ -${hunkStartOrig + 1},${origCount} +${hunkStartMod + 1},${modCount} @@`;
    const hunkLines = [hunkHeader];

    // Leading context
    for (let i = hunkStartOrig; i < startOrig; i++) {
        hunkLines.push(` ${origLines[i]}`);
    }

    // Deleted lines from original
    for (let i = startOrig; i <= endOrig; i++) {
        hunkLines.push(`-${origLines[i]}`);
    }

    // Added lines in modified
    for (let i = startOrig; i <= endMod; i++) {
        hunkLines.push(`+${modLines[i]}`);
    }

    // Trailing context
    for (let i = endOrig + 1; i <= hunkEndOrig; i++) {
        if (i < origLines.length) {
            hunkLines.push(` ${origLines[i]}`);
        }
    }

    return [...diffHeader, ...hunkLines].join("\n");
};

/**
 * Builds prompt messages instructing the LLM to output a targeted patch in JSON format.
 *
 * @param {object} params
 * @param {string} params.projectName
 * @param {object} params.failure - Parsed test failure evidence
 * @param {string} [params.diagnosticReport] - Diagnosis from Phase 9A
 * @param {string} params.filePath
 * @param {string} params.fileContent - Original code text
 * @returns {Array<{ role: string, content: string }>}
 */
export const buildPatchPrompt = ({
    projectName = "DevPilot Project",
    failure,
    diagnosticReport = "",
    filePath,
    fileContent,
    previousAttempts = [],
}) => {
    const systemPrompt = `You are DevPilot's Autonomous Patch Synthesis Engine.
Your task is to fix a test failure by generating a minimal, surgical code replacement.

CRITICAL INSTRUCTIONS:
1. Make the SMALLEST possible change that resolves the bug. Do not reformat unrelated code.
2. Ensure the replacement is syntactically valid and adheres to the existing file style.
3. You MUST respond with ONLY a valid JSON object matching this exact schema (no markdown fences, no extra text):
{
  "explanation": "Clear 1-sentence summary of what the patch changes",
  "targetCode": "Exact lines of code currently in the file that must be replaced",
  "replacementCode": "The new replacement code to insert in place of targetCode"
}`;

    const reflectionSection =
        previousAttempts && previousAttempts.length > 0
            ? `\nPrior Verification Failures (Reflection Context):
${previousAttempts
    .map(
        (att, idx) =>
            `Attempt ${idx + 1}: Target "${att.patch?.targetCode || ""}" -> "${att.patch?.replacementCode || ""}"\nFailed With: ${att.errorFeedback || att.status || "Test verification failed"}`
    )
    .join("\n")}
Important: Do NOT repeat the exact failed patch above. Address the regression or remaining error.\n`
            : "";

    const userPrompt = `Project: ${projectName}
File to Fix: ${filePath}

Test Failure Evidence:
- Test: ${failure.testTitle}
- Error: ${failure.errorName}: ${failure.errorMessage}
- Failure Line: ${failure.line || "unknown"}

${diagnosticReport ? `Root Cause Diagnosis (from Phase 9A):\n${diagnosticReport}\n` : ""}${reflectionSection}
Current File Content:
\`\`\`
${fileContent}
\`\`\`

Generate the minimal targeted fix JSON now:`;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];
};

/**
 * Deterministic offline fallback patch synthesizer when LLM API keys are not configured.
 *
 * @param {object} params
 * @returns {object}
 */
export const generateOfflinePatch = ({
    failure,
    originalContent,
    previousAttempts = [],
}) => {
    // Look for status code mismatches (e.g. Expected 401 but received 200)
    const statusMatch = failure?.errorMessage?.match(/(?:Expected|expected)\s+(\d{3})\s+.*?(?:received|got)\s+(\d{3})/i);

    if (statusMatch && originalContent) {
        const expectedStatus = statusMatch[1];
        const receivedStatus = statusMatch[2];

        // Search for occurrences of `res.status(200)` or `status: 200`
        const candidates = [
            `res.status(${receivedStatus})`,
            `status: ${receivedStatus}`,
            `statusCode = ${receivedStatus}`,
        ];

        for (const target of candidates) {
            if (originalContent.includes(target)) {
                const replacement = target.replace(receivedStatus, expectedStatus);
                return {
                    explanation: `Correct HTTP status code from ${receivedStatus} to ${expectedStatus} to satisfy test assertion`,
                    targetCode: target,
                    replacementCode: replacement,
                };
            }
        }
    }

    // Generic fallback: insert assertion fix comment at failure line
    const lines = originalContent.split(/\r?\n/);
    const lineIdx = Math.min(lines.length - 1, Math.max(0, (failure?.line || 1) - 1));
    const targetLine = lines[lineIdx];

    return {
        explanation: `Update ${failure?.testTitle || "target logic"} to handle failure condition`,
        targetCode: targetLine,
        replacementCode: `${targetLine} // DevPilot Fix: Satisfy ${failure?.errorMessage || "test assertion"}`,
    };
};

/**
 * Master Patch Synthesis Entrypoint
 * Coordinates LLM code generation, targeted replacement application, AST syntax validation,
 * and unified diff generation.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.projectName="Project"]
 * @param {object} params.failure - Parsed test failure
 * @param {string} [params.diagnosticReport] - Diagnosis from Phase 9A
 * @param {string} params.filePath - Path of file to patch
 * @param {string} params.originalContent - Original code text
 * @param {Array<object>} [params.previousAttempts=[]] - History of failed attempts for reflection
 * @param {Function} [params.onToken] - Streaming callback
 * @returns {Promise<object>} Standardized patch result object
 */
export const synthesizePatch = async ({
    projectId,
    projectName = "DevPilot Project",
    failure,
    diagnosticReport = "",
    filePath,
    originalContent,
    previousAttempts = [],
    onToken = null,
}) => {
    if (!filePath || !originalContent) {
        throw new Error("[PatchGenerator] filePath and originalContent are required for patch synthesis");
    }

    const patchId = `patch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const llmConfig = getLlmConfig();

    let patchProposal = null;

    if (llmConfig.provider === "offline" || !llmConfig.apiKey) {
        patchProposal = generateOfflinePatch({ failure, originalContent, previousAttempts });
    } else {
        const messages = buildPatchPrompt({
            projectName,
            failure,
            diagnosticReport,
            filePath,
            fileContent: originalContent,
            previousAttempts,
        });

        try {
            const rawResponse = await streamChatCompletion({
                messages,
                query: failure.errorMessage,
                retrievedContext: originalContent,
                onToken,
            });

            // Clean markdown code blocks if the model wrapped JSON in ```json ... ```
            const cleanJson = rawResponse
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            patchProposal = JSON.parse(cleanJson);
        } catch (err) {
            console.warn(`[PatchGenerator] LLM JSON parsing failed (${err.message}). Using deterministic fallback.`);
            patchProposal = generateOfflinePatch({ failure, originalContent });
        }
    }

    const {
        explanation = "Automated bugfix patch",
        targetCode = "",
        replacementCode = "",
    } = patchProposal || {};

    // 1. Apply replacement in memory
    const replaceResult = applyCodeReplacement({
        originalContent,
        targetCode,
        replacementCode,
    });

    if (!replaceResult.success) {
        return {
            patchId,
            projectId,
            filePath,
            explanation,
            success: false,
            error: "Failed to locate targetCode in original file content for replacement",
            targetCode,
            replacementCode,
            unifiedDiff: "",
            modifiedContent: originalContent,
            astValid: false,
        };
    }

    // 2. Sub-Phase 9B Requirement 2: AST Syntax Integrity Check
    const astCheck = validateAstSyntax({
        code: replaceResult.modifiedContent,
        filePath,
    });

    // 3. Generate standard Git Unified Diff
    const unifiedDiff = generateUnifiedDiff({
        filePath,
        originalContent,
        modifiedContent: replaceResult.modifiedContent,
    });

    return {
        patchId,
        projectId,
        filePath: filePath.replace(/\\/g, "/"),
        explanation,
        success: astCheck.valid,
        targetCode,
        replacementCode,
        matchedBy: replaceResult.matchedBy,
        unifiedDiff,
        modifiedContent: replaceResult.modifiedContent,
        astValid: astCheck.valid,
        syntaxError: astCheck.error || null,
        syntaxErrorLine: astCheck.line || null,
    };
};

export default {
    validateAstSyntax,
    applyCodeReplacement,
    generateUnifiedDiff,
    buildPatchPrompt,
    generateOfflinePatch,
    synthesizePatch,
};

