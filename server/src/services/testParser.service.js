/**
 * DevPilot Test Output Stream Capture & Multi-Runner Failure Parsing Engine (Sub-Phase 8C)
 *
 * Strips ANSI codes, extracts structured test metrics (total, passed, failed, skipped, duration),
 * and pinpoints failure diagnostics (culprit file paths, line numbers, error messages, stack traces).
 * Supports: Jest, Vitest, Mocha, Pytest, and Generic fallback.
 */

/**
 * Strips ANSI terminal escape codes, cursor control sequences, and carriage returns.
 *
 * @param {string} text - Raw terminal output
 * @returns {string} Sanitized plain text
 */
export const stripAnsi = (text) => {
    if (!text || typeof text !== "string") return "";
    return text
        .replace(/[\u001b\x1b]\[[0-9;]*[a-zA-Z]/g, "")
        .replace(/[\u001b\x1b]\([a-zA-Z0-9]/g, "")
        .replace(/\r/g, "");
};

/**
 * Cleans and normalizes relative file paths extracted from stack traces.
 *
 * @param {string} rawPath - Extracted path string
 * @returns {string} Normalized path
 */
export const normalizeFilePath = (rawPath) => {
    if (!rawPath) return "";
    let clean = rawPath.trim().replace(/\\/g, "/");
    // Strip leading file:// prefix if present
    clean = clean.replace(/^file:\/\/\/?/, "");
    // Strip common sandbox prefixes like /workspace/
    clean = clean.replace(/^\/workspace\//, "");
    return clean;
};

/**
 * Parses Jest / Vitest test output
 *
 * @param {string} cleanText - ANSI-stripped text
 * @param {number} exitCode
 * @param {number} fallbackDurationMs
 * @returns {object} Parsed test report
 */
export const parseJestOutput = (cleanText, exitCode = 0, fallbackDurationMs = 0) => {
    const failures = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let durationMs = fallbackDurationMs;

    // 1. Extract Summary Metrics
    // Example: "Tests:       1 failed, 2 skipped, 4 passed, 7 total"
    const testsRegex = /Tests:\s+(.+)/i;
    const testsMatch = cleanText.match(testsRegex);
    if (testsMatch) {
        const line = testsMatch[1];
        const failedMatch = line.match(/(\d+)\s+failed/i);
        const passedMatch = line.match(/(\d+)\s+passed/i);
        const skippedMatch = line.match(/(\d+)\s+(?:skipped|todo|pending)/i);
        const totalMatch = line.match(/(\d+)\s+total/i);

        if (failedMatch) failed = parseInt(failedMatch[1], 10);
        if (passedMatch) passed = parseInt(passedMatch[1], 10);
        if (skippedMatch) skipped = parseInt(skippedMatch[1], 10);
        if (totalMatch) total = parseInt(totalMatch[1], 10);
        else total = failed + passed + skipped;
    }

    // Extract execution time: "Time:        2.345 s" or "Time: 450 ms"
    const timeMatch = cleanText.match(/Time:\s+([\d.]+)\s*(s|ms)/i);
    if (timeMatch) {
        const val = parseFloat(timeMatch[1]);
        durationMs = timeMatch[2].toLowerCase() === "s" ? Math.round(val * 1000) : Math.round(val);
    }

    // 2. Extract Failures
    // Blocks starting with "● <Suite> › <Test>"
    const failureBlocks = cleanText.split(/\n\s*●\s+/);
    if (failureBlocks.length > 1) {
        for (let i = 1; i < failureBlocks.length; i++) {
            const block = failureBlocks[i];
            const lines = block.split("\n");
            const titleLine = lines[0].trim();

            let suiteName = "";
            let testTitle = titleLine;
            if (titleLine.includes("›")) {
                const parts = titleLine.split("›").map((s) => s.trim());
                suiteName = parts[0];
                testTitle = parts.slice(1).join(" › ");
            }

            // Extract Error Message & Expected/Received diff
            let errorMessage = "";
            let errorName = "AssertionError";
            const diffLines = [];
            const codeSnippetLines = [];
            const stackLines = [];
            let inSnippet = false;

            for (let j = 1; j < lines.length; j++) {
                const line = lines[j];
                const trimmed = line.trim();

                if (/^[A-Za-z]+Error:/.test(trimmed)) {
                    const match = trimmed.match(/^([A-Za-z]+Error):\s*(.*)/);
                    if (match) {
                        errorName = match[1];
                        errorMessage = match[2];
                    }
                } else if (/^(Expected|Received):/.test(trimmed)) {
                    diffLines.push(trimmed);
                } else if (/^\s*>\s*\d+\s*\|/.test(line) || /^\s*\d+\s*\|/.test(line)) {
                    inSnippet = true;
                    codeSnippetLines.push(line);
                } else if (inSnippet && /^\s*\|\s*[\^~]/.test(line)) {
                    codeSnippetLines.push(line);
                } else if (/^\s*at\s+/.test(trimmed)) {
                    inSnippet = false;
                    stackLines.push(trimmed);
                }
            }

            if (!errorMessage && diffLines.length > 0) {
                errorMessage = diffLines.join("; ");
            }
            if (!errorMessage && lines[1]) {
                errorMessage = lines[1].trim();
            }

            // Pinpoint culprit file path, line, and column from stack trace
            let filePath = "";
            let lineNumber = 0;
            let columnNumber = 0;

            for (const stackLine of stackLines) {
                // Match: at Object.<anonymous> (src/controllers/auth.js:35:15) or at src/controllers/auth.js:35:15
                const locMatch = stackLine.match(/(?:at\s+.*?\s+\((.*?):(\d+):(\d+)\)|at\s+(.*?):(\d+):(\d+))/);
                if (locMatch) {
                    const candidatePath = locMatch[1] || locMatch[4];
                    const candidateLine = parseInt(locMatch[2] || locMatch[5], 10);
                    const candidateCol = parseInt(locMatch[3] || locMatch[6], 10);

                    // Prefer user/source files over node_modules
                    if (!candidatePath.includes("node_modules")) {
                        filePath = normalizeFilePath(candidatePath);
                        lineNumber = candidateLine;
                        columnNumber = candidateCol;
                        break;
                    }
                    if (!filePath) {
                        filePath = normalizeFilePath(candidatePath);
                        lineNumber = candidateLine;
                        columnNumber = candidateCol;
                    }
                }
            }

            failures.push({
                testTitle: testTitle || titleLine || "Unknown Test Failure",
                suiteName,
                filePath,
                line: lineNumber,
                column: columnNumber,
                errorName,
                errorMessage: errorMessage || "Test failed",
                stackTrace: stackLines.join("\n"),
                codeSnippet: codeSnippetLines.join("\n"),
            });
        }
    }

    // Fallback if failed > 0 or exitCode !== 0 but no ● blocks found
    if (failures.length === 0 && (failed > 0 || exitCode !== 0)) {
        failures.push(...extractGenericErrors(cleanText));
    }

    if (total === 0) {
        failed = failures.length;
        total = failed;
    }

    return {
        runner: "jest",
        summary: {
            total,
            passed,
            failed: Math.max(failed, failures.length),
            skipped,
            durationMs,
            exitCode,
        },
        failures,
    };
};

/**
 * Parses Mocha test output
 *
 * @param {string} cleanText
 * @param {number} exitCode
 * @param {number} fallbackDurationMs
 * @returns {object}
 */
export const parseMochaOutput = (cleanText, exitCode = 0, fallbackDurationMs = 0) => {
    const failures = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let durationMs = fallbackDurationMs;

    // Example: "  2 passing (120ms)"
    const passingMatch = cleanText.match(/(\d+)\s+passing\s+\(([\d.]+)\s*(s|ms)\)/i);
    if (passingMatch) {
        passed = parseInt(passingMatch[1], 10);
        const durVal = parseFloat(passingMatch[2]);
        durationMs = passingMatch[3].toLowerCase() === "s" ? Math.round(durVal * 1000) : Math.round(durVal);
    }

    // Example: "  1 failing"
    const failingMatch = cleanText.match(/(\d+)\s+failing/i);
    if (failingMatch) {
        failed = parseInt(failingMatch[1], 10);
    }

    total = passed + failed;

    // Mocha failure section: starts with "  1) <Suite> <Test>:"
    const mochaFailureRegex = /\s*(\d+)\)\s+(.+?):\n([\s\S]+?)(?=\n\s*\d+\)|\n\s*\d+\s+passing|\n\s*\d+\s+failing|$)/g;
    let match;
    while ((match = mochaFailureRegex.exec(cleanText)) !== null) {
        const title = match[2].trim();
        const details = match[3];
        const lines = details.split("\n");

        let errorName = "AssertionError";
        let errorMessage = "";
        const stackLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^[A-Za-z]+Error:/.test(trimmed) && !errorMessage) {
                const em = trimmed.match(/^([A-Za-z]+Error):\s*(.*)/);
                if (em) {
                    errorName = em[1];
                    errorMessage = em[2];
                }
            } else if (/^\s*at\s+/.test(trimmed)) {
                stackLines.push(trimmed);
            } else if (!errorMessage && trimmed && !trimmed.startsWith("+") && !trimmed.startsWith("-")) {
                errorMessage = trimmed;
            }
        }

        let filePath = "";
        let lineNumber = 0;
        let columnNumber = 0;

        for (const stackLine of stackLines) {
            const locMatch = stackLine.match(/(?:at\s+.*?\s+\((.*?):(\d+):(\d+)\)|at\s+(.*?):(\d+):(\d+))/);
            if (locMatch) {
                const candidatePath = locMatch[1] || locMatch[4];
                if (!candidatePath.includes("node_modules")) {
                    filePath = normalizeFilePath(candidatePath);
                    lineNumber = parseInt(locMatch[2] || locMatch[5], 10);
                    columnNumber = parseInt(locMatch[3] || locMatch[6], 10);
                    break;
                }
            }
        }

        failures.push({
            testTitle: title,
            filePath,
            line: lineNumber,
            column: columnNumber,
            errorName,
            errorMessage: errorMessage || "Assertion failed",
            stackTrace: stackLines.join("\n"),
        });
    }

    if (failures.length === 0 && (failed > 0 || exitCode !== 0)) {
        failures.push(...extractGenericErrors(cleanText));
    }

    return {
        runner: "mocha",
        summary: {
            total: Math.max(total, failures.length),
            passed,
            failed: Math.max(failed, failures.length),
            skipped: 0,
            durationMs,
            exitCode,
        },
        failures,
    };
};

