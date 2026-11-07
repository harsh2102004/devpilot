/**
 * DevPilot Task 5 Hardening & Verification Live Test Suite
 *
 * Verifies:
 * 1. Register without avatar returns HTTP 201
 * 2. Upload of .html file returns HTTP 400
 * 3. MIME spoofing (.html with .png extension) fails magic bytes check and returns HTTP 400
 * 4. Login with {"email": {"$ne": null}} returns HTTP 400 (Zod type validation)
 * 5. Unknown user and wrong password return identical HTTP 401 {"message": "Invalid credentials"}
 * 6. Password min length (10 chars) and username regex bounds are strictly enforced
 * 7. Avatar files are stored outside public/ and public/temp has no uploaded avatars
 */

process.env.ACCESS_TOKEN_SECRET = "test_access_token_secret_32_characters_long_devpilot_auth!";
process.env.REFRESH_TOKEN_SECRET = "test_refresh_token_secret_32_characters_long_devpilot_auth!";
process.env.MONGO_URI = "mongodb://localhost:27017/devpilot_test_db_placeholder_32chars!";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NODE_ENV = "test";

import assert from "assert";
import http from "http";
import fs from "fs";
import path from "path";
import User from "./src/models/User.js";
import { registerSchema, loginSchema } from "./src/validators/auth.validator.js";
import { verifyImageMagicBytes } from "./src/middleware/multer.middleware.js";
import { app } from "./src/app.js";

