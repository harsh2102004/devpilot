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

// 1. Production Security Headers with Helmet (Sub-Phase 10B)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
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

// 2. Strict CORS Security Policy (Sub-Phase 10B)
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:80',
    'http://localhost',
];

if (process.env.CLIENT_URL) {
    allowedOrigins.push(process.env.CLIENT_URL.trim());
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile clients, curl, docker healthchecks) or in whitelist
            if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
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
app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/register', authRateLimiter);
app.use('/api/scan', scanRateLimiter);
app.use('/api/chat', chatRateLimiter);
app.use('/api/test', testRateLimiter);
app.use('/api', generalRateLimiter);

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

// Global Error handling middleware
app.use((err, req, res, next) => {
    let { statusCode, message } = err;

    if (!(err instanceof ApiError)) {
        statusCode = 500;
        message = err.message || 'Internal Server Error';
        console.error(err);
    }

    res.status(statusCode || 500).json({
        success: false,
        message: message || 'Something went wrong',
        errors: err.errors || [],
        data: null
    });
});

export { app };
export default app;