/**
 * Parses Python / Pytest test output
 *
 * @param {string} cleanText
 * @param {number} exitCode
 * @param {number} fallbackDurationMs
 * @returns {object}
 */
export const parsePytestOutput = (cleanText, exitCode = 0, fallbackDurationMs = 0) => {
    const failures = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let durationMs = fallbackDurationMs;

    // Summary line: "=== 1 failed, 3 passed in 0.45s ==="
    const summaryMatch = cleanText.match(/=+\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?.*?in\s+([\d.]+)\s*s\s+=+/i);
    if (summaryMatch) {
        if (summaryMatch[1]) failed = parseInt(summaryMatch[1], 10);
        if (summaryMatch[2]) passed = parseInt(summaryMatch[2], 10);
        if (summaryMatch[3]) durationMs = Math.round(parseFloat(summaryMatch[3]) * 1000);
        total = failed + passed;
    }

    // Pytest FAILED lines: "FAILED tests/test_auth.py::test_login - AssertionError: ..."
    const failedLines = cleanText.match(/^FAILED\s+(.+)$/gm) || [];
    for (const fLine of failedLines) {
        const match = fLine.match(/^FAILED\s+(.*?)::([^\s-]+)(?:\s+-\s+(.+))?/);
        if (match) {
            const rawFile = match[1];
            const testName = match[2];
            const errorMsg = match[3] || "Test assertion failed";

            // Find line number in traceback if available (e.g. "tests/test_auth.py:42: AssertionError")
            let lineNum = 0;
            const lineMatch = cleanText.match(new RegExp(`${rawFile.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}:(\\d+):`));
            if (lineMatch) {
                lineNum = parseInt(lineMatch[1], 10);
            }

            failures.push({
                testTitle: `${rawFile}::${testName}`,
                filePath: normalizeFilePath(rawFile),
                line: lineNum,
                column: 0,
                errorName: errorMsg.split(":")[0] || "AssertionError",
                errorMessage: errorMsg,
                stackTrace: fLine,
            });
        }
    }

    if (failures.length === 0 && (failed > 0 || exitCode !== 0)) {
        failures.push(...extractGenericErrors(cleanText));
    }

    return {
        runner: "pytest",
        summary: {
            total: Math.max(total, failures.length),
            passed,
            failed: Math.max(failed, failures.length),
            skipped: 0,
            durationMs,
            exitCode,
        },
        failures,
    };
};

