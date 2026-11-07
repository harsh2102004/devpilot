/**
 * DevPilot Diff Parser & Alignment Utilities (Sub-Phase 9D)
 *
 * Provides pure parsing and alignment logic for rendering Unified and
 * Side-by-Side (Split) git diffs.
 */

/**
 * Parses raw unified git diff text into structured row objects.
 *
 * @param {string} diffText - Standard unified git diff text
 * @returns {Array<object>} Parsed diff items
 */
export const parseUnifiedDiff = (diffText) => {
    if (!diffText || typeof diffText !== "string") return [];

    const rawLines = diffText.split(/\r?\n/);
    const rows = [];
    let origLineNum = 0;
    let modLineNum = 0;

    for (const line of rawLines) {
        if (line.startsWith("diff --git") || line.startsWith("index ")) {
            continue;
        }

        if (line.startsWith("--- ") || line.startsWith("+++ ")) {
            rows.push({
                type: "file-header",
                content: line,
            });
            continue;
        }

        // Hunk header e.g. @@ -5,7 +5,7 @@
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (hunkMatch) {
            origLineNum = parseInt(hunkMatch[1], 10);
            modLineNum = parseInt(hunkMatch[2], 10);
            rows.push({
                type: "hunk-header",
                content: line,
                hunkHeader: line,
            });
            continue;
        }

        if (line.startsWith("-")) {
            rows.push({
                type: "delete",
                origLine: origLineNum++,
                modLine: null,
                marker: "-",
                content: line.slice(1),
            });
        } else if (line.startsWith("+")) {
            rows.push({
                type: "insert",
                origLine: null,
                modLine: modLineNum++,
                marker: "+",
                content: line.slice(1),
            });
        } else if (line.startsWith(" ") || line === "") {
            rows.push({
                type: "context",
                origLine: origLineNum++,
                modLine: modLineNum++,
                marker: " ",
                content: line.startsWith(" ") ? line.slice(1) : line,
            });
        }
    }

    return rows;
};

/**
 * Aligns parsed diff rows into paired columns for side-by-side split diff viewing.
 *
 * @param {Array<object>} parsedRows
 * @returns {Array<{ left?: object, right?: object, isHunk?: boolean, content?: string }>}
 */
export const buildSplitDiffRows = (parsedRows) => {
    if (!parsedRows || !Array.isArray(parsedRows)) return [];

    const splitRows = [];
    let i = 0;

    while (i < parsedRows.length) {
        const row = parsedRows[i];

        if (row.type === "hunk-header" || row.type === "file-header") {
            splitRows.push({
                isHunk: true,
                type: row.type,
                content: row.content,
            });
            i++;
            continue;
        }

        if (row.type === "context") {
            splitRows.push({
                left: { line: row.origLine, content: row.content, type: "context" },
                right: { line: row.modLine, content: row.content, type: "context" },
            });
            i++;
            continue;
        }

        // Group consecutive deletes and inserts together
        const deletes = [];
        const inserts = [];

        while (i < parsedRows.length && (parsedRows[i].type === "delete" || parsedRows[i].type === "insert")) {
            if (parsedRows[i].type === "delete") {
                deletes.push(parsedRows[i]);
            } else {
                inserts.push(parsedRows[i]);
            }
            i++;
        }

        const maxLen = Math.max(deletes.length, inserts.length);
        for (let k = 0; k < maxLen; k++) {
            const del = deletes[k];
            const ins = inserts[k];
            splitRows.push({
                left: del ? { line: del.origLine, content: del.content, type: "delete" } : null,
                right: ins ? { line: ins.modLine, content: ins.content, type: "insert" } : null,
            });
        }
    }

    return splitRows;
};

export default {
    parseUnifiedDiff,
    buildSplitDiffRows,
};

