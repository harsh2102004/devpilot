import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Terminal as TerminalIcon,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Sparkles,
  Shield,
  X,
  Loader2,
} from 'lucide-react';
import PatchReviewModal from './PatchReviewModal';
import './TestCockpitModal.css';

const API_BASE_URL = 'http://localhost:5000/api';

const TestCockpitModal = ({
  project,
  isOpen,
  onClose,
  onAskAiToFix,
}) => {
  const [activeTab, setActiveTab] = useState('diagnostics'); // 'diagnostics' | 'terminal' | 'history'
  const [isRunning, setIsRunning] = useState(false);
  const [currentTestRun, setCurrentTestRun] = useState(null);
  const [historicalRuns, setHistoricalRuns] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Autonomous Fix Loop State (Phase 9C/9D/9E)
  const [isFixing, setIsFixing] = useState(false);
  const [activeFixIndex, setActiveFixIndex] = useState(null);
  const [activeVerificationData, setActiveVerificationData] = useState(null);
  const [isOpeningPR, setIsOpeningPR] = useState(false);
  
  // Custom execution options
  const [customCommand, setCustomCommand] = useState('');
  const [preferDocker, setPreferDocker] = useState(true);
  
  // Terminal state
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedFailures, setExpandedFailures] = useState({});
  const terminalEndRef = useRef(null);

  // Poll timer ref
  const pollTimerRef = useRef(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && activeTab === 'terminal' && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentTestRun?.rawOutput, autoScroll, activeTab]);

  // Load project test run history on open
  useEffect(() => {
    if (isOpen && project?._id) {
      fetchHistoricalRuns();
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [isOpen, project?._id]);

  const fetchHistoricalRuns = async () => {
    try {
      setLoadingHistory(true);
      setErrorMsg('');
      const res = await axios.get(`${API_BASE_URL}/test/${project._id}/runs?limit=10`);
      const runs = res.data.data?.runs || [];
      setHistoricalRuns(runs);

      // If we don't have an active test run loaded, pick the most recent one
      if (runs.length > 0 && !currentTestRun) {
        loadFullTestRun(runs[0]._id);
      }
    } catch (err) {
      console.error('Error fetching test runs:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to load test run history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadFullTestRun = async (runId) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/test/run/${runId}`);
      const runData = res.data.data;
      setCurrentTestRun(runData);

      // Auto-set tab based on results
      if (runData.status === 'passed') {
        setActiveTab('diagnostics');
      } else if (runData.failures && runData.failures.length > 0) {
        setActiveTab('diagnostics');
      } else {
        setActiveTab('terminal');
      }
    } catch (err) {
      console.error('Error loading test run details:', err);
    }
  };

  // Trigger new test run
  const handleStartTestRun = async () => {
    if (!project?._id || isRunning) return;

    try {
      setIsRunning(true);
      setErrorMsg('');
      setActiveTab('terminal');

      const payload = {
        testCommand: customCommand.trim() || undefined,
        preferDocker,
        timeoutMs: 60000,
      };

      const res = await axios.post(`${API_BASE_URL}/test/${project._id}/run`, payload);
      const { testRunId } = res.data.data;

      // Optimistic initial run state
      setCurrentTestRun({
        _id: testRunId,
        status: 'queued',
        summary: { total: 0, passed: 0, failed: 0, durationMs: 0 },
        failures: [],
        rawOutput: `[DevPilot Test Engine] Initializing sandboxed execution for ${project.name}...\n[DevPilot] Dispatching job to Redis BullMQ (test-queue)...\n`,
        environment: preferDocker ? 'docker' : 'local-process',
        runtime: 'detecting...',
        testCommand: customCommand.trim() || 'auto-detect',
        createdAt: new Date().toISOString(),
      });

      // Start polling test run status
      startPolling(testRunId);
    } catch (err) {
      setIsRunning(false);
      console.error('Failed to trigger test run:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to start test execution');
    }
  };

  const startPolling = (testRunId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/test/run/${testRunId}`);
        const runData = res.data.data;
        setCurrentTestRun(runData);

        if (['passed', 'failed', 'timed_out', 'error'].includes(runData.status)) {
          clearInterval(pollTimerRef.current);
          setIsRunning(false);
          fetchHistoricalRuns(); // Refresh history list

          if (runData.failures && runData.failures.length > 0) {
            setActiveTab('diagnostics');
          }
        }
      } catch (err) {
        console.error('Error polling test run:', err);
        clearInterval(pollTimerRef.current);
        setIsRunning(false);
      }
    }, 1500);
  };

  // Copy raw terminal logs
  const handleCopyLogs = () => {
    if (!currentTestRun?.rawOutput) return;
    navigator.clipboard.writeText(currentTestRun.rawOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Toggle failure card accordion
  const toggleFailureExpand = (index) => {
    setExpandedFailures((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Trigger Autonomous Sandbox Verification Loop and Review Patch (Phase 9C/9D)
  const handleAskFix = async (failure, index) => {
    try {
      setIsFixing(true);
      setActiveFixIndex(index);
      setErrorMsg('');

      const res = await axios.post(`${API_BASE_URL}/test/${project._id}/verify-fix`, {
        testRunId: currentTestRun?._id,
        customFailure: failure,
        failureIndex: index,
        maxAttempts: 3,
        preferDocker,
      });

      if (res.data?.data?.verifiedPatch) {
        setActiveVerificationData(res.data.data);
      } else {
        setErrorMsg('Autonomous fix could not be verified automatically after 3 attempts.');
      }
    } catch (err) {
      console.warn('Fix loop error, falling back to chat guidance:', err);
      if (onAskAiToFix) {
        onAskAiToFix(failure);
      } else {
        setErrorMsg(err.response?.data?.message || 'Failed to execute autonomous fix loop.');
      }
    } finally {
      setIsFixing(false);
      setActiveFixIndex(null);
    }
  };

  if (!isOpen || !project) return null;

  const summary = currentTestRun?.summary || { total: 0, passed: 0, failed: 0, durationMs: 0 };
  const hasFailures = currentTestRun?.failures && currentTestRun.failures.length > 0;

  return (
    <div className="test-modal-backdrop" onClick={onClose}>
      <div className="glass-card test-cockpit-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="test-modal-header">
          <div className="test-modal-title-box">
            <div className="test-icon-badge">
              <FlaskConical size={22} className="accent-icon" />
            </div>
            <div>
              <div className="test-header-meta">
                <h2>{project.name}</h2>
                <span className={`status-pill pill-${currentTestRun?.status || 'idle'}`}>
                  {isRunning ? (
                    <>
                      <Loader2 size={13} className="spin-icon" />
                      Running Tests...
                    </>
                  ) : currentTestRun?.status === 'passed' ? (
                    <>
                      <CheckCircle2 size={13} />
                      Tests Passing
                    </>
                  ) : currentTestRun?.status === 'failed' ? (
                    <>
                      <XCircle size={13} />
                      Tests Failing
                    </>
                  ) : currentTestRun?.status === 'timed_out' ? (
                    <>
                      <Clock size={13} />
                      Timed Out
                    </>
                  ) : (
                    'Ready to Test'
                  )}
                </span>
                <span className="env-badge">
                  <Shield size={12} />
                  {currentTestRun?.environment === 'docker' ? 'Docker Sandbox' : 'Process Sandbox'}
                </span>
              </div>
              <p className="test-subtitle">
                Isolated sandbox execution • Runtime:{' '}
                <strong>{currentTestRun?.runtime || 'auto-detect'}</strong> • Runner:{' '}
                <strong>{currentTestRun?.runner || 'auto-detect'}</strong>
              </p>
            </div>
          </div>

          <button className="test-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {/* Error Alert if any */}
        {errorMsg && (
          <div className="test-error-banner">
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Controls & Metrics Ribbon */}
        <div className="test-metrics-ribbon">
          <div className="metrics-group">
            <div className="metric-chip">
              <span className="metric-label">Total Tests</span>
              <span className="metric-value">{summary.total || 0}</span>
            </div>
            <div className="metric-chip chip-passed">
              <span className="metric-label">Passed</span>
              <span className="metric-value">{summary.passed || 0}</span>
            </div>
            <div className="metric-chip chip-failed">
              <span className="metric-label">Failed</span>
              <span className="metric-value">{summary.failed || 0}</span>
            </div>
            <div className="metric-chip">
              <span className="metric-label">Duration</span>
              <span className="metric-value">
                {summary.durationMs ? `${(summary.durationMs / 1000).toFixed(2)}s` : '0s'}
              </span>
            </div>
          </div>

          <div className="actions-group">
            <button
              className="btn btn-primary run-tests-btn"
              onClick={handleStartTestRun}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  <span>Executing...</span>
                </>
              ) : (
                <>
                  <Play size={16} />
                  <span>Run Tests</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="test-tabs-nav">
          <button
            className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
            onClick={() => setActiveTab('diagnostics')}
          >
            <AlertTriangle size={15} />
            <span>Diagnostic Failures</span>
            {hasFailures && <span className="tab-badge">{currentTestRun.failures.length}</span>}
          </button>
          <button
            className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            <TerminalIcon size={15} />
            <span>Terminal Output</span>
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={15} />
            <span>Run History ({historicalRuns.length})</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="test-modal-body">
          {/* 1. Diagnostics Tab */}
          {activeTab === 'diagnostics' && (
            <div className="diagnostics-view">
              {!currentTestRun ? (
                <div className="empty-state-card">
                  <FlaskConical size={36} className="empty-icon" />
                  <h4>No Test Runs Recorded</h4>
                  <p>Click "Run Tests" to execute your test suite inside the isolated sandbox.</p>
                </div>
              ) : currentTestRun.status === 'passed' ? (
                <div className="success-state-card">
                  <CheckCircle2 size={44} className="success-icon" />
                  <h3>All Tests Passing!</h3>
                  <p>
                    All {summary.total} tests completed with 0 failures in{' '}
                    {((summary.durationMs || 0) / 1000).toFixed(2)}s.
                  </p>
                </div>
              ) : !hasFailures ? (
                <div className="empty-state-card">
                  <TerminalIcon size={36} className="empty-icon" />
                  <h4>Tests In Progress or Finished without Structured Errors</h4>
                  <p>Check the Terminal Output tab for detailed compiler logs.</p>
                </div>
              ) : (
                <div className="failures-list">
                  {currentTestRun.failures.map((fail, index) => {
                    const isExpanded = !!expandedFailures[index];
                    return (
                      <div key={index} className="failure-card">
                        <div
                          className="failure-card-header"
                          onClick={() => toggleFailureExpand(index)}
                        >
                          <div className="failure-title-col">
                            <div className="fail-header-row">
                              <span className="fail-badge">FAILED</span>
                              {fail.suiteName && (
                                <span className="suite-tag">{fail.suiteName}</span>
                              )}
                              <h4 className="fail-title">{fail.testTitle}</h4>
                            </div>

                            {fail.filePath && (
                              <div className="culprit-pill">
                                <FileCode2 size={13} />
                                <span>
                                  {fail.filePath}
                                  {fail.line ? `:${fail.line}` : ''}
                                  {fail.column ? `:${fail.column}` : ''}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="failure-actions">
                            <button
                              className="btn-ask-ai"
                              disabled={isFixing}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAskFix(fail, idx);
                              }}
                              title="Synthesize and verify candidate fix in sandbox"
                            >
                              {isFixing && activeFixIndex === idx ? (
                                <>
                                  <Loader2 size={14} className="spin-icon" />
                                  <span>Fixing...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles size={14} />
                                  <span>Fix with AI</span>
                                </>
                              )}
                            </button>
                            <button className="expand-btn">
                              {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                          </div>
                        </div>

                        {/* Error Message Box */}
                        <div className="failure-error-box">
                          <strong>{fail.errorName}:</strong> {fail.errorMessage}
                        </div>

                        {/* Code Snippet if present */}
                        {fail.codeSnippet && (
                          <div className="code-snippet-box">
                            <pre>
                              <code>{fail.codeSnippet}</code>
                            </pre>
                          </div>
                        )}

                        {/* Collapsible Stack Trace */}
                        {isExpanded && fail.stackTrace && (
                          <div className="stack-trace-accordion">
                            <span className="stack-label">Stack Trace:</span>
                            <pre className="stack-code">
                              <code>{fail.stackTrace}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 2. Terminal Output Tab */}
          {activeTab === 'terminal' && (
            <div className="terminal-view">
              <div className="terminal-toolbar">
                <div className="terminal-indicators">
                  <span className="terminal-dot dot-red"></span>
                  <span className="terminal-dot dot-yellow"></span>
                  <span className="terminal-dot dot-green"></span>
                  <span className="terminal-title">
                    sandbox@{currentTestRun?.environment || 'devpilot'}:~/workspace
                  </span>
                </div>

                <div className="terminal-actions">
                  <label className="autoscroll-toggle">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    <span>Auto-scroll</span>
                  </label>
                  <button className="term-btn" onClick={handleCopyLogs} title="Copy logs">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="terminal-console">
                <pre className="terminal-pre">
                  <code>
                    {currentTestRun?.rawOutput ||
                      '[DevPilot Sandbox] Ready. Click "Run Tests" above to execute test suite.'}
                  </code>
                </pre>
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* 3. History Tab */}
          {activeTab === 'history' && (
            <div className="history-view">
              {loadingHistory ? (
                <div className="history-loading">
                  <Loader2 size={24} className="spin-icon" />
                  <p>Loading historical test runs...</p>
                </div>
              ) : historicalRuns.length === 0 ? (
                <div className="empty-state-card">
                  <Clock size={32} className="empty-icon" />
                  <h4>No History Found</h4>
                  <p>Run tests to start building execution history for this repository.</p>
                </div>
              ) : (
                <div className="history-table-container">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Passed / Total</th>
                        <th>Duration</th>
                        <th>Environment</th>
                        <th>Date & Time</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalRuns.map((run) => {
                        const isCurrent = currentTestRun?._id === run._id;
                        return (
                          <tr key={run._id} className={isCurrent ? 'selected-row' : ''}>
                            <td>
                              <span className={`status-pill pill-${run.status}`}>
                                {run.status}
                              </span>
                            </td>
                            <td>
                              <strong>{run.summary?.passed ?? 0}</strong> /{' '}
                              {run.summary?.total ?? 0}
                            </td>
                            <td>
                              {run.summary?.durationMs
                                ? `${(run.summary.durationMs / 1000).toFixed(2)}s`
                                : '0s'}
                            </td>
                            <td>
                              <span className="env-tag">{run.environment}</span>
                            </td>
                            <td className="date-col">
                              {new Date(run.createdAt).toLocaleString()}
                            </td>
                            <td>
                              <button
                                className="btn-table-action"
                                onClick={() => loadFullTestRun(run._id)}
                              >
                                View Report
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sub-Phase 9D & 9E: Human-in-the-Loop Patch Review & Automated PR Modal */}
      {activeVerificationData && (
        <PatchReviewModal
          isOpen={Boolean(activeVerificationData)}
          onClose={() => setActiveVerificationData(null)}
          project={project}
          patch={activeVerificationData.verifiedPatch}
          verificationReport={activeVerificationData}
          isOpeningPR={isOpeningPR}
          onApproveAndOpenPR={async (prPayload) => {
            try {
              setIsOpeningPR(true);
              const res = await axios.post(`${API_BASE_URL}/test/${project._id}/create-pr`, {
                filePath: prPayload.patch?.filePath,
                modifiedContent: prPayload.modifiedContent,
                patch: prPayload.patch,
                failure: activeVerificationData?.failure,
                verificationReport: activeVerificationData,
                branchName: prPayload.branchName,
              });

              const pr = res.data?.data;
              if (pr?.prUrl) {
                window.open(pr.prUrl, '_blank', 'noopener,noreferrer');
              }
              setActiveVerificationData(null);
            } catch (err) {
              console.error('Failed to open PR:', err);
              setErrorMsg(err.response?.data?.message || 'Failed to open Pull Request on GitHub');
            } finally {
              setIsOpeningPR(false);
            }
          }}
          onDiscard={() => setActiveVerificationData(null)}
        />
      )}
    </div>
  );
};

export default TestCockpitModal;
