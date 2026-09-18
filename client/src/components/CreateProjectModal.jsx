import React, { useState } from 'react';
import axios from 'axios';
import { X, FolderGit2, GitBranch, AlertCircle, Loader2 } from 'lucide-react';
import './CreateProjectModal.css';

const CreateProjectModal = ({ isOpen, onClose, onProjectCreated }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    repoUrl: '',
    repoBranch: 'main'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Project name is required');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const res = await axios.post('http://localhost:5000/api/projects', formData);
      
      // Reset form
      setFormData({
        name: '',
        description: '',
        repoUrl: '',
        repoBranch: 'main'
      });
      
      // Notify parent to refresh or append project
      if (onProjectCreated) {
        onProjectCreated(res.data.data);
      }
      onClose();
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err.response?.data?.message || 'Failed to create project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass-card modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge">
              <FolderGit2 size={20} />
            </div>
            <div>
              <h3>Create New Project</h3>
              <p>Initialize a repository in your DevPilot AI Cockpit</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert-error" style={{ margin: '0 1.5rem 1rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="projectName">Project Name <span className="text-accent">*</span></label>
            <input
              id="projectName"
              name="name"
              type="text"
              className="form-input"
              placeholder="e.g. devpilot-core or payment-gateway"
              value={formData.name}
              onChange={handleChange}
              disabled={loading}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="projectDesc">Description</label>
            <textarea
              id="projectDesc"
              name="description"
              className="form-input modal-textarea"
              placeholder="What does this repository or service do?"
              value={formData.description}
              onChange={handleChange}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label htmlFor="repoUrl">GitHub Repo URL (Optional)</label>
              <input
                id="repoUrl"
                name="repoUrl"
                type="url"
                className="form-input"
                placeholder="https://github.com/owner/repo"
                value={formData.repoUrl}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="repoBranch">Default Branch</label>
              <div className="input-with-icon">
                <GitBranch size={16} className="input-inner-icon" />
                <input
                  id="repoBranch"
                  name="repoBranch"
                  type="text"
                  className="form-input has-icon"
                  placeholder="main"
                  value={formData.repoBranch}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spinner" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Project</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProjectModal;