/**
 * Fallback regex extractor for generic compile errors, syntax errors, or uncaught exceptions
 *
 * @param {string} text
 * @returns {Array<object>}
 */
export const extractGenericErrors = (text) => {
    const failures = [];

    // Check for standard Error: messages
    const errorMatch = text.match(/(?:Error|SyntaxError|ReferenceError|TypeError|AssertionError):\s*([^\n]+)/);
    const errorMsg = errorMatch ? errorMatch[1] : "Execution failure";
    const errorName = errorMatch ? errorMatch[0].split(":")[0] : "ExecutionError";

    let filePath = "";
    let line = 0;
    let column = 0;

    // Search all stack lines for the best user code location (skipping node internals & node_modules)
    const stackRegex = /(?:at\s+.*?\s+\((.*?):(\d+):(\d+)\)|at\s+(.*?):(\d+):(\d+))/g;
    let sMatch;
    let fallbackLocation = null;

    while ((sMatch = stackRegex.exec(text)) !== null) {
        const candidatePath = sMatch[1] || sMatch[4];
        const candidateLine = parseInt(sMatch[2] || sMatch[5], 10);
        const candidateCol = parseInt(sMatch[3] || sMatch[6], 10);

        if (!fallbackLocation) {
            fallbackLocation = { path: candidatePath, line: candidateLine, col: candidateCol };
        }

        // Filter out node internals and node_modules to pinpoint user code
        if (
            !candidatePath.includes("node_modules") &&
            !candidatePath.startsWith("node:") &&
            !candidatePath.includes("node:internal")
        ) {
            filePath = normalizeFilePath(candidatePath);
            line = candidateLine;
            column = candidateCol;
            break;
        }
    }

    if (!filePath && fallbackLocation) {
        filePath = normalizeFilePath(fallbackLocation.path);
        line = fallbackLocation.line;
        column = fallbackLocation.col;
    }

    if (errorMatch || filePath) {
        failures.push({
            testTitle: errorName,
            filePath,
            line,
            column,
            errorName,
            errorMessage: errorMsg,
            stackTrace: text.slice(0, 1000),
        });
    }

    return failures;
};

