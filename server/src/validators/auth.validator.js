/**
 * DevPilot Authentication Input Validation Schemas (Zod)
 *
 * Enforces strict typing and bounds:
 * 1. registerSchema:
 *    - fullName: string, 1-100 chars
 *    - email: valid email format, string
 *    - username: string, matching /^[a-z0-9_]{3,30}$/
 *    - password: string, minimum 10 characters
 * 2. loginSchema:
 *    - email or username: strictly string, rejecting query injection objects
 *    - password: string
 */

import { z } from "zod";

export const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

export const registerSchema = z.object({
    fullName: z
        .string({
            required_error: "Full name is required",
            invalid_type_error: "Full name must be a string",
        })
        .trim()
        .min(1, "Full name cannot be empty")
        .max(100, "Full name must be at most 100 characters"),
    email: z
        .string({
            required_error: "Email is required",
            invalid_type_error: "Email must be a string",
        })
        .trim()
        .email("Invalid email format")
        .max(255, "Email is too long"),
    username: z
        .string({
            required_error: "Username is required",
            invalid_type_error: "Username must be a string",
        })
        .trim()
        .toLowerCase()
        .regex(
            USERNAME_REGEX,
            "Username must be 3-30 characters and contain only lowercase letters, numbers, and underscores"
        ),
    password: z
        .string({
            required_error: "Password is required",
            invalid_type_error: "Password must be a string",
        })
        .min(10, "Password must be at least 10 characters long"),
});

export const loginSchema = z
    .object({
        username: z
            .string({
                invalid_type_error: "Username must be a string",
            })
            .trim()
            .toLowerCase()
            .optional(),
        email: z
            .string({
                invalid_type_error: "Email must be a string",
            })
            .trim()
            .toLowerCase()
            .optional(),
        password: z
            .string({
                required_error: "Password is required",
                invalid_type_error: "Password must be a string",
            }),
    })
    .refine((data) => Boolean(data.username || data.email), {
        message: "Username or email is required",
        path: ["email"],
    });

export default {
    USERNAME_REGEX,
    registerSchema,
    loginSchema,
};
