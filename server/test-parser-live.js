/**
 * DevPilot Test Parser Live Verification Test (Sub-Phase 8C)
 * 
 * Verifies:
 * 1. ANSI escape code stripping and path normalization
 * 2. Jest / Vitest output parsing (metrics, diffs, stack traces, line & column extraction)
 * 3. Mocha output parsing (passing/failing counts, assertion errors)
 * 4. Pytest output parsing (test identifiers, duration, tracebacks)
 * 5. Master parseTestOutput auto-detection and generic error fallback
 */

import {
    stripAnsi,
    normalizeFilePath,
    parseJestOutput,
    parseMochaOutput,
    parsePytestOutput,
    parseTestOutput,
} from "./src/services/testParser.service.js";

console.log("=================================================================");
console.log("  DevPilot Test Failure Parser Verification (Sub-Phase 8C Live)");
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
// Test 1: ANSI Stripping & Path Normalization
// -------------------------------------------------------------
console.log("--- Group 1: ANSI Stripper & Path Normalization ---");
const rawAnsi = "\u001b[31m\u001b[1mFAIL\u001b[22m\u001b[39m \u001b[2msrc/\u001b[22mauth.test.js\r\n";
const clean = stripAnsi(rawAnsi);
assert(!clean.includes("\u001b"), "stripAnsi eliminates ANSI escape sequences");
assert(!clean.includes("\r"), "stripAnsi eliminates carriage returns");
assert(clean.includes("FAIL src/auth.test.js"), "Sanitized text contains clean output");

const norm1 = normalizeFilePath("C:\\Users\\dev\\src\\index.js");
assert(norm1 === "C:/Users/dev/src/index.js", "normalizeFilePath converts backslashes");

const norm2 = normalizeFilePath("/workspace/src/controllers/scan.js");
assert(norm2 === "src/controllers/scan.js", "normalizeFilePath strips /workspace/ sandbox prefix");

// -------------------------------------------------------------
// Test 2: Jest / Vitest Output Parsing
// -------------------------------------------------------------
console.log("\n--- Group 2: Jest / Vitest Failure Extraction ---");
const sampleJestOutput = `
FAIL src/__tests__/auth.test.js
  Auth Service
    ✓ should generate access token (15 ms)
    ✓ should verify password hash (8 ms)
    ✕ should reject invalid password (45 ms)

  ● Auth Service › should reject invalid password

    expect(received).toBe(expected) // Object.is equality

    Expected: 401
    Received: 200

      33 |     const res = await loginUser({ email, password: "wrong" });
    > 34 |     expect(res.status).toBe(401);
         |                        ^
      35 | });

      at Object.<anonymous> (src/__tests__/auth.test.js:34:24)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total
Snapshots:   0 total
Time:        1.25 s
Ran all test suites.
`;

const jestReport = parseJestOutput(sampleJestOutput, 1);
assert(jestReport.runner === "jest", "Runner identified as jest");
assert(jestReport.summary.total === 3, `Total tests is 3 (actual: ${jestReport.summary.total})`);
assert(jestReport.summary.passed === 2, `Passed tests is 2 (actual: ${jestReport.summary.passed})`);
assert(jestReport.summary.failed === 1, `Failed tests is 1 (actual: ${jestReport.summary.failed})`);
assert(jestReport.summary.durationMs === 1250, `Parsed duration as 1250ms (actual: ${jestReport.summary.durationMs}ms)`);
assert(jestReport.failures.length === 1, "Extracted exactly 1 failure record");

const jestFail = jestReport.failures[0];
assert(jestFail.testTitle === "should reject invalid password", `Extracted test title: "${jestFail.testTitle}"`);
assert(jestFail.suiteName === "Auth Service", `Extracted suite name: "${jestFail.suiteName}"`);
assert(jestFail.filePath === "src/__tests__/auth.test.js", `Extracted culprit file path: "${jestFail.filePath}"`);
assert(jestFail.line === 34, `Extracted culprit line number: ${jestFail.line}`);
assert(jestFail.column === 24, `Extracted culprit column number: ${jestFail.column}`);
assert(jestFail.errorMessage.includes("Expected: 401") && jestFail.errorMessage.includes("Received: 200"), "Captured Expected/Received assertion diff");
assert(jestFail.codeSnippet.includes("expect(res.status).toBe(401)"), "Captured surrounding code snippet with caret");

// -------------------------------------------------------------
// Test 3: Mocha Output Parsing
// -------------------------------------------------------------
console.log("\n--- Group 3: Mocha Failure Extraction ---");
const sampleMochaOutput = `
  User Authentication
    ✔ handles registration flow (40ms)
    ✔ validates email uniqueness (25ms)
    1) rejects expired tokens

  2 passing (185ms)
  1 failing

  1) User Authentication
       rejects expired tokens:
     AssertionError [ERR_ASSERTION]: Expected 401 but received 200
      at Context.<anonymous> (test/auth.spec.js:52:18)
      at process.processImmediate (node:internal/timers:478:21)
`;

