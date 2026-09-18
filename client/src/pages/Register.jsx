import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

const Register = () => {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatar(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!avatar) {
      return setError('Please upload an avatar image');
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('fullName', fullName);
      formData.append('username', username);
      formData.append('email', email);
      formData.append('password', password);
      formData.append('avatar', avatar);

      await register(formData);
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <form onSubmit={handleSubmit} className="auth-form glass-card">
        <div className="auth-header">
          <h2>Create Account</h2>
          <p>Join DevPilot to analyze, test & debug code with AI</p>
        </div>

        {error && (
          <div className="alert-error">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Avatar Upload */}
        <div className="form-group">
          <label>Profile Avatar</label>
          <label className="file-upload-box">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar preview" className="avatar-preview-img" />
            ) : (
              <div className="avatar-placeholder">👤</div>
            )}
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                {avatar ? avatar.name : 'Choose an image'}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                PNG, JPG or WEBP (Max 5MB)
              </span>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
              required
            />
          </label>
        </div>

        <div className="form-group">
          <label>Full Name</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Rudra Pratap"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Username</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. rudra_dev"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Email Address</label>
          <input
            className="form-input"
            type="email"
            placeholder="rudra@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            className="form-input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting ? <div className="spinner"></div> : 'Create DevPilot Account'}
        </button>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 600 }}>
            Sign In
          </Link>
        </p>
      </form>
    </div>
  );
};

export default Register;
