// src/components/KYCBanner.jsx
//
// Shown on Trade, Pools, and Stake pages when the connected wallet
// is not yet whitelisted. Links to the Compliance page to complete KYC.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompliance } from '../hooks/useCompliance';
import { useWallet } from '../context/WalletContext';

export function KYCBanner() {
  const { isConnected } = useWallet();
  const { isWhitelisted, isLoading } = useCompliance();
  const navigate = useNavigate();

  // Don't show if not connected, still loading, or already whitelisted
  if (!isConnected || isLoading || isWhitelisted) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px', flexWrap: 'wrap',
      background: 'rgba(245,158,11,0.07)',
      border: '1px solid rgba(245,158,11,0.25)',
      borderRadius: '10px', padding: '12px 16px',
      marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '18px' }}>🛡️</span>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f59e0b' }}>
            KYC Verification Required
          </div>
          <div style={{ fontSize: '12px', color: '#78716c', marginTop: '1px' }}>
            RWA tokens are regulated securities. Complete identity verification to trade.
          </div>
        </div>
      </div>
      <button
        onClick={() => navigate('/compliance')}
        style={{
          fontSize: '13px', fontWeight: 600,
          color: '#f59e0b',
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '7px', padding: '7px 16px',
          cursor: 'pointer', whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Complete KYC →
      </button>
    </div>
  );
}

export default KYCBanner;
