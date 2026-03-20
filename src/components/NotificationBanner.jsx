import React from 'react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';

// Shows in-page banners filtered by badge key (e.g. 'stake', 'pools')
// Pass badge="all" to show every notification (used on Dashboard)
export function NotificationBanner({ badge, path, onAction }) {
  const { notifications, dismiss } = useNotifications();

  const relevant = notifications.filter(n =>
    badge === 'all' ||
    (badge && n.badge === badge) ||
    (path && n.path === path)
  );

  if (relevant.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
      {relevant.map(n => (
        <div key={n.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: '8px',
          background: n.type === 'rewards' ? 'rgba(16,185,129,0.07)' : 'rgba(245,158,11,0.07)',
          border: `1px solid ${n.type === 'rewards' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>{n.icon}</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>{n.title}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{n.message}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {onAction ? (
              <button onClick={() => { onAction(n); dismiss(n.id); }} style={{
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                color: n.type === 'rewards' ? '#10B981' : '#f59e0b',
                padding: '3px 10px', borderRadius: '5px',
                border: `1px solid ${n.type === 'rewards' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                background: n.type === 'rewards' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
              }}>Go →</button>
            ) : (
              <Link to={n.path} style={{
                fontSize: '12px', fontWeight: 600, color: n.type === 'rewards' ? '#10B981' : '#f59e0b',
                textDecoration: 'none', padding: '3px 10px', borderRadius: '5px',
                border: `1px solid ${n.type === 'rewards' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                background: n.type === 'rewards' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
              }}>Go →</Link>
            )}
            <button onClick={() => dismiss(n.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#475569', fontSize: '16px', lineHeight: 1, padding: '2px',
            }}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default NotificationBanner;
