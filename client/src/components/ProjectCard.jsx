import React, { useState } from 'react';
import { 
  FolderGit2, 
  GitBranch, 
  Trash2, 
  ExternalLink, 
  Radio, 
  Clock, 
  Terminal,
  Loader2
} from 'lucide-react';
import './ProjectCard.css';

const ProjectCard = ({ project, onDelete, onOpen }) => {
  const [isDeleting, setIsDeleting] = useState(false);

  // Map project status to badge styling and readable label
  const getStatusBadge = (status) => {
    switch (status) {
      case 'connected':
        return { label: 'Connected', className: 'badge-status-connected', dot: '#10b981' };
      case 'scanning':
        return { label: 'Scanning...', className: 'badge-status-scanning', dot: '#6366f1' };
      case 'indexed':
        return { label: 'AI Indexed', className: 'badge-status-indexed', dot: '#06b6d4' };
      case 'scan-failed':
        return { label: 'Scan Failed', className: 'badge-status-failed', dot: '#ef4444' };
      case 'disconnected':
      default:
        return { label: 'Disconnected', className: 'badge-status-disconnected', dot: '#64748b' };
    }
  };

  const statusInfo = getStatusBadge(project.status);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${project.name}"?`)) {
      try {
        setIsDeleting(true);
        await onDelete(project._id);
      } catch (err) {
        console.error('Delete failed:', err);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const formattedDate = new Date(project.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="glass-card project-card">
      <div className="project-card-header">
        <div className="project-header-left">
          <div className="project-icon-box">
            <FolderGit2 size={20} />
          </div>
          <div>
            <h3 className="project-title" title={project.name}>
              {project.name}
            </h3>
            <div className="project-meta-row">
              <span className={`project-status-tag ${statusInfo.className}`}>
                <span className="status-dot" style={{ backgroundColor: statusInfo.dot }}></span>
                {statusInfo.label}
              </span>
              <span className="project-date">
                <Clock size={12} />
                {formattedDate}
              </span>
            </div>
          </div>
        </div>

        <button 
          className="project-delete-btn" 
          onClick={handleDelete}
          disabled={isDeleting}
          title="Delete Project"
          aria-label="Delete Project"
        >
          {isDeleting ? <Loader2 size={16} className="spinner" /> : <Trash2 size={16} />}
        </button>
      </div>

      <p className="project-description">
        {project.description || 'No description provided for this project.'}
      </p>

      {/* Repository details */}
      <div className="project-repo-info">
        {project.repoUrl ? (
          <a 
            href={project.repoUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="repo-link"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="repo-url-text">{project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}</span>
            <ExternalLink size={12} />
          </a>
        ) : (
          <span className="repo-placeholder">No GitHub repo linked</span>
        )}

        <div className="branch-tag" title={`Branch: ${project.repoBranch || 'main'}`}>
          <GitBranch size={13} />
          <span>{project.repoBranch || 'main'}</span>
        </div>
      </div>

      {/* Footer Action */}
      <div className="project-card-footer">
        <button 
          className="btn btn-secondary btn-block project-launch-btn"
          onClick={() => onOpen(project)}
        >
          <Terminal size={15} />
          <span>Open Cockpit</span>
        </button>
      </div>
    </div>
  );
};

export default ProjectCard;
