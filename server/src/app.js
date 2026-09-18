import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import { auth } from './middleware/auth.js';
import { ApiResponse } from './utils/ApiResponse.js';
import { ApiError } from './utils/ApiError.js';

const app = express();

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl) or matching dev ports
        if (!origin || /^http:\/\/localhost:(5173|5174|3000)$/.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));

// Routes Declaration
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);


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
