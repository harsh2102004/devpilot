import React, { useState, useMemo } from 'react';
import {
  GitPullRequest,
  Sparkles,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  FileCode2,
  Split,
  AlignJustify,
  Edit3,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  X,
  ExternalLink,
} from 'lucide-react';
import './PatchReviewModal.css';
import { parseUnifiedDiff, buildSplitDiffRows } from '../utils/diffParser.js';

export { parseUnifiedDiff, buildSplitDiffRows };

const PatchReviewModal = ({
  isOpen,
  onClose,
  project,
  patch,
  verificationReport = null,
  onApproveAndOpenPR,
  onDiscard,
  onSaveEdit,
  isOpeningPR = false,
}) => {
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'unified'
  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [customBranchName, setCustomBranchName] = useState('');

  // Initialize editable code when patch changes
  React.useEffect(() => {
    if (patch) {
      setEditedCode(patch.modifiedContent || patch.replacementCode || '');
      const slug = (patch.filePath || 'patch')
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/--+/g, '-')
        .toLowerCase();
      setCustomBranchName(`devpilot/fix-${slug.slice(-25)}`);
    }
  }, [patch]);

  const parsedDiff = useMemo(() => {
    return parseUnifiedDiff(patch?.unifiedDiff || '');
  }, [patch?.unifiedDiff]);

  const splitDiffRows = useMemo(() => {
    return buildSplitDiffRows(parsedDiff);
  }, [parsedDiff]);

  if (!isOpen || !patch) return null;

  const handleCopyDiff = async () => {
    try {
      await navigator.clipboard.writeText(patch.unifiedDiff || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy diff:', err);
    }
  };

  const handleResetToAIProposal = () => {
    setEditedCode(patch.modifiedContent || patch.replacementCode || '');
  };

  const handleSaveEdit = () => {
    if (onSaveEdit) {
      onSaveEdit(editedCode);
    }
    setIsEditing(false);
  };

  const handleApprove = () => {
    if (onApproveAndOpenPR) {
      onApproveAndOpenPR({
        patch,
        modifiedContent: isEditing ? editedCode : patch.modifiedContent,
        branchName: customBranchName || `devpilot/fix-${Date.now()}`,
      });
    }
  };

  const isVerified = verificationReport?.verified ?? patch.astValid ?? true;
  const attemptsCount = verificationReport?.attemptsCount ?? 1;

  return (
    <div className="patch-modal-backdrop" onClick={onClose}>
      <div className="glass-card patch-review-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="patch-modal-header">
          <div className="patch-title-box">
            <div className="patch-icon-badge">
              <Sparkles size={22} className="accent-icon" />
            </div>
            <div>
              <div className="patch-header-meta">
                <h2>AI Patch Review</h2>
                {isVerified ? (
                  <span className="status-badge badge-verified">
                    <CheckCircle2 size={13} />
                    Verified in Sandbox
                  </span>
                ) : (
                  <span className="status-badge badge-warning">
                    <AlertTriangle size={13} />
                    Needs Verification
                  </span>
                )}
                {attemptsCount > 0 && (
                  <span className="attempts-badge">
                    Attempt {attemptsCount} of 3
                  </span>
                )}
              </div>
              <p className="patch-subtitle">
                Inspect AI-synthesized code diff, review sandbox validation proof, and approve PR generation.
              </p>
            </div>
          </div>

          <div className="patch-header-actions">
            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button
                type="button"
                className={`toggle-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => { setViewMode('split'); setIsEditing(false); }}
                title="Side-by-side split diff"
              >
                <Split size={14} />
                <span>Split</span>
              </button>
              <button
                type="button"
                className={`toggle-btn ${viewMode === 'unified' ? 'active' : ''}`}
                onClick={() => { setViewMode('unified'); setIsEditing(false); }}
                title="Unified inline diff"
              >
                <AlignJustify size={14} />
                <span>Unified</span>
              </button>
              <button
                type="button"
                className={`toggle-btn ${isEditing ? 'active' : ''}`}
                onClick={() => setIsEditing(!isEditing)}
                title="Edit candidate patch manually"
              >
                <Edit3 size={14} />
                <span>Edit</span>
              </button>
            </div>

            <button type="button" className="modal-close-btn" onClick={onClose} title="Close modal">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* AI Explanation & Diagnostic Summary Banner */}
        <div className="patch-explanation-card">
          <div className="explanation-left">
            <div className="file-target-pill">
              <FileCode2 size={14} />
              <span>{patch.filePath}</span>
            </div>
            <p className="explanation-text">
              <strong>AI Root Cause & Fix:</strong>{' '}
              {patch.explanation || 'Targeted surgical fix synthesized to resolve failing test assertion.'}
            </p>
          </div>

          <div className="explanation-right">
            <div className="metric-pill">
              <ShieldCheck size={14} className="metric-icon-pass" />
              <span>AST Validated</span>
            </div>
            {verificationReport?.finalTestResult && (
              <div className="metric-pill">
                <CheckCircle2 size={14} className="metric-icon-pass" />
                <span>
                  {verificationReport.finalTestResult.summary?.passed ?? 1}/
                  {verificationReport.finalTestResult.summary?.total ?? 1} Tests Passing
                </span>
              </div>
            )}
            <button
              type="button"
              className="btn-copy-diff"
              onClick={handleCopyDiff}
              title="Copy Git Unified Diff to Clipboard"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy Diff'}</span>
            </button>
          </div>
        </div>

        {/* Diff Content Body */}
        <div className="patch-modal-body">
          {/* Mode 1: Interactive Edit Mode */}
          {isEditing ? (
            <div className="patch-editor-view">
              <div className="editor-toolbar">
                <div className="editor-info">
                  <Edit3 size={14} />
                  <span>Manual Patch Editor ({patch.filePath})</span>
                </div>
                <div className="editor-actions">
                  <button
                    type="button"
                    className="btn-editor-secondary"
                    onClick={handleResetToAIProposal}
                    title="Revert modifications to AI proposal"
                  >
                    <RotateCcw size={13} />
                    <span>Revert to AI Proposal</span>
                  </button>
                  <button
                    type="button"
                    className="btn-editor-primary"
                    onClick={handleSaveEdit}
                  >
                    <Check size={13} />
                    <span>Keep Edits</span>
                  </button>
                </div>
              </div>

              <div className="editor-container">
                <textarea
                  className="patch-code-textarea"
                  value={editedCode}
                  onChange={(e) => setEditedCode(e.target.value)}
                  placeholder="Paste or modify file content here..."
                  spellCheck="false"
                />
              </div>
            </div>
          ) : viewMode === 'split' ? (
            /* Mode 2: Side-by-Side Split Diff */
            <div className="split-diff-view">
              <div className="split-diff-header">
                <div className="split-col-header split-left-header">
                  <span>Original Code (Before)</span>
                </div>
                <div className="split-col-header split-right-header">
                  <span>Synthesized Fix (After)</span>
                </div>
              </div>

              <div className="split-diff-body">
                {splitDiffRows.length === 0 ? (
                  <div className="empty-diff-notice">
                    <span>No structural diff lines found.</span>
                  </div>
                ) : (
                  splitDiffRows.map((row, idx) => {
                    if (row.isHunk) {
                      return (
                        <div key={`hunk-${idx}`} className="split-hunk-row">
                          <code>{row.content}</code>
                        </div>
                      );
                    }

                    return (
                      <div key={`split-row-${idx}`} className="split-diff-row">
                        {/* Left Side (Original) */}
                        <div
                          className={`split-cell split-left ${
                            row.left?.type === 'delete' ? 'cell-delete' : ''
                          }`}
                        >
                          <span className="diff-lineno">
                            {row.left?.line ?? ''}
                          </span>
                          <span className="diff-marker">
                            {row.left?.type === 'delete' ? '-' : ' '}
                          </span>
                          <span className="diff-code-text">
                            {row.left?.content ?? ''}
                          </span>
                        </div>

                        {/* Right Side (Modified) */}
                        <div
                          className={`split-cell split-right ${
                            row.right?.type === 'insert' ? 'cell-insert' : ''
                          }`}
                        >
                          <span className="diff-lineno">
                            {row.right?.line ?? ''}
                          </span>
                          <span className="diff-marker">
                            {row.right?.type === 'insert' ? '+' : ' '}
                          </span>
                          <span className="diff-code-text">
                            {row.right?.content ?? ''}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Mode 3: Unified Git Diff */
            <div className="unified-diff-view">
              <div className="unified-diff-body">
                {parsedDiff.length === 0 ? (
                  <div className="empty-diff-notice">
                    <span>No diff content to display.</span>
                  </div>
                ) : (
                  parsedDiff.map((row, idx) => {
                    if (row.type === 'hunk-header') {
                      return (
                        <div key={`uni-hunk-${idx}`} className="unified-hunk-row">
                          <code>{row.content}</code>
                        </div>
                      );
                    }

                    if (row.type === 'file-header') {
                      return (
                        <div key={`uni-file-${idx}`} className="unified-file-row">
                          <code>{row.content}</code>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`uni-row-${idx}`}
                        className={`unified-diff-row ${
                          row.type === 'delete'
                            ? 'row-delete'
                            : row.type === 'insert'
                            ? 'row-insert'
                            : 'row-context'
                        }`}
                      >
                        <span className="diff-lineno">{row.origLine ?? ''}</span>
                        <span className="diff-lineno">{row.modLine ?? ''}</span>
                        <span className="diff-marker">{row.marker}</span>
                        <span className="diff-code-text">{row.content}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="patch-modal-footer">
          <div className="footer-left">
            <button
              type="button"
              className="btn-discard"
              onClick={() => {
                if (onDiscard) onDiscard();
                onClose();
              }}
            >
              <XCircle size={15} />
              <span>Discard Fix</span>
            </button>
            <div className="branch-input-box">
              <span className="branch-label">Target Branch:</span>
              <input
                type="text"
                className="branch-input"
                value={customBranchName}
                onChange={(e) => setCustomBranchName(e.target.value)}
                placeholder="devpilot/fix-..."
              />
            </div>
          </div>

          <div className="footer-right">
            <button
              type="button"
              className="btn-approve-pr"
              onClick={handleApprove}
              disabled={isOpeningPR}
            >
              {isOpeningPR ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  <span>Opening Pull Request...</span>
                </>
              ) : (
                <>
                  <GitPullRequest size={16} />
                  <span>Approve & Open PR</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PatchReviewModal;
