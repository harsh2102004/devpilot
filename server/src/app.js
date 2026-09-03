const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));

// Routes Import
const authRoutes = require('./routes/auth');

// Routes Declaration
app.use('/api/auth', authRoutes);

// Protected route test
const auth = require('./middleware/auth');
const { ApiResponse } = require('./utils/ApiResponse');

app.get('/api/dashboard', auth, (req, res) => {
  res.status(200).json(
    new ApiResponse(200, { message: 'Welcome to the protected dashboard', user: req.user }, 'Dashboard fetched successfully')
  );
});

// Global Error handling middleware
const { ApiError } = require('./utils/ApiError');

// Unknown route handler
app.use((req, res, next) => {
  next(new ApiError(404, 'Not Found'));
});

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

module.exports = { app };
