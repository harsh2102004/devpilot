import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const Navbar = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <span className="logo-badge">DP</span>
        <span>DevPilot</span>
      </Link>

      <div className="navbar-user">
        {user ? (
          <>
            <Link to="/dashboard" className="btn btn-outline" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}>
              Dashboard
            </Link>
            <div className="user-badge">
              {user.avatar ? (
                <img
                  src={user.avatar.startsWith('http') ? user.avatar : `http://localhost:5000/${user.avatar.replace(/\\/g, '/')}`}
                  alt={user.fullName || user.username}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <span>👤</span>
              )}
              <span style={{ fontWeight: 600 }}>{user.fullName || user.username}</span>
            </div>
            <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}>
              Logout
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Link to="/login" className="btn btn-outline" style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}>
              Login
            </Link>
            <Link to="/register" className="btn btn-primary" style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}>
              Register
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
