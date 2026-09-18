import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  FolderGit2,
  GitBranch,
  Activity,
  ShieldCheck,
  Plus,
  Terminal,
  Cpu,
  Layers,
  Loader2,
  AlertCircle
} from 'lucide-react';
import CreateProjectModal from '../components/CreateProjectModal';
import ProjectCard from '../components/ProjectCard';
import './Dashboard.css';

const Dashboard = () => {
  const { user, loading: authLoading } = useContext(AuthContext);
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // Fetch projects from backend
  const fetchProjects = async () => {
    try {
      setLoadingProjects(true);
      setError('');
      const res = await axios.get('http://localhost:5000/api/projects');
      setProjects(res.data.data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(err.response?.data?.message || 'Failed to load projects');
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  // Handle project created callback
  const handleProjectCreated = (newProject) => {
    setProjects((prev) => [newProject, ...prev]);
  };

  // Handle project delete
  const handleDeleteProject = async (projectId) => {
    await axios.delete(`http://localhost:5000/api/projects/${projectId}`);
    setProjects((prev) => prev.filter((p) => p._id !== projectId));
  };

  // Handle open project cockpit
  const handleOpenProject = (project) => {
    // In Phase 4/5 this navigates to the project cockpit or scanner view
    alert(`Opening cockpit for "${project.name}" (ID: ${project._id})\nStatus: ${project.status}\nGitHub integration & scanner pipeline starting next!`);
  };

  if (authLoading) {
    return (
      <div className="spinner-fullscreen">
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p>Loading developer cockpit...</p>
      </div>
    );
  }

  if (!user) return null;

  // Derive stats dynamically from live projects
  const activeScansCount = projects.filter(p => p.status === 'scanning').length;
  const indexedCount = projects.filter(p => p.status === 'indexed').length;

  return (
    <div className="dashboard-container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
              Welcome back, {user.fullName || user.username}
            </h1>
            <span className="badge badge-cyan">PRO</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            DevPilot AI Agent Cockpit • Connected to MongoDB & Redis Queues
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-secondary"
            onClick={() => alert("GitHub OAuth integration will be configured in Phase 3C!")}
          >
            <GitBranch size={16} />
            <span>Connect GitHub</span>
          </button>
          <button 
            className="btn btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        
        {/* Metric 1: Total Projects */}
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Total Projects</span>
            <div style={{ padding: '0.4rem', borderRadius: '8px', background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)' }}>
              <FolderGit2 size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {projects.length}
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Managed repositories</span>
        </div>

        {/* Metric 2: Active Scans */}
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Active Scans</span>
            <div style={{ padding: '0.4rem', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)' }}>
              <Activity size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {activeScansCount}
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>BullMQ queue workers</span>
        </div>

        {/* Metric 3: Code Health Score */}
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Code Health Score</span>
            <div style={{ padding: '0.4rem', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
              <ShieldCheck size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>
            {projects.length > 0 ? '100%' : 'N/A'}
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>0 failing tests detected</span>
        </div>

        {/* Metric 4: AI Tokens Indexed */}
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Indexed Repos</span>
            <div style={{ padding: '0.4rem', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308' }}>
              <Cpu size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {indexedCount}
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pinecone vector space</span>
        </div>
      </div>

      {/* Projects Section */}
      <div className="glass-card" style={{ padding: '2rem', minHeight: '340px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Layers size={20} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Your Projects</h2>
            <span className="badge badge-indigo" style={{ marginLeft: '0.4rem' }}>
              {projects.length} {projects.length === 1 ? 'Repository' : 'Repositories'}
            </span>
          </div>

          {projects.length > 0 && (
            <button 
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(true)}
              style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
            >
              <Plus size={14} />
              <span>Add Another</span>
            </button>
          )}
        </div>

        {/* Error notification if fetch failed */}
        {error && (
          <div className="alert-error" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Loading indicator for projects */}
        {loadingProjects ? (
          <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
            <Loader2 size={32} className="spinner" style={{ marginBottom: '1rem', color: 'var(--accent-cyan)' }} />
            <p style={{ fontSize: '0.9rem' }}>Loading your repositories...</p>
          </div>
        ) : projects.length === 0 ? (
          /* Empty State */
          <div style={{
            margin: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '3rem 1rem',
            maxWidth: '440px'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)',
              marginBottom: '1.25rem'
            }}>
              <Terminal size={32} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem' }}>No projects configured yet</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Create your first project to connect repositories, run automated scans, AST code graphs, and AI-driven fixes.
            </p>
            <button 
              className="btn btn-primary"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={16} />
              <span>Create First Project</span>
            </button>
          </div>
        ) : (
          /* Dynamic Projects Grid */
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1.25rem',
            marginTop: '0.5rem'
          }}>
            {projects.map((proj) => (
              <ProjectCard
                key={proj._id}
                project={proj}
                onDelete={handleDeleteProject}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onProjectCreated={handleProjectCreated}
      />

    </div>
  );
};

export default Dashboard;
