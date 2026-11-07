/**
 * DevPilot Patch Review Modal Live Test Suite (Sub-Phase 9D)
 *
 * Verifies:
 * 1. Unified Diff Parsing (hunks, context, line markers, deletions, insertions)
 * 2. Side-by-Side (Split) Diff Row Alignment
 * 3. Exact line number tracking for original vs modified code
 * 4. Empty/edge-case diff handling
 */

import { parseUnifiedDiff, buildSplitDiffRows } from "../client/src/utils/diffParser.js";

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
    totalCount++;
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passedCount++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
    }
}

async function runTests() {
    console.log("=================================================================");
    console.log("  DevPilot Patch Review & Diff Engine (Sub-Phase 9D Live Test)");
    console.log("=================================================================\n");

    const sampleDiff = [
        "diff --git a/src/controllers/auth.controller.js b/src/controllers/auth.controller.js",
        "--- a/src/controllers/auth.controller.js",
        "+++ b/src/controllers/auth.controller.js",
        "@@ -3,6 +3,6 @@",
        "     if (!token) {",
        "         // BUG: returns 200 instead of 401",
        "-        return res.status(200).json({ error: 'Unauthorized' });",
        "+        return res.status(401).json({ error: 'Unauthorized' });",
        "     }",
        "     return next();",
    ].join("\n");

    // -------------------------------------------------------------
    // Group 1: Unified Diff Parsing
    // -------------------------------------------------------------
    console.log("--- Group 1: Unified Diff Parsing ---");
    const parsedRows = parseUnifiedDiff(sampleDiff);

    assert(Array.isArray(parsedRows), "parseUnifiedDiff returns an array of structured rows");
    assert(parsedRows.length > 0, "Parsed non-empty row list");

    const fileHeaders = parsedRows.filter((r) => r.type === "file-header");
    assert(fileHeaders.length === 2, "Captured 2 file header rows (--- and +++)");

    const hunkHeaders = parsedRows.filter((r) => r.type === "hunk-header");
    assert(hunkHeaders.length === 1, "Captured 1 hunk header row");
    assert(hunkHeaders[0].content.includes("@@ -3,6 +3,6 @@"), "Hunk header line preserved verbatim");

    const deleteRows = parsedRows.filter((r) => r.type === "delete");
    assert(deleteRows.length === 1, "Captured 1 deleted row");
    assert(deleteRows[0].origLine === 5, "Deleted row starts at original line 5");
    assert(deleteRows[0].marker === "-", "Deleted row marked with '-'");
    assert(deleteRows[0].content.includes("status(200)"), "Deleted line contains old status 200");

    const insertRows = parsedRows.filter((r) => r.type === "insert");
    assert(insertRows.length === 1, "Captured 1 inserted row");
    assert(insertRows[0].modLine === 5, "Inserted row mapped to modified line 5");
    assert(insertRows[0].marker === "+", "Inserted row marked with '+'");
    assert(insertRows[0].content.includes("status(401)"), "Inserted line contains new status 401");

    const contextRows = parsedRows.filter((r) => r.type === "context");
    assert(contextRows.length >= 3, "Captured surrounding context lines");

    // -------------------------------------------------------------
    // Group 2: Split (Side-by-Side) Diff Alignment
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Side-by-Side Split Diff Alignment ---");
    const splitRows = buildSplitDiffRows(parsedRows);

    assert(Array.isArray(splitRows), "buildSplitDiffRows returns array of paired rows");
    assert(splitRows.length > 0, "Generated non-empty split rows");

    // Locate the modified hunk pair
    const changedPair = splitRows.find((r) => r.left?.type === "delete" && r.right?.type === "insert");
    assert(Boolean(changedPair), "Paired deleted row directly with inserted row side-by-side");
    assert(changedPair.left.content.includes("status(200)"), "Left cell contains before state (status 200)");
    assert(changedPair.right.content.includes("status(401)"), "Right cell contains after state (status 401)");
    assert(changedPair.left.line === 5, "Left cell maintains original line number (5)");
    assert(changedPair.right.line === 5, "Right cell maintains modified line number (5)");

    // -------------------------------------------------------------
    // Group 3: Multi-Line Diff Grouping
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Multi-Line Diff Grouping ---");
    const multiDiff = [
        "@@ -10,4 +10,5 @@",
        "-const a = 1;",
        "-const b = 2;",
        "+const a = 10;",
        "+const b = 20;",
        "+const c = 30;",
        " return a + b;",
    ].join("\n");

    const parsedMulti = parseUnifiedDiff(multiDiff);
    const splitMulti = buildSplitDiffRows(parsedMulti);

    assert(parsedMulti.filter((r) => r.type === "delete").length === 2, "Captured 2 deleted lines");
    assert(parsedMulti.filter((r) => r.type === "insert").length === 3, "Captured 3 inserted lines");

    // In splitMulti, max(2, 3) = 3 rows for the change block
    const changedBlock = splitMulti.filter((r) => r.left?.type === "delete" || r.right?.type === "insert");
    assert(changedBlock.length === 3, "Split diff balanced unequal additions/deletions into 3 aligned rows");
    assert(changedBlock[2].left === null, "Third row has null on left (since original only had 2 deleted lines)");
    assert(changedBlock[2].right.content.includes("const c = 30;"), "Third row has newly added line on right");

    // -------------------------------------------------------------
    // Group 4: Edge Cases & Empty Diffs
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Edge Cases & Empty Diffs ---");
    assert(parseUnifiedDiff("").length === 0, "Empty diff string returns empty array");
    assert(parseUnifiedDiff(null).length === 0, "Null diff returns empty array");
    assert(buildSplitDiffRows([]).length === 0, "Empty parsed list returns empty split rows");

    console.log("\n=================================================================");
    console.log(`  Result: ${passedCount}/${totalCount} assertions passed (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log("=================================================================\n");

    if (passedCount < totalCount) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
