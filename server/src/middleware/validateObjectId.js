/**
 * DevPilot ObjectId Validation Middleware
 *
 * Task 6: Prevents unhandled MongoDB CastError 500 crashes by validating
 * that route ID parameters (:projectId, :runId, :jobId, :id, etc.) are valid
 * 24-character hexadecimal MongoDB ObjectIds.
 *
 * Rejects malformed IDs (e.g. "abc", "123", or injection strings) with HTTP 400.
 */

import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";

const DEFAULT_ID_PARAMS = ["projectId", "runId", "jobId", "id", "userId"];

/**
 * Checks if a string is a valid 24-hex-character MongoDB ObjectId
 */
export const isValidObjectId = (val) => {
    if (!val || typeof val !== "string") return false;
    return mongoose.isValidObjectId(val) && /^[0-9a-fA-F]{24}$/.test(val.trim());
};

/**
 * Express middleware that validates ObjectId parameters in req.params
 * Can be used directly: `router.use(validateObjectId)`
 * Or as a factory specifying params: `validateObjectId("projectId", "runId")`
 */
export const validateObjectId = (...args) => {
    // Direct middleware signature: (req, res, next)
    if (args.length === 3 && typeof args[2] === "function" && args[0]?.params !== undefined) {
        const [req, , next] = args;
        return runValidation(req, next, DEFAULT_ID_PARAMS);
    }

    // Factory signature: validateObjectId("projectId") or validateObjectId(["projectId", "runId"])
    let targetParams = DEFAULT_ID_PARAMS;
    if (args.length > 0 && typeof args[0] !== "undefined") {
        targetParams = args.flat();
    }

    return (req, res, next) => {
        return runValidation(req, next, targetParams);
    };
};

function runValidation(req, next, targetParams) {
    if (!req.params) {
        return next();
    }

    for (const [key, val] of Object.entries(req.params)) {
        if (!val) continue;

        const isTarget = targetParams.includes(key) || key.toLowerCase().endsWith("id");
        if (isTarget) {
            if (!isValidObjectId(val)) {
                return next(new ApiError(400, `Invalid ID format for parameter "${key}": "${val}"`));
            }
        }
    }

    next();
}

export default validateObjectId;
