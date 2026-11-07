/**
 * DevPilot Environment Configuration & Secret Validator
 *
 * Enforces strict environment secret validation at startup.
 * Throws and terminates process if critical secrets are missing or shorter than 32 characters.
 */

import dotenv from "dotenv";

// Load environment variables from .env if present
dotenv.config();

const REQUIRED_ENVS = ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "MONGO_URI"];
const MIN_SECRET_LENGTH = 32;

export const validateEnvironment = () => {
    const errors = [];

    for (const envName of REQUIRED_ENVS) {
        const value = process.env[envName];

        if (!value || typeof value !== "string" || !value.trim()) {
            errors.push(`Missing required environment variable: ${envName}`);
        } else if (value.trim().length < MIN_SECRET_LENGTH) {
            errors.push(
                `Environment variable ${envName} is too short (length: ${value.trim().length}). Must be at least ${MIN_SECRET_LENGTH} characters.`
            );
        }
    }

    if (errors.length > 0) {
        const errorHeader = "\n===================================================\n❌ [DevPilot Fatal Config Error] Environment validation failed:\n===================================================";
        console.error(errorHeader);
        errors.forEach((err) => console.error(`  - ${err}`));
        console.error("===================================================\nPlease configure secure 32+ character secrets in your .env file.\n");
        throw new Error(`Environment validation failed:\n${errors.join("\n")}`);
    }
};

// Validate immediately on module evaluation
validateEnvironment();

export const env = {
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
    MONGO_URI: process.env.MONGO_URI,
    ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    PORT: process.env.PORT || 5000,
    NODE_ENV: process.env.NODE_ENV || "development",
};

export default env;
