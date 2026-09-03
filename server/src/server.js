require('dotenv').config({ path: '../.env' }); // Ensure it points to the root server folder
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const { ApiError } = require('./utils/ApiError');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Protected route test
const auth = require('./middleware/auth');
const { ApiResponse } = require('./utils/ApiResponse');

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
  
  // If it's not an instance of ApiError, create a generic 500 error
  if (!(err instanceof ApiError)) {
    statusCode = 500;
    message = err.message || 'Internal Server Error';
    console.error(err); // Log unexpected errors
  }

  // Send response matching the ApiError structure
  res.status(statusCode || 500).json({
    success: false,
    message: message || 'Something went wrong',
    errors: err.errors || [],
    data: null
  });
});

const PORT = process.env.PORT || 5000;

// Database connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/devpilot')
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });
