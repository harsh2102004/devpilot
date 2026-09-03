const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { ApiResponse } = require('../utils/ApiResponse');

// Register endpoint
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  if (!name || !email || !password) {
    throw new ApiError(400, 'Please provide all fields');
  }

  // Check if user exists
  let user = await User.findOne({ email });
  if (user) {
    throw new ApiError(409, 'User already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  user = new User({
    name,
    email,
    password: hashedPassword
  });

  await user.save();

  // Create JWT
  const payload = {
    user: {
      id: user.id
    }
  };

  jwt.sign(
    payload,
    process.env.ACCESS_TOKEN_SECRET || 'fallback_secret',
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d' },
    (err, token) => {
      if (err) throw new ApiError(500, 'Token generation failed');
      
      return res.status(201).json(
        new ApiResponse(201, { 
          token, 
          user: { id: user.id, name: user.name, email: user.email } 
        }, 'User registered successfully')
      );
    }
  );
}));

// Login endpoint
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    throw new ApiError(400, 'Please provide all fields');
  }

  // Check for user
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(401, 'Invalid Credentials');
  }

  // Check password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid Credentials');
  }

  // Create JWT
  const payload = {
    user: {
      id: user.id
    }
  };

  jwt.sign(
    payload,
    process.env.ACCESS_TOKEN_SECRET || 'fallback_secret',
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d' },
    (err, token) => {
      if (err) throw new ApiError(500, 'Token generation failed');
      
      return res.status(200).json(
        new ApiResponse(200, { 
          token, 
          user: { id: user.id, name: user.name, email: user.email } 
        }, 'User logged in successfully')
      );
    }
  );
}));

module.exports = router;
