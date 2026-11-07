import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { app, request } from "./testHelper.js";
import { initTestDb, closeTestDb, clearMockData, mockCollections } from "./testDb.js";
import User from "../src/models/User.js";

describe("Task 9: Authentication & Registration Hardening", () => {
    before(async () => {
        await initTestDb();
    });

    after(async () => {
        await closeTestDb();
    });

    beforeEach(() => {
        clearMockData();
    });

    it("1. Register without avatar returns HTTP 201", async () => {
        const uniqueSuffix = Date.now() + "_" + Math.floor(Math.random() * 10000);
        const username = `alice_${uniqueSuffix}`;
        const email = `alice_${uniqueSuffix}@example.com`;

        const res = await request(app)
            .post("/api/auth/register")
            .send({
                fullName: "Alice Developer",
                username,
                email,
                password: "SecurePassword123",
            });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.username, username);
        assert.strictEqual(res.body.data.email, email);
    });

    it("2. Register duplicate user returns HTTP 400", async () => {
        const uniqueSuffix = Date.now() + "_" + Math.floor(Math.random() * 10000);
        const username = `existing_${uniqueSuffix}`;
        const email = `existing_${uniqueSuffix}@example.com`;

        await User.create({
            fullName: "Existing User",
            username,
            email,
            password: "SecurePassword123",
        });

        const res = await request(app)
            .post("/api/auth/register")
            .send({
                fullName: "Duplicate User",
                username,
                email,
                password: "SecurePassword123",
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
    });

    it("3. Register with password < 10 chars returns HTTP 400", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .send({
                fullName: "Short Pass",
                username: "short_pass",
                email: "shortpass@example.com",
                password: "pass1",
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.message.includes("10 characters"));
    });

    it("4. Uploading .html file disguised or direct returns HTTP 400", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .field("fullName", "Malicious Upload")
            .field("username", "malicious_user")
            .field("email", "malicious@example.com")
            .field("password", "SecurePassword123")
            .attach("avatar", Buffer.from("<html><script>alert(1)</script></html>"), "exploit.html");

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.message.includes("Only image files"));
    });

    it("5. Login with query injection object returns HTTP 400", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .send({
                email: { $ne: null },
                password: "password12345",
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
    });

    it("6. Unknown user and wrong password return identical HTTP 401 responses", async () => {
        const uniqueSuffix = Date.now() + "_" + Math.floor(Math.random() * 10000);
        const knownEmail = `known_${uniqueSuffix}@example.com`;
        const knownUser = `known_${uniqueSuffix}`;

        await User.create({
            fullName: "Known Member",
            username: knownUser,
            email: knownEmail,
            password: "ValidPassword123",
        });

        // Unknown account
        const unknownRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: `unknown_${uniqueSuffix}@example.com`,
                password: "Password12345",
            });

        // Known account, wrong password
        const wrongPassRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: knownEmail,
                password: "WrongPassword999",
            });

        assert.strictEqual(unknownRes.status, 401);
        assert.strictEqual(wrongPassRes.status, 401);
        assert.strictEqual(unknownRes.body.message, "Invalid credentials");
        assert.strictEqual(wrongPassRes.body.message, "Invalid credentials");
        assert.deepStrictEqual(unknownRes.body, wrongPassRes.body);
    });
});
