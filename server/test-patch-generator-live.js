/**
 * DevPilot Sub-Phase 9B Live Verification Test
 * 
 * Verifies:
 * 1. AST syntax integrity check on proposed code patches (@babel/parser)
 * 2. Targeted code replacements with whitespace-tolerance fallbacks
 * 3. Standard Git unified diff generation (hunks, context lines, diff headers)
 * 4. End-to-end patch synthesis engine (synthesizePatch)
 */

import {
    validateAstSyntax,
    applyCodeReplacement,
    generateUnifiedDiff,
    synthesizePatch,
} from "./src/services/patchGenerator.service.js";

console.log("=================================================================");
console.log("  DevPilot Patch Synthesis Engine (Sub-Phase 9B Live Test)");
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
    // Test 1: AST Syntax Integrity Check (Item 2)
    // -------------------------------------------------------------
    console.log("--- Group 1: AST Syntax Integrity Validation ---");
    
    // Scenario 1A: Clean valid JavaScript code
    const validJs = `
        import express from 'express';
        export const getUser = (req, res) => {
            return res.status(200).json({ success: true });
        };
    `;
    const check1 = validateAstSyntax({ code: validJs, filePath: "src/controllers/user.js" });
    assert(check1.valid === true, "Valid JavaScript code passes AST check");

    // Scenario 1B: Valid JSX / TSX
    const validJsx = `
        export const Badge = ({ label }: { label: string }) => {
            return <span className="status-badge">{label}</span>;
        };
    `;
    const check2 = validateAstSyntax({ code: validJsx, filePath: "src/components/Badge.tsx" });
    assert(check2.valid === true, "Valid JSX/TypeScript code passes AST check");

    // Scenario 1C: Broken code with syntax errors (missing closing paren/bracket)
    const brokenJs = `
        export const calculate = (a, b => {
            return a + b;
        }
    `;
    const check3 = validateAstSyntax({ code: brokenJs, filePath: "src/utils/calc.js" });
    assert(check3.valid === false, "Broken code correctly rejected by AST parser");
    assert(typeof check3.error === "string" && check3.error.length > 0, `Captured syntax error: "${check3.error}"`);
    assert(check3.line > 0, `Pinpointed syntax error line: ${check3.line}`);

    // -------------------------------------------------------------
    // Test 2: Targeted Code Replacement
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Targeted Code Replacement ---");
    const originalFile = [
        "import express from 'express';",
        "",
        "export const authenticate = (req, res) => {",
        "    if (!req.token) {",
        "        return res.status(200).json({ error: 'Unauthorized' });",
        "    }",
        "    return res.status(200).json({ ok: true });",
        "};",
    ].join("\n");

    // Scenario 2A: Exact match replacement
    const replace1 = applyCodeReplacement({
        originalContent: originalFile,
        targetCode: "return res.status(200).json({ error: 'Unauthorized' });",
        replacementCode: "return res.status(401).json({ error: 'Unauthorized' });",
    });
    assert(replace1.success === true, "Exact match code replacement succeeded");
    assert(replace1.matchedBy === "exact", "Matched via exact strategy");
    assert(replace1.modifiedContent.includes("res.status(401)"), "Modified content contains new status 401");

    // Scenario 2B: Whitespace-tolerant line replacement
    const replace2 = applyCodeReplacement({
        originalContent: originalFile,
        targetCode: "   return res.status(200).json({ error: 'Unauthorized' });  ", // different spacing
        replacementCode: "return res.status(401).json({ error: 'Unauthorized' });",
    });
    assert(replace2.success === true, "Whitespace-tolerant replacement succeeded");

    // -------------------------------------------------------------
    // Test 3: Standard Git Unified Diff Generation
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Standard Git Unified Diff Generation ---");
    const diff = generateUnifiedDiff({
        filePath: "src/controllers/auth.controller.js",
        originalContent: originalFile,
        modifiedContent: replace1.modifiedContent,
    });

    assert(diff.includes("diff --git a/src/controllers/auth.controller.js b/src/controllers/auth.controller.js"), "Diff includes standard git diff header");
    assert(diff.includes("--- a/src/controllers/auth.controller.js"), "Diff includes source file path (--- a/...)");
    assert(diff.includes("+++ b/src/controllers/auth.controller.js"), "Diff includes target file path (+++ b/...)");
    assert(diff.includes("@@ -"), "Diff includes hunk header (@@ -start,count +start,count @@)");
    assert(diff.includes("-        return res.status(200).json({ error: 'Unauthorized' });"), "Diff marks deleted line with '-'");
    assert(diff.includes("+        return res.status(401).json({ error: 'Unauthorized' });"), "Diff marks added line with '+'");

    // -------------------------------------------------------------
    // Test 4: Master Patch Synthesis Pipeline (Item 1 & 2)
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Master Patch Synthesis Pipeline ---");
    const failureEvidence = {
        testTitle: "should return 401 for unauthorized requests",
        errorName: "AssertionError",
        errorMessage: "Expected 401 but received 200",
        line: 5,
    };

    const patchResult = await synthesizePatch({
        projectId: "670f1a2b3c4d5e6f7a8b9c0d",
        projectName: "DevPilot Server",
        failure: failureEvidence,
        diagnosticReport: "Status code mismatch in unauthorized branch: returned 200 instead of 401.",
        filePath: "src/controllers/auth.controller.js",
        originalContent: originalFile,
    });

    assert(patchResult.success === true, "Patch synthesis succeeded");
    assert(patchResult.astValid === true, "Synthesized patch passed AST syntax check");
    assert(patchResult.syntaxError === null, "Zero syntax errors reported");
    assert(typeof patchResult.patchId === "string" && patchResult.patchId.startsWith("patch-"), "Generated unique patchId");
    assert(patchResult.unifiedDiff.length > 0, "Generated non-empty unified diff");
    assert(patchResult.modifiedContent.includes("401"), "Modified content reflects bugfix");
    assert(typeof patchResult.explanation === "string", "Patch includes clear explanation");

    // -------------------------------------------------------------
    // Test 5: AST Syntax Safety Guard
    // -------------------------------------------------------------
    console.log("\n--- Group 5: AST Syntax Safety Guard (Rejects Invalid Patches) ---");
    // Manually test a corrupt replacement that breaks syntax
    const corruptReplacement = applyCodeReplacement({
        originalContent: originalFile,
        targetCode: "return res.status(200).json({ error: 'Unauthorized' });",
        replacementCode: "return res.status(401).json( ;", // Syntax error!
    });
    const corruptAstCheck = validateAstSyntax({
        code: corruptReplacement.modifiedContent,
        filePath: "src/controllers/auth.controller.js",
    });

    assert(corruptAstCheck.valid === false, "Corrupt patch correctly caught by AST check before touching disk");
    assert(typeof corruptAstCheck.error === "string", "Syntax error caught and detailed");

    console.log("\n=================================================================");
    console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
    console.log("=================================================================\n");
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
