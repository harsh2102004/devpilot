import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Dashboard.css';

const Dashboard = () => {
  const { user, loading } = useContext(AuthContext);
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/dashboard');
        setDashboardData(res.data);
      } catch (err) {
        setError('Failed to fetch dashboard data. Are you logged in?');
      }
    };
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  if (loading) return <div>Loading...</div>;
  if (!user) return null;

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Dashboard</h1>
        <p>Welcome back, {user.name}!</p>
      </header>
      
      <div className="dashboard-content">
        <div className="card">
          <h3>Connection Status</h3>
          {error ? (
            <p className="text-danger">{error}</p>
          ) : dashboardData ? (
            <p className="text-success">{dashboardData.message}</p>
          ) : (
            <p>Loading server data...</p>
          )}
        </div>
        
        <div className="card placeholder-card">
          <h3>Repositories</h3>
          <p>This is where you will connect GitHub repositories in Phase 2.</p>
          <button className="btn btn-outline" disabled>Connect GitHub (Coming Soon)</button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
