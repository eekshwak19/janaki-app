import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { speakText, stopSpeech } from '../services/tts';

// Chunks text into small paragraphs (no more than 3 sentences per block)
function chunkText(text) {
  if (!text) return [];
  
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Keep formulas or code blocks intact
    if (trimmed.includes('```') || trimmed.includes('$$') || trimmed.includes('$')) {
      chunks.push(trimmed);
      continue;
    }
    
    // Match sentences ending in . or ! or ? followed by space/end of line
    const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [trimmed];
    
    let currentGroup = [];
    for (let i = 0; i < sentences.length; i++) {
      currentGroup.push(sentences[i].trim());
      if (currentGroup.length === 3 || i === sentences.length - 1) {
        chunks.push(currentGroup.join(' '));
        currentGroup = [];
      }
    }
    if (currentGroup.length > 0) {
      chunks.push(currentGroup.join(' '));
    }
  }
  return chunks;
}

export default function ResponseBubble({ message, index, fullHistory, onShowAtmAnswer, onOpenResearchModal, cognitiveMode = false, onUpdateMessageRevealedCount, autoPlaySpeech = false, onSetAutoPlaySpeech, onEekshwakClick }) {
  const isUser = message.role === 'user';
  const isResearchMessage = !isUser && message.isResearch;
  const [thinkingExpanded, setThinkingExpanded] = useState(true);

  const isBriefOrClearQuery = () => {
    if (isUser || !fullHistory || index === undefined) return false;
    const prevMsg = fullHistory[index - 1];
    if (prevMsg && prevMsg.role === 'user') {
      return /\b(clearly|briefly)\b/i.test(prevMsg.content);
    }
    return false;
  };

  // Formatting helpers for styles
  const bubbleStyle = {
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
    width: 'auto',
    padding: '1rem 1.2rem',
    borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
    background: isUser ? 'rgba(0, 102, 255, 0.15)' : 'rgba(7, 22, 44, 0.55)',
    border: isUser ? '1px solid rgba(0, 102, 255, 0.35)' : '1px solid rgba(0, 242, 254, 0.25)',
    boxShadow: isUser ? '0 0 10px rgba(0, 102, 255, 0.15)' : '0 0 10px rgba(0, 242, 254, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    position: 'relative'
  };

  const textStyle = {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9rem',
    lineHeight: '1.6',
    color: '#e2f1f8'
  };

  const headerStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '1px',
    color: isUser ? '#00f2fe' : '#82a5c5',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(0, 242, 254, 0.1)',
    paddingBottom: '0.3rem',
    marginBottom: '0.2rem'
  };

  return (
    <div style={bubbleStyle} className="hud-corners hologram-effect">
      <div style={headerStyle}>
        <span>{isUser ? '📡 USER_UPLINK' : ''}</span>
        {!isUser && message.telemetry && (message.telemetry.activeStep?.model || message.telemetry.model) && (
          <span style={{ color: 'var(--neon-cyan)', fontSize: '0.6rem' }}>
            {(message.telemetry.activeStep?.model || message.telemetry.model).split('/').pop().toUpperCase()} // {message.telemetry.latencyMs}ms
          </span>
        )}
      </div>

      {isResearchMessage ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
          <button 
            onClick={(e) => {
              e.preventDefault();
              onOpenResearchModal(message);
            }}
            className="neon-button hologram-effect"
            style={{
              padding: '0.6rem 1.8rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem'
            }}
          >
            <span>🔮 ANSWER</span>
          </button>
        </div>
      ) : isBriefOrClearQuery() ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
          <button 
            onClick={(e) => {
              e.preventDefault();
              onShowAtmAnswer(message);
            }}
            className="neon-button hologram-effect"
            style={{
              padding: '0.6rem 1.8rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem'
            }}
          >
            <span>🔮 ANSWER</span>
          </button>
        </div>
      ) : (
        <>
          {/* Render reasoning/thinking block if it exists (e.g. from DeepSeek R1) */}
          {!isUser && message.reasoning && (
            <div style={{
              borderLeft: '2px solid var(--neon-purple)',
              background: 'rgba(157, 78, 221, 0.05)',
              borderRadius: '0 4px 4px 0',
              margin: '0.4rem 0',
              overflow: 'hidden'
            }}>
              <button 
                onClick={() => setThinkingExpanded(!thinkingExpanded)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--neon-purple)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  textAlign: 'left',
                  padding: '0.4rem 0.6rem',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  outline: 'none'
                }}
              >
                <span>🧠 [COGNITIVE_THINKING_PROCESS]</span>
                <span>{thinkingExpanded ? '[-] COLLAPSE' : '[+] EXPAND'}</span>
              </button>
              {thinkingExpanded && (
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: '#d4af37', // soft amber for reasoning logs
                  padding: '0.6rem',
                  margin: 0,
                  background: 'rgba(3, 10, 22, 0.3)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  lineHeight: '1.4'
                }}>
                  {message.reasoning}
                </pre>
              )}
            </div>
          )}

          {/* Main markdown + math text body */}
          <div style={textStyle} className="markdown-render">
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline ? (
                    <span style={{ display: 'block', margin: '0.8rem 0', overflow: 'hidden', borderRadius: '4px', border: '1px solid rgba(0, 242, 254, 0.15)' }}>
                      <span style={{
                        background: 'rgba(3, 10, 22, 0.8)',
                        padding: '0.3rem 0.6rem',
                        borderBottom: '1px solid rgba(0, 242, 254, 0.1)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        color: 'var(--neon-cyan)'
                      }}>
                        <span>{match ? match[1].toUpperCase() : 'CODE_BLOCK'}</span>
                        <button 
                          onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.65rem'
                          }}
                        >
                          COPY
                        </button>
                      </span>
                      <pre style={{
                        background: 'rgba(3, 10, 22, 0.45)',
                        padding: '0.8rem',
                        overflowX: 'auto',
                        margin: 0
                      }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#82a5c5' }} {...props}>
                          {children}
                        </code>
                      </pre>
                    </span>
                  ) : (
                    <code style={{
                      background: 'rgba(0, 242, 254, 0.08)',
                      padding: '0.1rem 0.3rem',
                      borderRadius: '3px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--neon-cyan)',
                      fontSize: '0.85rem'
                    }} {...props}>
                      {children}
                    </code>
                  );
                },
                // Style LaTeX blocks and math equations properly
                div({ node, className, children, ...props }) {
                  if (className && className.includes('math-display')) {
                    return (
                      <div className="latex-block" {...props}>
                        {children}
                      </div>
                    );
                  }
                  return <div className={className} {...props}>{children}</div>;
                },
                span({ node, className, children, ...props }) {
                  if (className && className.includes('math-inline')) {
                    return (
                      <span className="latex-inline" {...props}>
                        {children}
                      </span>
                    );
                  }
                  return <span className={className} {...props}>{children}</span>;
                }
              }}
            >
              {(() => {
                if (!isUser && cognitiveMode) {
                  const messageChunks = chunkText(message.content);
                  const count = message.revealedChunksCount || 1;
                  return messageChunks.slice(0, count).join('\n\n');
                }
                return message.content;
              })()}
            </ReactMarkdown>
          </div>

          {/* Continue button for Cognitive Mode */}
          {(() => {
            if (!isUser && cognitiveMode) {
              const messageChunks = chunkText(message.content);
              const count = message.revealedChunksCount || 1;
              if (count < messageChunks.length) {
                return (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.8rem' }}>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        stopSpeech();
                        const nextCount = count + 1;
                        if (onUpdateMessageRevealedCount) {
                          onUpdateMessageRevealedCount(index, nextCount);
                        }
                        const nextChunk = messageChunks[count];
                        if (nextChunk && autoPlaySpeech) {
                          let speakTextStr = nextChunk;
                          if (nextCount < messageChunks.length) {
                            speakTextStr += " ... Click continue reading.";
                          }
                          speakText(speakTextStr, 0.9);
                        }
                      }}
                      className="neon-button hologram-effect"
                      style={{
                        padding: '0.4rem 1.2rem',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        borderColor: 'var(--neon-cyan)',
                        color: 'var(--neon-cyan)',
                        background: 'rgba(143, 175, 135, 0.08)',
                        borderRadius: '4px'
                      }}
                    >
                      <span>🍃 CONTINUE READING...</span>
                    </button>
                  </div>
                );
              }
            }
            return null;
          })()}
        </>
      )}

      {!isUser && (
        <div style={{
          display: 'flex',
          gap: '0.6rem',
          alignItems: 'center',
          marginTop: '0.6rem',
          borderTop: '1px solid rgba(0, 242, 254, 0.12)',
          paddingTop: '0.4rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem'
        }} className="no-print">
          <span style={{ color: 'var(--text-secondary)' }}>TTS:</span>
          <button
            onClick={() => {
              if (onSetAutoPlaySpeech) onSetAutoPlaySpeech(true);
              let textToSpeak = message.content;
              if (cognitiveMode) {
                const messageChunks = chunkText(message.content);
                const count = message.revealedChunksCount || 1;
                textToSpeak = messageChunks.slice(0, count).join('\n\n');
                if (count < messageChunks.length) {
                  textToSpeak += " ... Click continue reading.";
                }
              }
              speakText(textToSpeak, cognitiveMode ? 0.9 : (message.isResearch ? 0.9 : 1.0));
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--neon-cyan)',
              cursor: 'pointer',
              outline: 'none',
              padding: '0.1rem 0.3rem',
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
              fontSize: 'inherit'
            }}
            onMouseEnter={(e) => e.target.style.textShadow = '0 0 5px var(--neon-cyan)'}
            onMouseLeave={(e) => e.target.style.textShadow = 'none'}
          >
            ▶ SPEAK
          </button>
          <button
            onClick={() => {
              stopSpeech();
              if (onSetAutoPlaySpeech) onSetAutoPlaySpeech(false);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--neon-red)',
              cursor: 'pointer',
              outline: 'none',
              padding: '0.1rem 0.3rem',
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
              fontSize: 'inherit'
            }}
            onMouseEnter={(e) => e.target.style.textShadow = '0 0 5px var(--neon-red)'}
            onMouseLeave={(e) => e.target.style.textShadow = 'none'}
          >
            ⏹ STOP
          </button>
          {!cognitiveMode && (
            <button
              onClick={() => {
                if (onEekshwakClick) {
                  onEekshwakClick(message, index);
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--neon-cyan)',
                cursor: 'pointer',
                outline: 'none',
                padding: '0.1rem 0.3rem',
                marginLeft: '0.6rem',
                transition: 'all 0.2s ease',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                borderLeft: '1px solid rgba(0, 242, 254, 0.25)',
                paddingLeft: '0.6rem'
              }}
              onMouseEnter={(e) => e.target.style.textShadow = '0 0 5px var(--neon-cyan)'}
              onMouseLeave={(e) => e.target.style.textShadow = 'none'}
            >
              🎓 FOR EEKSHWAK
            </button>
          )}
        </div>
      )}
    </div>
  );
}