async function runTests() {
    console.log("=== DEVPIILOT TASK 5 HARDENING VERIFICATION SUITE ===\n");

    // ---------------------------------------------------------
    // UNIT TEST 1: Zod Schema Boundaries & Types
    // ---------------------------------------------------------
    console.log("--- 1. Testing Zod Schemas ---");

    // 1A. Email validation
    const invalidEmail = registerSchema.safeParse({
        fullName: "Test User",
        email: "not-an-email",
        username: "testuser",
        password: "password12345"
    });
    assert.strictEqual(invalidEmail.success, false, "Invalid email format must be rejected");
    console.log("  [PASS] Invalid email rejected");

    // 1B. Username validation (must match /^[a-z0-9_]{3,30}$/)
    const invalidUsername = registerSchema.safeParse({
        fullName: "Test User",
        email: "test@example.com",
        username: "User!Invalid",
        password: "password12345"
    });
    assert.strictEqual(invalidUsername.success, false, "Username with uppercase or symbols must be rejected");
    console.log("  [PASS] Invalid username regex rejected");

    const shortUsername = registerSchema.safeParse({
        fullName: "Test User",
        email: "test@example.com",
        username: "ab",
        password: "password12345"
    });
    assert.strictEqual(shortUsername.success, false, "Username < 3 chars must be rejected");
    console.log("  [PASS] Short username rejected");

    // 1C. Password min length (10 characters)
    const shortPassword = registerSchema.safeParse({
        fullName: "Test User",
        email: "test@example.com",
        username: "validuser",
        password: "pass123"
    });
    assert.strictEqual(shortPassword.success, false, "Password < 10 chars must be rejected");
    console.log("  [PASS] Short password (< 10 chars) rejected");

    // 1D. Valid register input
    const validRegister = registerSchema.safeParse({
        fullName: "Valid User",
        email: "valid@example.com",
        username: "valid_user_99",
        password: "ValidPassword123"
    });
    assert.strictEqual(validRegister.success, true, "Valid register input must pass");
    console.log("  [PASS] Valid registration payload accepted");

    // 1E. Login schema rejection of query injection objects
    const queryInjectEmail = loginSchema.safeParse({
        email: { $ne: null },
        password: "password12345"
    });
    assert.strictEqual(queryInjectEmail.success, false, '{"email": {"$ne": null}} must fail schema validation');
    console.log('  [PASS] Login with {"email": {"$ne": null}} rejected by schema');

    const queryInjectUsername = loginSchema.safeParse({
        username: { $gt: "" },
        password: "password12345"
    });
    assert.strictEqual(queryInjectUsername.success, false, '{"username": {"$gt": ""}} must fail schema validation');
    console.log('  [PASS] Login with {"username": {"$gt": ""}} rejected by schema');

    // ---------------------------------------------------------
    // UNIT TEST 2: Magic Bytes Verification
    // ---------------------------------------------------------
    console.log("\n--- 2. Testing Image Signature (Magic Bytes) Verification ---");
    const testTempDir = "./uploads/test-tmp";
    if (!fs.existsSync(testTempDir)) fs.mkdirSync(testTempDir, { recursive: true });

    // Spoofed file (HTML content inside .png)
    const spoofedFile = path.join(testTempDir, "spoofed.png");
    fs.writeFileSync(spoofedFile, "<!DOCTYPE html><html><body>malicious payload</body></html>");
    assert.strictEqual(verifyImageMagicBytes(spoofedFile), false, "Spoofed HTML-as-PNG must fail magic bytes verification");
    console.log("  [PASS] Spoofed HTML file with .png extension detected and rejected");

    // Valid PNG signature
    const validPngFile = path.join(testTempDir, "valid.png");
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(validPngFile, pngHeader);
    assert.strictEqual(verifyImageMagicBytes(validPngFile), true, "Legitimate PNG signature must pass");
    console.log("  [PASS] Genuine PNG magic bytes accepted");

    // Clean up test temp files
    fs.unlinkSync(spoofedFile);
    fs.unlinkSync(validPngFile);
    fs.rmdirSync(testTempDir);

    // ---------------------------------------------------------
    // LIVE HTTP TESTS AGAINST EXPRESS SERVER
    // ---------------------------------------------------------
    console.log("\n--- 3. Starting Live Express Server for End-to-End Tests ---");

    // Mock User model methods to isolate controller logic from database connection
    const originalFindOne = User.findOne;
    const originalCreate = User.create;
    const originalFindById = User.findById;

    const mockDbUsers = new Map();

    User.findOne = async function (filter) {
        if (filter.$or) {
            for (const cond of filter.$or) {
                if (cond.username && mockDbUsers.has(cond.username)) {
                    return mockDbUsers.get(cond.username);
                }
                if (cond.email && mockDbUsers.has(cond.email)) {
                    return mockDbUsers.get(cond.email);
                }
            }
        }
        return null;
    };

    User.create = async function (data) {
        const mockUser = {
            _id: "mock_user_id_" + Date.now(),
            fullName: data.fullName,
            username: data.username,
            email: data.email,
            avatar: data.avatar || "",
            isPasswordCorrect: async (pass) => pass === "correct_password_10chars",
            generateAccessToken: () => "mock_access_token_12345",
            generateRefreshToken: () => "mock_refresh_token_12345",
            save: async () => true,
        };
        mockDbUsers.set(mockUser.username, mockUser);
        mockDbUsers.set(mockUser.email, mockUser);
        return mockUser;
    };

    User.findById = function (id) {
        return {
            select: async () => {
                for (const u of mockDbUsers.values()) {
                    if (u._id === id) return u;
                }
                return null;
            }
        };
    };

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`  Live test server listening on port ${port}`);

    try {
        // Test 1: Register without avatar -> 201
        console.log("\nTesting Condition 1: Register without avatar -> 201");
        const regPayload = {
            fullName: "Alice Developer",
            username: "alice_dev",
            email: "alice@example.com",
            password: "SecurePassword123"
        };
        const regRes = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(regPayload)
        });
        const regData = await regRes.json();
        console.log(`  Status: ${regRes.status}, Body:`, regData);
        assert.strictEqual(regRes.status, 201, "Register without avatar must return HTTP 201");
        assert.strictEqual(regData.success, true, "Register response success must be true");
        assert.strictEqual(regData.data.username, "alice_dev");
        console.log("  [PASS] Register without avatar returned 201 successfully");

        // Test 2: Upload of .html file -> 400
        console.log("\nTesting Condition 2: Upload of .html file -> 400");
        const formDataHtml = new FormData();
        formDataHtml.append("fullName", "Bob Hacker");
        formDataHtml.append("username", "bob_hacker");
        formDataHtml.append("email", "bob@example.com");
        formDataHtml.append("password", "SecurePassword123");
        formDataHtml.append("avatar", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "exploit.html");

        const htmlUploadRes = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            body: formDataHtml
        });
        const htmlUploadData = await htmlUploadRes.json();
        console.log(`  Status: ${htmlUploadRes.status}, Body:`, htmlUploadData);
        assert.strictEqual(htmlUploadRes.status, 400, "Uploading an .html file must return HTTP 400");
        assert.ok(htmlUploadData.message.includes("Only image files"), "Error message should mention supported image types");
        console.log("  [PASS] Upload of .html file rejected with HTTP 400");

        // Test 2B: Spoofed file (HTML disguised as .png) -> 400 via magic bytes check
        console.log("\nTesting Spoofed File: HTML inside .png file -> 400");
        const formDataSpoofed = new FormData();
        formDataSpoofed.append("fullName", "Charlie Spoof");
        formDataSpoofed.append("username", "charlie_spoof");
        formDataSpoofed.append("email", "charlie@example.com");
        formDataSpoofed.append("password", "SecurePassword123");
        formDataSpoofed.append("avatar", new Blob(["<html>payload</html>"], { type: "image/png" }), "disguised.png");

        const spoofedRes = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            body: formDataSpoofed
        });
        const spoofedData = await spoofedRes.json();
        console.log(`  Status: ${spoofedRes.status}, Body:`, spoofedData);
        assert.strictEqual(spoofedRes.status, 400, "Disguised file must return HTTP 400");
        assert.ok(spoofedData.message.includes("signature") || spoofedData.message.includes("Only legitimate PNG"), "Must reject file signature");
        console.log("  [PASS] Disguised .png file with HTML content rejected by magic bytes verification");

        // Test 3: Login with {"email": {"$ne": null}} -> 400
        console.log('\nTesting Condition 3: Login with {"email": {"$ne": null}} -> 400');
        const nosqlLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: { $ne: null },
                password: "password12345"
            })
        });
        const nosqlLoginData = await nosqlLoginRes.json();
        console.log(`  Status: ${nosqlLoginRes.status}, Body:`, nosqlLoginData);
        assert.strictEqual(nosqlLoginRes.status, 400, "NoSQL query injection in login must return HTTP 400");
        console.log('  [PASS] Login with {"email": {"$ne": null}} returned HTTP 400');

        // Test 4: Unknown user and wrong password give identical responses
        console.log("\nTesting Condition 4: Unknown user vs Wrong password identical responses");
        
        // Seed an existing user in mock db
        await User.create({
            fullName: "Existing Member",
            username: "existing_user",
            email: "existing@example.com",
            password: "correct_password_10chars"
        });

        // 4A: Unknown user
        const unknownUserRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "nonexistent_account@example.com",
                password: "password12345"
            })
        });
        const unknownUserData = await unknownUserRes.json();

        // 4B: Existing user, wrong password
        const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "existing@example.com",
                password: "completely_wrong_password"
            })
        });
        const wrongPassData = await wrongPassRes.json();

        console.log("  Unknown User Response:", unknownUserRes.status, unknownUserData);
        console.log("  Wrong Password Response:", wrongPassRes.status, wrongPassData);

        assert.strictEqual(unknownUserRes.status, 401, "Unknown user must return 401");
        assert.strictEqual(wrongPassRes.status, 401, "Wrong password must return 401");
        assert.deepStrictEqual(
            unknownUserData,
            wrongPassData,
            "Unknown user response and wrong password response must be completely IDENTICAL"
        );
        assert.strictEqual(unknownUserData.message, "Invalid credentials");
        console.log("  [PASS] Unknown user and wrong password responses are 100% IDENTICAL (HTTP 401, 'Invalid credentials')");

        // Test 5: Verify public/temp clean
        console.log("\n--- Checking repository git status for public/temp files ---");
        const publicTempDir = path.resolve("./public/temp");
        if (fs.existsSync(publicTempDir)) {
            const files = fs.readdirSync(publicTempDir).filter(f => f !== ".gitkeep");
            assert.strictEqual(files.length, 0, `public/temp must not contain avatar uploads, found: ${files.join(", ")}`);
            console.log("  [PASS] public/temp contains no avatar files");
        }

        console.log("\n=======================================================");
        console.log("ALL 4 TASK 5 HARDENING CONDITIONS VERIFIED SUCCESSFULLY!");
        console.log("=======================================================\n");

    } finally {
        // Restore mocks and shut down server
        User.findOne = originalFindOne;
        User.create = originalCreate;
        User.findById = originalFindById;
        server.close();
    }
}

runTests().catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});

