import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '../context/WalletContext';
import { useHCS } from '../hooks/useHCS';
import { HCS_TOPIC_ID } from '../config/contracts';

const POLL_INTERVAL = 8000; // 8 seconds

const EVENT_META = {
  kyc_request:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  icon: '📋', label: 'KYC Request' },
  kyc_approved:      { color: '#10B981', bg: 'rgba(16,185,129,0.07)',  icon: '🛡️', label: 'KYC Approved' },
  kyc_verified:      { color: '#10B981', bg: 'rgba(16,185,129,0.07)',  icon: '✅', label: 'KYC Verified' },
  swap:              { color: '#3B82F6', bg: 'rgba(59,130,246,0.07)',  icon: '💱', label: 'Swap' },
  staked:            { color: '#8B5CF6', bg: 'rgba(139,92,246,0.07)', icon: '🔒', label: 'Staked' },
  unstaked:          { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', icon: '🔓', label: 'Unstaked' },
  rewards_claimed:   { color: '#10B981', bg: 'rgba(16,185,129,0.07)', icon: '💰', label: 'Rewards Claimed' },
  liquidity_added:   { color: '#8B5CF6', bg: 'rgba(139,92,246,0.07)', icon: '💧', label: 'Liquidity Added' },
  liquidity_removed: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', icon: '💧', label: 'Liquidity Removed' },
};

function getEventMeta(event) {
  return EVENT_META[event] || { color: '#94a3b8', bg: 'rgba(255,255,255,0.03)', icon: '📡', label: event?.replace(/_/g, ' ') || 'Event' };
}

function truncateAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatCard({ value, label, color }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.95))',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px', padding: '16px 20px',
      borderTop: `2px solid ${color}`,
    }}>
      <div style={{ fontSize: '24px', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#475569', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

export default function AuditLog() {
  const { account } = useWallet();
  const { fetchAuditLog } = useHCS();

  const [logs, setLogs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [newIds, setNewIds]           = useState(new Set());
  const [liveActive, setLiveActive]   = useState(true);
  const [filter, setFilter]           = useState('all'); // all | mine | kyc | trading
  const [totalSeen, setTotalSeen]     = useState(0);
  const prevSeqRef                    = useRef(0);
  const intervalRef                   = useRef(null);

  const load = useCallback(async (isPolling = false) => {
    const data = await fetchAuditLog(50);
    if (!data.length) { setLoading(false); return; }

    const topSeq = data[0]?.sequenceNumber ?? 0;
    if (isPolling && topSeq > prevSeqRef.current) {
      const incoming = data.filter(d => d.sequenceNumber > prevSeqRef.current);
      setNewIds(new Set(incoming.map(d => d.sequenceNumber)));
      setTimeout(() => setNewIds(new Set()), 3000);
    }
    prevSeqRef.current = topSeq;
    setTotalSeen(data.length);
    setLogs(data);
    setLoading(false);
  }, [fetchAuditLog]);

  useEffect(() => {
    load(false);
  }, []);

  useEffect(() => {
    if (liveActive) {
      intervalRef.current = setInterval(() => load(true), POLL_INTERVAL);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [liveActive, load]);

  const filtered = logs.filter(log => {
    if (filter === 'mine') return log.address?.toLowerCase() === account?.toLowerCase();
    if (filter === 'kyc')  return log.event?.includes('kyc');
    if (filter === 'trading') return ['swap', 'liquidity_added', 'liquidity_removed', 'staked', 'unstaked', 'rewards_claimed'].includes(log.event);
    return true;
  });

  // Stats
  const kycCount     = logs.filter(l => l.event?.includes('kyc')).length;
  const tradingCount = logs.filter(l => ['swap', 'liquidity_added', 'liquidity_removed'].includes(l.event)).length;
  const uniqueWallets = new Set(logs.map(l => l.address).filter(Boolean)).size;

  const filterTabs = [
    { id: 'all',     label: 'All Events',  count: logs.length },
    { id: 'kyc',     label: 'KYC',         count: kycCount },
    { id: 'trading', label: 'Trading',     count: tradingCount },
    { id: 'mine',    label: 'My Events',   count: logs.filter(l => l.address?.toLowerCase() === account?.toLowerCase()).length },
  ];

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }} className="animate-fadeIn">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
              HCS Audit Log
            </h1>
            {/* Live indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '20px', background: liveActive ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)', border: `1px solid ${liveActive ? 'rgba(16,185,129,0.25)' : 'rgba(100,116,139,0.2)'}` }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: liveActive ? '#10B981' : '#64748b',
                boxShadow: liveActive ? '0 0 0 2px rgba(16,185,129,0.3)' : 'none',
                animation: liveActive ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: liveActive ? '#10B981' : '#64748b' }}>
                {liveActive ? 'LIVE' : 'PAUSED'}
              </span>
            </div>
          </div>
          <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
            Every compliance and trading event — permanently recorded on Hedera Consensus Service
          </p>
          {HCS_TOPIC_ID && (
            <a
              href={`https://hashscan.io/testnet/topic/${HCS_TOPIC_ID}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#3B82F6', fontFamily: 'monospace', textDecoration: 'none', marginTop: '4px', display: 'inline-block' }}
            >
              Topic: {HCS_TOPIC_ID} ↗
            </a>
          )}
        </div>

        <button
          onClick={() => setLiveActive(l => !l)}
          style={{
            fontSize: '12px', fontWeight: 600,
            color: liveActive ? '#ef4444' : '#10B981',
            background: liveActive ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
            border: `1px solid ${liveActive ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
            borderRadius: '7px', padding: '7px 14px', cursor: 'pointer',
          }}
        >
          {liveActive ? '⏸ Pause' : '▶ Resume'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '18px' }}>
        <StatCard value={logs.length} label="Total Events" color="#3B82F6" />
        <StatCard value={kycCount} label="KYC Events" color="#10B981" />
        <StatCard value={tradingCount} label="Trading Events" color="#8B5CF6" />
        <StatCard value={uniqueWallets} label="Unique Wallets" color="#f59e0b" />
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            style={{
              fontSize: '12px', fontWeight: 600, padding: '5px 12px',
              borderRadius: '20px', cursor: 'pointer', border: '1px solid',
              background: filter === tab.id ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
              borderColor: filter === tab.id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)',
              color: filter === tab.id ? '#3B82F6' : '#64748b',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
            <span style={{ marginLeft: '5px', opacity: 0.7 }}>({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Log feed */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px', overflow: 'hidden',
      }}>

        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 140px 110px 90px 80px',
          gap: '8px', padding: '10px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          fontSize: '10px', fontWeight: 700, color: '#334155',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          <div />
          <div>Event</div>
          <div>Wallet</div>
          <div>Details</div>
          <div>Seq #</div>
          <div style={{ textAlign: 'right' }}>Time</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: '13px' }}>
            Loading audit log from Hedera mirror node...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: '13px' }}>
            {filter === 'mine' && !account
              ? 'Connect your wallet to see your events'
              : 'No events found for this filter'}
          </div>
        ) : (
          <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
            {filtered.map((log, i) => {
              const meta    = getEventMeta(log.event);
              const isNew   = newIds.has(log.sequenceNumber);
              const isMine  = log.address?.toLowerCase() === account?.toLowerCase();

              return (
                <div
                  key={log.sequenceNumber ?? i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px 1fr 140px 110px 90px 80px',
                    gap: '8px', padding: '10px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    alignItems: 'center',
                    background: isNew
                      ? 'rgba(16,185,129,0.06)'
                      : isMine
                        ? 'rgba(59,130,246,0.04)'
                        : 'transparent',
                    transition: 'background 0.3s',
                    animation: isNew ? 'slideInRow 0.3s ease' : 'none',
                  }}
                  onMouseEnter={e => { if (!isNew) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isNew ? 'rgba(16,185,129,0.06)' : isMine ? 'rgba(59,130,246,0.04)' : 'transparent'; }}
                >
                  {/* Icon */}
                  <div style={{ fontSize: '16px', textAlign: 'center' }}>{meta.icon}</div>

                  {/* Event name */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: meta.color }}>
                        {meta.label.toUpperCase()}
                      </span>
                      {isNew && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#10B981', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', padding: '1px 5px', borderRadius: '10px' }}>
                          NEW
                        </span>
                      )}
                      {isMine && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#3B82F6', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', padding: '1px 5px', borderRadius: '10px' }}>
                          YOU
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '10px', color: '#334155', marginTop: '1px' }}>
                      {formatDate(log.consensusTimestamp)}
                    </div>
                  </div>

                  {/* Wallet */}
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                    {log.address ? (
                      <a
                        href={`https://hashscan.io/testnet/account/${log.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#64748b', textDecoration: 'none' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#3B82F6'}
                        onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
                      >
                        {truncateAddr(log.address)}
                      </a>
                    ) : '—'}
                  </div>

                  {/* Details */}
                  <div style={{ fontSize: '11px', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.jurisdiction && `🌍 ${log.jurisdiction}`}
                    {log.pool && `Pool: ${log.pool}`}
                    {log.amount && `${log.amount}`}
                    {log.amountIn && `${log.amountIn}→${log.amountOut}`}
                    {log.txHash && (
                      <a
                        href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(log.txHash)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#3B82F6', textDecoration: 'none', fontSize: '10px' }}
                      >
                        tx ↗
                      </a>
                    )}
                  </div>

                  {/* Seq */}
                  <div style={{ fontSize: '11px', color: '#334155', fontFamily: 'monospace' }}>
                    #{log.sequenceNumber ?? '—'}
                  </div>

                  {/* Time */}
                  <div style={{ fontSize: '11px', color: '#475569', textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatTimestamp(log.consensusTimestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '11px', color: '#334155' }}>
            Showing {filtered.length} of {logs.length} events · Polling every {POLL_INTERVAL / 1000}s
          </span>
          <span style={{ fontSize: '11px', color: '#334155' }}>
            All events immutably recorded on Hedera Consensus Service
          </span>
        </div>
      </div>

      <style>{`
        @keyframes slideInRow {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