/**
 * Generic test parser fallback when runner is unknown or custom
 *
 * @param {string} cleanText
 * @param {number} exitCode
 * @param {number} fallbackDurationMs
 * @returns {object}
 */
export const parseGenericOutput = (cleanText, exitCode = 0, fallbackDurationMs = 0) => {
    const failures = extractGenericErrors(cleanText);
    const failed = exitCode !== 0 ? Math.max(1, failures.length) : 0;
    const passed = exitCode === 0 ? 1 : 0;

    return {
        runner: "generic",
        summary: {
            total: passed + failed,
            passed,
            failed,
            skipped: 0,
            durationMs: fallbackDurationMs,
            exitCode,
        },
        failures,
    };
};

/**
 * Master parser interface: Automatically detects or uses specified test runner,
 * cleans ANSI escape sequences, extracts structured metrics and culprit failure traces.
 *
 * @param {object} params
 * @param {string} params.rawOutput - Raw stdout/stderr terminal output
 * @param {string} [params.runner="auto"] - "jest" | "vitest" | "mocha" | "pytest" | "auto"
 * @param {number} [params.exitCode=0] - Process exit code
 * @param {number} [params.durationMs=0] - Recorded duration
 * @returns {object} Standardized parsed test report
 */
export const parseTestOutput = ({
    rawOutput = "",
    runner = "auto",
    exitCode = 0,
    durationMs = 0,
}) => {
    const cleanText = stripAnsi(rawOutput);

    // Auto-detect runner if set to "auto"
    let selectedRunner = runner;
    if (selectedRunner === "auto" || !selectedRunner) {
        if (/Test Suites:.*Tests:/i.test(cleanText) || /●\s+/i.test(cleanText)) {
            selectedRunner = "jest";
        } else if (/\d+\s+passing.*\(.*ms\)/i.test(cleanText) || /\d+\s+failing/i.test(cleanText)) {
            selectedRunner = "mocha";
        } else if (/=+ FAILURES =+/i.test(cleanText) || /^FAILED\s+.*::/m.test(cleanText)) {
            selectedRunner = "pytest";
        } else {
            selectedRunner = "generic";
        }
    }

    let parsedResult;
    switch (selectedRunner.toLowerCase()) {
        case "jest":
        case "vitest":
            parsedResult = parseJestOutput(cleanText, exitCode, durationMs);
            break;
        case "mocha":
            parsedResult = parseMochaOutput(cleanText, exitCode, durationMs);
            break;
        case "pytest":
            parsedResult = parsePytestOutput(cleanText, exitCode, durationMs);
            break;
        default:
            parsedResult = parseGenericOutput(cleanText, exitCode, durationMs);
            break;
    }

    return {
        ...parsedResult,
        rawOutputSanitized: cleanText,
    };
};

export default {
    stripAnsi,
    normalizeFilePath,
    parseJestOutput,
    parseMochaOutput,
    parsePytestOutput,
    parseGenericOutput,
    parseTestOutput,
};
