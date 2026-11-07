/**
 * DevPilot Test Helper
 *
 * Configures test environment secrets before importing any application module,
 * provides JWT token generators, and exports configured supertest agent.
 */

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "super_secret_devpilot_access_key_2026_test32!";
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "super_secret_devpilot_refresh_key_2026_test32!";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/devpilot_test_db_32chars!";
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NODE_ENV = "test";

import jwt from "jsonwebtoken";
import request from "supertest";
import env from "../src/config/env.js";
import { app } from "../src/app.js";

export const generateTestToken = (userId, customPayload = {}) => {
    return jwt.sign(
        {
            user: {
                id: userId,
                _id: userId,
                email: customPayload.email || `user_${userId}@example.com`,
                name: customPayload.name || "Test User",
            },
            ...customPayload,
        },
        env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
    );
};

export const createSupertest = () => request(app);

export { app, env, request };

