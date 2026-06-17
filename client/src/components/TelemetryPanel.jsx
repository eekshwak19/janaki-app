import React from 'react';

export default function TelemetryPanel({ routes = {}, lastTelemetry = null }) {
  const pipeline = routes.pipeline || [];

  const getStatusColor = (status) => {
    switch (status) {
      case 'success': return 'var(--neon-green)';
      case 'failed': return 'var(--neon-red)';
      case 'attempting': return 'var(--neon-cyan)';
      case 'skipped': return 'var(--text-muted)';
      default: return 'rgba(255, 255, 255, 0.1)';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'success': return '● ACTIVE';
      case 'failed': return '▲ ERROR';
      case 'attempting': return '⏳ TRYING';
      case 'skipped': return '○ SKIPPED';
      default: return '□ PENDING';
    }
  };

  // Extract history list or mock it from the static pipeline configuration
  const getStageStatus = (stageModel) => {
    if (!lastTelemetry || !lastTelemetry.routingHistory) {
      // If no telemetry run yet, check key configuration from routes.providers
      const isGemini = stageModel.includes('gemini');
      const hasKey = isGemini ? routes.providers?.gemini : routes.providers?.openrouter;
      return {
        status: hasKey ? 'pending' : 'skipped',
        error: hasKey ? '' : 'API Key Missing'
      };
    }

    const matchedHistory = lastTelemetry.routingHistory.find(h => h.model === stageModel);
    return matchedHistory || { status: 'pending', error: '' };
  };

  return (
    <aside className="glass-panel hud-corners hologram-effect" style={{
      padding: '1.2rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.2rem',
      height: '100%',
      minWidth: '320px',
      maxWidth: '380px'
    }}>
      {/* Scanline element */}
      <div className="scan-line" />

      {/* Title */}
      <div>
        <h3 className="glow-text-cyan" style={{
          fontFamily: 'var(--font-header)',
          fontSize: '0.9rem',
          letterSpacing: '2px',
          borderBottom: '1px dashed var(--glass-border)',
          paddingBottom: '0.4rem',
          textTransform: 'uppercase'
        }}>
          🛰️ Failover Telemetry
        </h3>
      </div>

      {/* Sequential Pipeline Dashboard */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          letterSpacing: '1px'
        }}>
          ROUTING FALLBACK CHAIN
        </span>

        {pipeline.map((stage, idx) => {
          const stageState = getStageStatus(stage.model);
          const color = getStatusColor(stageState.status);

          return (
            <div key={stage.id} className="glass-panel" style={{
              padding: '0.7rem',
              background: 'rgba(3, 10, 22, 0.45)',
              border: `1px solid ${stageState.status === 'attempting' ? 'var(--neon-cyan)' : 'var(--glass-border)'}`,
              boxShadow: stageState.status === 'attempting' ? 'var(--shadow-glow)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'var(--font-header)',
                  fontSize: '0.7rem',
                  letterSpacing: '1px',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>0{idx + 1}.</span> {stage.name}
                </span>
                
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.65rem',
                  color: color,
                  textShadow: stageState.status !== 'skipped' && stageState.status !== 'pending' ? `0 0 6px ${color}` : 'none',
                  fontWeight: 'bold'
                }}>
                  {getStatusLabel(stageState.status)}
                </span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                color: 'var(--text-secondary)'
              }}>
                <span>MODEL: {stage.model.split('/').pop()}</span>
                {stageState.latencyMs !== undefined && (
                  <span style={{ color: 'var(--neon-cyan)' }}>{stageState.latencyMs}ms</span>
                )}
              </div>

              {stageState.error && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.58rem',
                  color: 'var(--neon-red)',
                  marginTop: '0.2rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  ↳ ERR: {stageState.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Decision stats */}
      <div style={{
        marginTop: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
        borderTop: '1px dashed var(--glass-border)',
        paddingTop: '1rem'
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          letterSpacing: '1px'
        }}>
          LATEST RESPONSE TELEMETRY
        </span>

        {lastTelemetry ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>ACTIVE MODEL:</span>
              <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>
                {lastTelemetry.activeStep.model.split('/').pop().toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>PROVIDER:</span>
              <span style={{ color: lastTelemetry.activeStep.provider === 'gemini' ? 'var(--neon-cyan)' : 'var(--neon-purple)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {lastTelemetry.activeStep.provider}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>LATENCY:</span>
              <span style={{ color: lastTelemetry.latencyMs > 5000 ? 'var(--neon-purple)' : 'var(--neon-green)' }}>
                {lastTelemetry.latencyMs} ms
              </span>
            </div>

            {lastTelemetry.usage && (
              <div style={{
                background: 'rgba(3, 10, 22, 0.5)',
                padding: '0.4rem',
                border: '1px solid rgba(0, 242, 254, 0.1)',
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem',
                fontSize: '0.65rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>PROMPT_TOKENS:</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{lastTelemetry.usage.promptTokenCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>COMPL_TOKENS:</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{lastTelemetry.usage.candidatesTokenCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>TOTAL_TOKENS:</span>
                  <span style={{ color: 'var(--neon-cyan)' }}>{lastTelemetry.usage.totalTokenCount}</span>
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
              borderLeft: '2px solid var(--neon-cyan)',
              paddingLeft: '0.5rem',
              marginTop: '0.2rem',
              color: 'var(--text-secondary)',
              fontSize: '0.7rem',
              lineHeight: '1.2'
            }}>
              <span style={{ color: 'var(--neon-cyan)', fontSize: '0.6rem', fontWeight: 'bold' }}>TRANSMISSION_STATUS:</span>
              <p style={{ fontStyle: 'italic' }}>
                "Successfully routed payload to {lastTelemetry.activeStep.name} after evaluating fallback dependencies."
              </p>
            </div>
          </div>
        ) : (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '1.5rem',
            border: '1px dashed rgba(0, 242, 254, 0.1)',
            borderRadius: '4px'
          }}>
            [AWAITING TRANSMISSION ROUTE]
          </div>
        )}
      </div>
    </aside>
  );
}
