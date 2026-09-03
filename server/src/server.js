require('dotenv').config({ path: '../.env' }); // Ensure it points to the root server folder
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const { ApiError } = require('./utils/ApiError');
const connectDB = require('./db/index'); // Import the DB connection function

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

const PORT = process.env.PORT || 5000;

// Connect to MongoDB and start server
connectDB()
.then(() => {
    app.listen(PORT, () => {
        console.log(`⚙️ Server is running at port : ${PORT}`);
    })
})
.catch((err) => {
    console.log("MONGO db connection failed !!! ", err);
})
