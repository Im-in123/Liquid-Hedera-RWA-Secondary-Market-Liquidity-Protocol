import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import WalletButton from './WalletButton';
import { useNotifications } from '../context/NotificationContext';

function BellIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function Navbar({ theme, toggleTheme }) {
  const location = useLocation();
  const { notifications, badges, dismiss, dismissAll } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const navLinks = [
    { path: '/marketplace', label: 'Marketplace', badge: 'marketplace' },
    { path: '/pools',       label: 'Liquidity',   badge: 'pools' },
    { path: '/stake',       label: 'Stake',        badge: 'stake' },
    { path: '/dashboard',   label: 'Portfolio',    badge: 'dashboard' },
    { path: '/faucet',      label: '🚰 Faucet',   badge: 'faucet' },
    { path: '/compliance',  label: '🛡️ KYC',      badge: 'compliance' },
    { path: '/audit',       label: '📡 Audit Log', badge: 'audit' },
  ];

  const totalCount = notifications.length;

  return (
    <nav className="bg-dark-secondary border-b border-dark-tertiary sticky top-0 z-50 h-16 shadow-md">
      <div className="container mx-auto px-4 h-full">
        <div className="flex items-center justify-between h-full">

          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 hover:opacity-90 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-xl font-bold text-white">L</span>
            </div>
            <span className="text-xl font-bold text-white hidden sm:block">Liquid</span>
          </Link>

          {/* Nav links */}
          <div id="nav-links" className="hidden md:flex space-x-1">
            {navLinks.map((link) => {
              const count = badges[link.badge] || 0;
              const active = location.pathname === link.path;
              return (
                <Link key={link.path} to={link.path} style={{ position: 'relative' }}
                  className={`px-3 py-2 rounded-lg font-medium transition-all duration-200 text-sm ${
                    active ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-muted hover:text-white hover:bg-dark-tertiary'
                  }`}>
                  {link.label}
                  {count > 0 && (
                    <span style={{
                      position: 'absolute', top: '4px', right: '4px',
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#ef4444',
                      boxShadow: '0 0 0 1.5px #1e293b',
                    }} />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Hamburger — mobile only */}
          <button id="hamburger-btn"
            onClick={() => setMenuOpen(o => !o)}
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', width: '36px', height: '36px', cursor: 'pointer', color: '#94a3b8', flexShrink: 0, alignItems: 'center', justifyContent: 'center', display: 'none' }}>
            {menuOpen
              ? <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              : <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            }
          </button>

          {/* Right side */}
          <div className="flex items-center space-x-3">
            {/* Hedera Testnet Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-500/40 bg-purple-500/10">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></div>
              <span className="text-xs font-semibold text-purple-300 tracking-wide">Hedera Testnet</span>
            </div>

            {/* Bell */}
            <div ref={bellRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setBellOpen(o => !o)}
                style={{
                  position: 'relative', background: bellOpen ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${bellOpen ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '8px', width: '36px', height: '36px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: totalCount > 0 ? '#f1f5f9' : '#64748b',
                  transition: 'all 0.15s',
                }}>
                <BellIcon />
                {totalCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-4px', right: '-4px',
                    background: '#ef4444', color: '#fff',
                    fontSize: '10px', fontWeight: 700, lineHeight: 1,
                    minWidth: '16px', height: '16px', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px', boxShadow: '0 0 0 2px #1e293b',
                  }}>{totalCount}</span>
                )}
              </button>

              {/* Dropdown */}
              {bellOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  width: '320px', zIndex: 100,
                  background: 'linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.99))',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px', boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
                  overflow: 'hidden',
                }}>
                  {/* Header */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#f1f5f9' }}>
                      Notifications {totalCount > 0 && <span style={{ color: '#ef4444' }}>({totalCount})</span>}
                    </span>
                    {totalCount > 0 && (
                      <button onClick={dismissAll} style={{
                        fontSize: '11px', color: '#64748b', background: 'none', border: 'none',
                        cursor: 'pointer', padding: 0,
                      }}>Dismiss all</button>
                    )}
                  </div>

                  {/* Items */}
                  {totalCount === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', marginBottom: '6px' }}>✅</div>
                      <div style={{ fontSize: '13px', color: '#475569' }}>All caught up</div>
                    </div>
                  ) : (
                    <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                      {notifications.map((n, i) => (
                        <div key={n.id} style={{
                          display: 'flex', alignItems: 'flex-start', gap: '10px',
                          padding: '12px 16px',
                          borderBottom: i < notifications.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          background: 'transparent', transition: 'background 0.15s',
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{n.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '2px' }}>{n.title}</div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>{n.message}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                            <Link
                              to={n.type === 'rewards' ? `${n.path}?tab=rewards` : n.path}
                              onClick={() => setBellOpen(false)}
                              style={{
                                fontSize: '12px', fontWeight: 600, color: '#3B82F6',
                                textDecoration: 'none', padding: '3px 8px',
                                borderRadius: '5px', border: '1px solid rgba(59,130,246,0.25)',
                                background: 'rgba(59,130,246,0.08)',
                                whiteSpace: 'nowrap',
                              }}>Go →</Link>
                            <button onClick={() => dismiss(n.id)} style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#475569', fontSize: '16px', lineHeight: 1, padding: '2px',
                            }}>×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <WalletButton />
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div style={{ background: '#1e293b', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 16px 12px' }} className="md:hidden">
          {navLinks.map((link) => {
            const count = badges[link.badge] || 0;
            const active = location.pathname === link.path;
            return (
              <Link key={link.path} to={link.path} onClick={() => setMenuOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', marginBottom: '2px', textDecoration: 'none', fontSize: '14px', fontWeight: 500, color: active ? '#3B82F6' : '#94a3b8', background: active ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
                {link.label}
                {count > 0 && (
                  <span style={{ background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, minWidth: '16px', height: '16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{count}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

export default Navbar;