const mochaReport = parseMochaOutput(sampleMochaOutput, 1);
assert(mochaReport.runner === "mocha", "Runner identified as mocha");
assert(mochaReport.summary.total === 3, `Mocha total tests is 3 (actual: ${mochaReport.summary.total})`);
assert(mochaReport.summary.passed === 2, `Mocha passed tests is 2 (actual: ${mochaReport.summary.passed})`);
assert(mochaReport.summary.failed === 1, `Mocha failed tests is 1 (actual: ${mochaReport.summary.failed})`);
assert(mochaReport.summary.durationMs === 185, `Mocha duration parsed as 185ms (actual: ${mochaReport.summary.durationMs}ms)`);
assert(mochaReport.failures.length === 1, "Extracted 1 Mocha failure");

const mochaFail = mochaReport.failures[0];
assert(mochaFail.filePath === "test/auth.spec.js", `Extracted Mocha culprit file: "${mochaFail.filePath}"`);
assert(mochaFail.line === 52, `Extracted Mocha culprit line: ${mochaFail.line}`);
assert(mochaFail.column === 18, `Extracted Mocha culprit column: ${mochaFail.column}`);

// -------------------------------------------------------------
// Test 4: Pytest Output Parsing
// -------------------------------------------------------------
console.log("\n--- Group 4: Pytest Failure Extraction ---");
const samplePytestOutput = `
============================= test session starts =============================
collected 4 items

tests/test_calc.py ...F                                                  [100%]

=================================== FAILURES ===================================
________________________________ test_divide_zero ______________________________

    def test_divide_zero():
>       assert divide(10, 0) == "ZeroDivisionError"
E       ZeroDivisionError: division by zero

tests/test_calc.py:28: ZeroDivisionError
=========================== short test summary info ============================
FAILED tests/test_calc.py::test_divide_zero - ZeroDivisionError: division by zero
========================= 1 failed, 3 passed in 0.65s =========================
`;

const pytestReport = parsePytestOutput(samplePytestOutput, 1);
assert(pytestReport.runner === "pytest", "Runner identified as pytest");
assert(pytestReport.summary.total === 4, `Pytest total tests is 4 (actual: ${pytestReport.summary.total})`);
assert(pytestReport.summary.passed === 3, `Pytest passed tests is 3 (actual: ${pytestReport.summary.passed})`);
assert(pytestReport.summary.failed === 1, `Pytest failed tests is 1 (actual: ${pytestReport.summary.failed})`);
assert(pytestReport.summary.durationMs === 650, `Pytest duration parsed as 650ms (actual: ${pytestReport.summary.durationMs}ms)`);

const pyFail = pytestReport.failures[0];
assert(pyFail.filePath === "tests/test_calc.py", `Pytest culprit file: "${pyFail.filePath}"`);
assert(pyFail.line === 28, `Pytest culprit line: ${pyFail.line}`);
assert(pyFail.testTitle === "tests/test_calc.py::test_divide_zero", `Pytest test identifier: "${pyFail.testTitle}"`);

// -------------------------------------------------------------
// Test 5: Master parseTestOutput Auto-Detection
// -------------------------------------------------------------
console.log("\n--- Group 5: Master parseTestOutput Auto-Detection ---");
const autoJest = parseTestOutput({ rawOutput: sampleJestOutput, runner: "auto", exitCode: 1 });
assert(autoJest.runner === "jest", "Auto-detected Jest from raw text");
assert(autoJest.failures.length === 1, "Auto-parsed Jest failures correctly");

const autoPytest = parseTestOutput({ rawOutput: samplePytestOutput, runner: "auto", exitCode: 1 });
assert(autoPytest.runner === "pytest", "Auto-detected Pytest from raw text");

// Generic compile/runtime error fallback
const genericErrorOutput = `
SyntaxError: Unexpected identifier 'token'
    at ModuleLoader.compileSourceTextModule (node:internal/modules/esm/utils:357:16)
    at src/middleware/auth.middleware.js:18:9
`;
const autoGeneric = parseTestOutput({ rawOutput: genericErrorOutput, runner: "auto", exitCode: 1 });
assert(autoGeneric.runner === "generic", "Fell back to generic parser for unformatted runtime error");
assert(autoGeneric.failures.length >= 1, "Generic parser extracted failure record");
assert(autoGeneric.failures[0].filePath === "src/middleware/auth.middleware.js", `Extracted culprit file from generic stack: "${autoGeneric.failures[0].filePath}"`);
assert(autoGeneric.failures[0].line === 18, `Extracted culprit line from generic stack: ${autoGeneric.failures[0].line}`);

console.log("\n=================================================================");
console.log(`  Result: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
console.log("=================================================================\n");
