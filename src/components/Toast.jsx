import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';

// ── Context ──────────────────────────────────────────────────────────────────
const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ── Provider (wrap your app once) ────────────────────────────────────────────
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((type, title, message, txId) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message, txId }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);

  const dismiss = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), []);

  const toast = {
    success: (title, message, txId) => add('success', title, message, txId),
    error:   (title, message)       => add('error',   title, message),
    info:    (title, message)       => add('info',    title, message),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────
function ToastContainer({ toasts, dismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px',
      zIndex: 99999, display: 'flex', flexDirection: 'column',
      gap: '10px', pointerEvents: 'none',
    }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} dismiss={dismiss} />)}
    </div>
  );
}

// ── Individual Toast ──────────────────────────────────────────────────────────
function ToastItem({ toast: t, dismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger slide-in
    const enter = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(enter);
  }, []);

  const colors = {
    success: { border: 'rgba(16,185,129,0.5)',  bg: 'rgba(10,30,20,0.97)',  icon: '✅', text: '#10B981' },
    error:   { border: 'rgba(239,68,68,0.5)',   bg: 'rgba(30,10,10,0.97)',  icon: '❌', text: '#f87171' },
    info:    { border: 'rgba(59,130,246,0.5)',   bg: 'rgba(10,15,30,0.97)', icon: 'ℹ️', text: '#60a5fa' },
  };
  const c = colors[t.type] ?? colors.info;

  return (
    <div style={{
      pointerEvents: 'auto',
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '12px 14px', borderRadius: '10px',
      minWidth: '300px', maxWidth: '380px',
      background: c.bg,
      border: `1px solid ${c.border}`,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      transform: visible ? 'translateX(0)' : 'translateX(120%)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
    }}>
      <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{c.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: c.text, marginBottom: '2px' }}>{t.title}</div>
        {t.message && <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>{t.message}</div>}
        {t.txId && t.txId !== 'submitted' && (
          <a
            href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(t.txId)}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#6ee7b7', textDecoration: 'none', marginTop: '4px', display: 'inline-block' }}>
            View on HashScan →
          </a>
        )}
      </div>
      <button onClick={() => dismiss(t.id)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: '#475569', fontSize: '18px', lineHeight: 1,
        padding: '0', flexShrink: 0, marginTop: '-1px',
      }}>×</button>
    </div>
  );
}
