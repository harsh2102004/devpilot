import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

const Home = () => {
  return (
    <div className="home-container">
      <div className="hero-section">
        <h1>Welcome to DevPilot</h1>
        <p className="subtitle">The AI Codebase Understanding & Debugging Platform</p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-primary btn-large">Get Started</Link>
          <Link to="/login" className="btn btn-outline btn-large">Login</Link>
        </div>
      </div>
    </div>
  );
};

export default Home;
