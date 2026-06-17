import React, { useState, useEffect } from 'react';

export default function Header({ providers = { gemini: false, openrouter: false }, onResearchClick, isResearchActive = false, onToggleSidebar, cognitiveMode = false, onCognitiveToggle }) {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0'));
    };
    updateTime();
    const interval = setInterval(updateTime, 99);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="glass-panel hud-corners hologram-effect" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.8rem 1.5rem',
      marginBottom: '1rem',
      borderBottom: '2px solid rgba(0, 242, 254, 0.3)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
        {/* Toggle Sidebar Button */}
        <button 
          onClick={onToggleSidebar}
          className="hologram-effect"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--neon-cyan)',
            cursor: 'pointer',
            fontSize: '1.35rem',
            padding: '0.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => e.target.style.textShadow = '0 0 8px var(--neon-cyan)'}
          onMouseLeave={(e) => e.target.style.textShadow = 'none'}
          title="Toggle Sidebar"
        >
          ☰
        </button>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 className="glow-text-cyan" style={{
            fontFamily: 'var(--font-header)',
            fontSize: '1.4rem',
            fontWeight: '900',
            letterSpacing: '3px',
            textTransform: 'uppercase'
          }}>
            JANAKI
          </h1>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        {/* Cognitive Mode Switcher Button */}
        <button
          onClick={onCognitiveToggle}
          className="neon-button hologram-effect"
          style={{
            padding: '0.4rem 1.2rem',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: cognitiveMode ? 'rgba(143, 175, 135, 0.25)' : 'rgba(3, 10, 22, 0.6)',
            borderColor: cognitiveMode ? 'var(--neon-cyan)' : 'var(--glass-border)',
            boxShadow: cognitiveMode ? '0 0 12px rgba(143, 175, 135, 0.3)' : 'none',
            color: cognitiveMode ? 'var(--neon-cyan)' : 'var(--text-secondary)'
          }}
        >
          <span>{cognitiveMode ? '🍃 COGNITIVE ACTIVE' : '🧘 COGNITIVE MODE'}</span>
        </button>

        {/* Research Mode HUD Button */}
        <button
          onClick={onResearchClick}
          className="neon-button hologram-effect"
          style={{
            padding: '0.4rem 1.2rem',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: isResearchActive ? 'rgba(255, 51, 102, 0.15)' : 'rgba(3, 10, 22, 0.6)',
            borderColor: isResearchActive ? 'var(--neon-red)' : 'var(--glass-border)',
            boxShadow: isResearchActive ? '0 0 15px rgba(255, 51, 102, 0.3)' : 'none',
            color: isResearchActive ? 'var(--neon-red)' : 'var(--text-secondary)'
          }}
        >
          <span>{isResearchActive ? '❌ EXIT RESEARCH' : '🔬 INITIALIZE RESEARCH'}</span>
        </button>

        {/* Hologram System Clock */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem',
          color: 'var(--neon-cyan)',
          letterSpacing: '1px',
          borderLeft: '1px solid var(--glass-border)',
          paddingLeft: '1.2rem',
          minWidth: '110px',
          textAlign: 'right'
        }}>
          {time || '00:00:00.000'}
        </div>
      </div>
    </header>
  );
}
