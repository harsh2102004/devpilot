import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import scanRoutes from './routes/scan.routes.js';
import chatRoutes from './routes/chat.routes.js';
import testRoutes from './routes/test.routes.js';
import githubRoutes from './routes/github.routes.js';
import { auth } from './middleware/auth.js';
import { ApiResponse } from './utils/ApiResponse.js';
import { ApiError } from './utils/ApiError.js';
import {
    generalRateLimiter,
    scanRateLimiter,
    chatRateLimiter,
    testRateLimiter,
    authRateLimiter,
} from './middleware/rateLimiter.js';

const app = express();

// Trust reverse proxy (Docker, Nginx, Load Balancer) for secure cookies and rate limiting (Task 7)
app.set("trust proxy", 1);

// 1. Production Security Headers with Helmet (Sub-Phase 10B & Task 7)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"], // Removed 'unsafe-inline' (Task 7)
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https://avatars.githubusercontent.com", "https:"],
                connectSrc: ["'self'", "http://localhost:5000", "http://localhost:5173", "ws:", "wss:"],
            },
        },
        crossOriginResourcePolicy: { policy: "cross-origin" },
        crossOriginEmbedderPolicy: false,
    })
);

// 2. Strict CORS Security Policy across ALL environments (Task 7)
export const getAllowedOrigins = () => {
    const origins = [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://localhost:80',
        'http://localhost',
    ];

    if (process.env.CLIENT_URL) {
        const clientUrl = process.env.CLIENT_URL.trim();
        if (clientUrl && !origins.includes(clientUrl)) {
            origins.push(clientUrl);
        }
    }
    return origins;
};

app.use(
    cors({
        origin: (origin, callback) => {
            const allowed = getAllowedOrigins();
            // Allow requests with no origin (mobile clients, curl, docker healthchecks) or in whitelist
            // Strict allow-list enforced in both development and production (no bypass)
            if (!origin || allowed.includes(origin)) {
                callback(null, true);
            } else {
                callback(new ApiError(403, `CORS blocked: Origin "${origin}" is not permitted by DevPilot security policy`));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
        exposedHeaders: ['Retry-After', 'Content-Range'],
        credentials: true,
        maxAge: 86400, // 24 hours preflight cache
    })
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));

// 3. Container & Cluster Healthcheck Endpoint (Sub-Phase 10A)
app.get('/api/health', (req, res) => {
    res.status(200).json(
        new ApiResponse(
            200,
            {
                status: 'healthy',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development',
            },
            'DevPilot Server is healthy'
        )
    );
});

// 4. Rate Limiting Protection (Sub-Phase 10B)
// Active in development and production; disabled in test runner to prevent test pollution
if (process.env.NODE_ENV !== "test") {
    app.use('/api/auth/login', authRateLimiter);
    app.use('/api/auth/register', authRateLimiter);
    app.use('/api/scan', scanRateLimiter);
    app.use('/api/chat', chatRateLimiter);
    app.use('/api/test', testRateLimiter);
    app.use('/api', generalRateLimiter);
}

// 5. Routes Declaration
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/test', testRoutes);


// Protected route test
app.get('/api/dashboard', auth, (req, res) => {
    res.status(200).json(
        new ApiResponse(200, { message: 'Welcome to the protected dashboard', user: req.user }, 'Dashboard fetched successfully')
    );
});

// Unknown route handler
app.use((req, res, next) => {
    next(new ApiError(404, 'Not Found'));
});

// Global Error handling middleware (Task 7: leak prevention)
export const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message;

    // 1. Defense-in-depth: automatically map any Mongoose CastError (e.g. invalid ObjectId) to HTTP 400
    if (err.name === "CastError") {
        statusCode = 400;
        message = `Invalid ID format for ${err.path || "parameter"}: ${err.value}`;
    } else if (err instanceof ApiError || err.name === "ApiError") {
        // Operational / known API errors
        statusCode = err.statusCode || 400;
        message = err.message;
    } else {
        // 2. Unexpected internal / database errors: hide raw internals from clients
        statusCode = 500;
        message = "Internal Server Error";
        // Log the real internal error securely server-side only
        console.error("[Internal Server Error]:", err);
    }

    res.status(statusCode).json({
        success: false,
        message,
        errors: err.errors || [],
        data: null
    });
};

app.use(errorHandler);

export { app };
export default app;
