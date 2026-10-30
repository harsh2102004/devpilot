import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  X,
  Send,
  Square,
  Sparkles,
  Bot,
  User as UserIcon,
  Code2,
  FileCode,
  GitBranch,
  Layers,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import './CodebaseChatDrawer.css';

const DEFAULT_SUGGESTIONS = [
  "How does authentication and JWT token generation work?",
  "Where is the background scanner worker defined and what queues does it use?",
  "How does the AST code graph represent file imports and calls?",
  "Explain the project data model and schema relationships"
];

export const CodebaseChatDrawer = ({ isOpen, onClose, project }) => {
  const { token } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedCitations, setExpandedCitations] = useState({});
  const [copiedIndex, setCopiedIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Auto-scroll to latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Reset or initialize on project change
  useEffect(() => {
    if (isOpen && project) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `Hello! I am **DevPilot AI**, your codebase architect. I'm connected to the AST CodeGraph and vector index for **${project.name}**.\n\nAsk me anything about your functions, database schemas, background queues, or architectural patterns. All answers are strictly grounded in real code citations!`,
          isWelcome: true,
        },
      ]);
    }
  }, [isOpen, project]);

  if (!isOpen || !project) return null;

  // Handle Stop Streaming
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  // Copy code block helper
  const handleCopyCode = (codeText, idx) => {
    navigator.clipboard.writeText(codeText);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Toggle citations accordion
  const toggleCitations = (msgId) => {
    setExpandedCitations((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  // Send query via Server-Sent Events (SSE)
  const handleSend = async (queryText = input) => {
    const trimmed = (queryText || '').trim();
    if (!trimmed || isStreaming) return;

    setInput('');
    const userMsgId = `user-${Date.now()}`;
    const aiMsgId = `ai-${Date.now()}`;

    // Append user message and empty AI streaming placeholder
    const userMsg = { id: userMsgId, role: 'user', content: trimmed };
    const aiMsg = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      statusText: 'Connecting to hybrid retrieval engine...',
      contextData: null,
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Build conversation history payload (excluding welcome card)
    const historyPayload = messages
      .filter((m) => !m.isWelcome && (m.role === 'user' || m.role === 'assistant'))
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch('http://localhost:5000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: project._id,
          query: trimmed,
          history: historyPayload,
          topK: 3,
          maxTokens: 3500,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Chat error (${response.status}): ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine.startsWith('data: ')) {
            try {
              const event = JSON.parse(cleanLine.slice(6));

              if (event.type === 'status') {
                setMessages((prev) =>
                  prev.map((m) => (m.id === aiMsgId ? { ...m, statusText: event.message } : m))
                );
              } else if (event.type === 'context') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId
                      ? {
                          ...m,
                          contextData: event.data,
                          statusText: 'Synthesizing grounded architectural answer...',
                        }
                      : m
                  )
                );
              } else if (event.type === 'token') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId ? { ...m, content: m.content + event.token } : m
                  )
                );
              } else if (event.type === 'done') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId ? { ...m, statusText: '', isStreaming: false } : m
                  )
                );
              } else if (event.type === 'error') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId
                      ? {
                          ...m,
                          content: m.content + `\n\n⚠️ **Error:** ${event.message}`,
                          statusText: '',
                          isStreaming: false,
                        }
                      : m
                  )
                );
              }
            } catch {
              // ignore partial line parsing
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: `⚠️ **Connection Error:** Could not stream response. (${err.message})`,
                  statusText: '',
                  isStreaming: false,
                }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Render markdown text blocks and code snippets
  const renderMessageContent = (text) => {
    if (!text) return null;

    // Split code blocks from text
    const parts = text.split(/(```[\s\S]*?```)/g);

    return parts.map((part, pIdx) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const firstLineEnd = part.indexOf('\n');
        const lang = part.slice(3, firstLineEnd).trim() || 'javascript';
        const codeSnippet = part.slice(firstLineEnd + 1, -3);

        return (
          <div key={pIdx} style={{ position: 'relative', margin: '0.75rem 0' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#131b2e',
                padding: '0.35rem 0.75rem',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderBottom: 'none',
                fontSize: '0.75rem',
                color: 'var(--text-muted, #94a3b8)',
                fontFamily: 'monospace',
              }}
            >
              <span>{lang}</span>
              <button
                onClick={() => handleCopyCode(codeSnippet, pIdx)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedIndex === pIdx ? '#10b981' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.7rem',
                }}
              >
                {copiedIndex === pIdx ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedIndex === pIdx ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre style={{ margin: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <code>{codeSnippet}</code>
            </pre>
          </div>
        );
      }

      // Format markdown lists, bold text, and citations
      const lines = part.split('\n');
      return (
        <div key={pIdx} className="chat-markdown-body">
          {lines.map((line, lIdx) => {
            if (line.startsWith('### ')) {
              return (
                <h4 key={lIdx} style={{ fontSize: '1rem', fontWeight: 700, margin: '0.75rem 0 0.4rem 0', color: '#38bdf8' }}>
                  {line.slice(4)}
                </h4>
              );
            }
            if (line.startsWith('- ')) {
              return (
                <li key={lIdx} style={{ marginLeft: '1.2rem', marginBottom: '0.3rem' }}>
                  {renderInlineFormatted(line.slice(2))}
                </li>
              );
            }
            if (/^\d+\.\s/.test(line)) {
              return (
                <div key={lIdx} style={{ marginLeft: '1rem', marginBottom: '0.35rem' }}>
                  {renderInlineFormatted(line)}
                </div>
              );
            }
            if (!line.trim()) {
              return <div key={lIdx} style={{ height: '0.5rem' }}></div>;
            }
            return <p key={lIdx}>{renderInlineFormatted(line)}</p>;
          })}
        </div>
      );
    });
  };

  // Helper to format inline bold, inline code, and citations
  const renderInlineFormatted = (str) => {
    const tokens = str.split(/(\*\*.*?\*\*|`.*?`)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={idx} style={{ color: '#f8fafc' }}>{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        const codeText = token.slice(1, -1);
        const isCitation = codeText.includes('.js') || codeText.includes('.jsx') || codeText.includes(':');
        return (
          <code
            key={idx}
            style={{
              color: isCitation ? '#06b6d4' : '#38bdf8',
              border: isCitation ? '1px solid rgba(6, 182, 212, 0.3)' : 'none',
              background: isCitation ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255, 255, 255, 0.08)',
            }}
          >
            {codeText}
          </code>
        );
      }
      return token;
    });
  };

  return (
    <div className="chat-drawer-backdrop" onClick={onClose}>
      <div className="chat-drawer-panel" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="chat-drawer-header">
          <div className="chat-header-left">
            <div className="chat-project-icon">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="chat-project-title">{project.name}</h3>
              <div className="chat-header-meta">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <GitBranch size={12} /> {project.repoBranch || 'main'}
                </span>
                <span>•</span>
                <span style={{ color: 'var(--accent-cyan)' }}>
                  <Layers size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} />
                  {project.vectorStats?.totalChunksIndexed || 0} vectors indexed
                </span>
              </div>
            </div>
          </div>

          <button className="chat-close-btn" onClick={onClose} title="Close Chat">
            <X size={18} />
          </button>
        </div>

        {/* Message Stream */}
        <div className="chat-messages-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg-row ${msg.role}`}>
              <div className={`chat-avatar ${msg.role}`}>
                {msg.role === 'user' ? <UserIcon size={16} /> : <Bot size={16} />}
              </div>

              <div className="chat-bubble">
                {/* Live Status Ticker */}
                {msg.statusText && (
                  <div className="chat-status-ticker">
                    <Loader2 size={13} className="spinner" />
                    <span>{msg.statusText}</span>
                  </div>
                )}

                {/* Collapsible Citations & Context Drawer */}
                {msg.contextData && (
                  <div className="chat-citations-wrapper">
                    <button
                      className="chat-citations-toggle"
                      onClick={() => toggleCitations(msg.id)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <FileCode size={13} color="var(--accent-cyan)" />
                        <span>
                          {msg.contextData.totalChunks} Retrieved Code Chunks ({msg.contextData.primaryCount} Direct + {msg.contextData.dependencyCount} Graph Hops)
                        </span>
                      </span>
                      {expandedCitations[msg.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {expandedCitations[msg.id] && (
                      <div className="chat-citations-list">
                        {msg.contextData.primaryMatches?.map((p, idx) => (
                          <div key={idx} className="citation-chip">
                            <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>[Direct #{idx + 1}]</span>
                            <span>{p.filePath}:{p.startLine}-{p.endLine}</span>
                            {p.symbolName && <span style={{ opacity: 0.7 }}>({p.symbolName})</span>}
                          </div>
                        ))}
                        {msg.contextData.connectedDependencies?.map((d, idx) => (
                          <div key={idx} className="citation-chip dependency">
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>[Graph #{idx + 1}]</span>
                            <span>{d.filePath}:{d.startLine}-{d.endLine}</span>
                            <span style={{ opacity: 0.7 }}>({d.relationship} '{d.seedSymbol}')</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Main Message Text */}
                {renderMessageContent(msg.content)}

                {/* Welcome Card Suggestions */}
                {msg.isWelcome && (
                  <div className="chat-welcome-card" style={{ marginTop: '1.25rem' }}>
                    <div className="chat-suggestions-title">Suggested Inquiries:</div>
                    <div className="chat-suggestions-grid">
                      {DEFAULT_SUGGESTIONS.map((sug, sIdx) => (
                        <button
                          key={sIdx}
                          className="chat-suggestion-pill"
                          onClick={() => handleSend(sug)}
                        >
                          <Sparkles size={13} color="var(--accent-cyan)" />
                          <span>{sug}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar Footer */}
        <div className="chat-drawer-footer">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="chat-input-bar"
          >
            <input
              type="text"
              className="chat-input-field"
              placeholder={`Ask a question about ${project.name}...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              autoFocus
            />

            {isStreaming ? (
              <button type="button" className="chat-stop-btn" onClick={handleStop} title="Stop Generation">
                <Square size={14} fill="#fff" />
              </button>
            ) : (
              <button
                type="submit"
                className="chat-send-btn"
                disabled={!input.trim()}
                title="Send Message"
              >
                <Send size={15} />
              </button>
            )}
          </form>

          <div className="chat-footer-hint">
            Answers are grounded in AST code graph symbols & Pinecone vector representations.
          </div>
        </div>

      </div>
    </div>
  );
};

export default CodebaseChatDrawer;
