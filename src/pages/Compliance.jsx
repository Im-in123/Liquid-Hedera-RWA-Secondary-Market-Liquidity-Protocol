import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useCompliance } from '../hooks/useCompliance';
import { POOL_SYMBOLS, POOLS } from '../config/contracts';
import { useHCS } from '../hooks/useHCS';
import { useContracts } from '../hooks/useContracts';

const JURISDICTIONS = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'EU', label: 'European Union' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'JP', label: 'Japan' },
  { code: 'HK', label: 'Hong Kong' },
  { code: 'GH', label: 'Ghana' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'ZA', label: 'South Africa' },
];

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
      background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
      color: ok ? '#10B981' : '#ef4444',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
    }}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '13px',
    }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{
        color: '#e2e8f0', fontWeight: 500,
        fontFamily: mono ? 'monospace' : 'inherit',
        fontSize: mono ? '12px' : '13px',
      }}>{value}</span>
    </div>
  );
}

function Panel({ title, children, accent }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))',
      border: `1px solid ${accent ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: '12px', padding: '20px',
      borderTop: accent ? '2px solid #10B981' : undefined,
    }}>
      <h2 style={{
        fontSize: '13px', fontWeight: 700, color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px',
      }}>{title}</h2>
      {children}
    </div>
  );
}

export default function Compliance() {
  const { isConnected, account, connect } = useWallet();
  const { isWhitelisted, isLoading, profile, checkStatus } = useCompliance();
  const { contracts } = useContracts();
  const { publishEvent } = useHCS();

  const [fullName, setFullName]           = useState('');
  const [jurisdiction, setJurisdiction]   = useState('');
  const [isAccredited, setIsAccredited]   = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [successTx, setSuccessTx]     = useState(null);

  const [assetRestrictions, setAssetRestrictions] = useState({});

  useEffect(() => {
    if (isConnected && contracts?.complianceRegistry) loadAssetRestrictions();
  }, [isConnected, contracts]);

  const loadAssetRestrictions = async () => {
    const restrictions = {};
    for (const sym of POOL_SYMBOLS) {
      try {
        const r = await contracts.complianceRegistry.getAssetRestrictions(POOLS[sym].assetToken);
        restrictions[sym] = { requiresKYC: r[0], requiresAccreditation: r[1], isActive: r[4] };
      } catch (_) {}
    }
    setAssetRestrictions(restrictions);
  };

  const handleSubmitKYC = async () => {
    if (!isConnected) { await connect(); return; }
    setSubmitting(true);
    setSubmitError(null);
    setSuccessTx(null);

    try {
      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account, name: fullName.trim(), jurisdiction }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'KYC request failed');

      if (data.alreadyWhitelisted) {
        await checkStatus();
        setSuccessTx('already-verified');
        return;
      }

      setSuccessTx(data.txHash);
      publishEvent('kyc_verified', { jurisdiction, address: account, txHash: data.txHash });
      await checkStatus();

    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const kycExpiry = profile?.kycExpiryTime
    ? new Date(profile.kycExpiryTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const kycExpired  = profile?.kycExpiryTime && Date.now() / 1000 > profile.kycExpiryTime;
  const isCompliant = isWhitelisted && !kycExpired;

  const nameWords    = fullName.trim().split(/\s+/).filter(Boolean);
  const nameValid    = nameWords.length >= 2;
  const showNameHint = fullName.trim().length > 0 && !nameValid;
  const canSubmit    = nameValid && jurisdiction && isAccredited && agreedToTerms && !submitting;

  const inputStyle = {
    width: '100%', background: 'rgba(51,65,85,0.4)',
    borderRadius: '8px', padding: '10px 12px',
    color: '#f1f5f9', fontSize: '14px', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }} className="animate-fadeIn">

      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px 0' }}>
          Compliance &amp; KYC
        </h1>
        <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
          RWA tokens are regulated securities. Identity verification is required before trading.
        </p>
      </div>

      {!isConnected ? (
        <div style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.18)', borderRadius: '10px', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔐</div>
          <p style={{ color: '#fbbf24', fontSize: '14px', marginBottom: '16px' }}>
            Connect your wallet to view your compliance status
          </p>
          <button onClick={connect} className="btn-primary" style={{ fontSize: '13px', padding: '8px 20px' }}>
            Connect Wallet
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '14px' }}>

          <Panel title="Your Compliance Status" accent={isCompliant}>
            {isLoading ? (
              <div style={{ height: '80px', background: '#1e293b', borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ) : isCompliant ? (
              <div>
                <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '14px 16px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '22px' }}>✅</span>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#10B981' }}>You are cleared to trade all RWA tokens</div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    Approved by Liquid Protocol compliance operator · KYC valid until {kycExpiry}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <StatusBadge ok={true} label="Whitelisted" />
                  <StatusBadge ok={true} label="KYC Verified" />
                  <StatusBadge ok={profile?.isAccredited} label="Accredited Investor" />
                </div>
                <InfoRow label="Wallet"       value={`${account?.slice(0, 6)}...${account?.slice(-4)}`} mono />
                <InfoRow label="Jurisdiction" value={profile?.jurisdiction || '—'} />
                <InfoRow label="KYC Expiry"   value={kycExpiry || '—'} />
              </div>
            ) : (
              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>⏳ Verification required</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>Complete the KYC form below to get cleared for trading.</div>
              </div>
            )}
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' }}>

            {!isCompliant && (
              <Panel title="Identity Verification">
                <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
                  In production, submitting this form triggers document verification via a licensed KYC provider (e.g. Synaps or Fractal ID). Your identity hash is stored on-chain via Hedera. For this testnet demo, Liquid Protocol acts as the compliance operator and approves your application automatically.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

                  <div>
                    <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '5px' }}>
                      Full Legal Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="First and last name e.g. John Doe"
                      style={{ ...inputStyle, border: showNameHint ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(255,255,255,0.08)' }}
                    />
                    {showNameHint && (
                      <p style={{ fontSize: '11px', color: '#f59e0b', margin: '5px 0 0' }}>
                        ⚠️ Please enter your first and last name
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '5px' }}>
                      Country / Jurisdiction <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} style={{ ...inputStyle, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
                      <option value="">Select your country</option>
                      {JURISDICTIONS.map(j => <option key={j.code} value={j.code}>{j.label}</option>)}
                    </select>
                  </div>

                  <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '8px', padding: '12px 14px' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={isAccredited} onChange={e => setIsAccredited(e.target.checked)} style={{ marginTop: '3px', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 600, marginBottom: '4px' }}>
                          I am an Accredited Investor <span style={{ color: '#ef4444' }}>*</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.6 }}>
                          I meet the accredited investor criteria: net worth exceeding $1M (excluding primary residence), or annual income exceeding $200K ($300K joint) for the past two consecutive years with reasonable expectation of the same for the current year.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '8px', padding: '12px 14px' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} style={{ marginTop: '3px', flexShrink: 0 }} />
                      <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>
                        I confirm the information provided is accurate and complete. I understand RWA tokens are securities and I am legally permitted to purchase and trade them in my jurisdiction. I agree to the Liquid Protocol Terms of Service and Privacy Policy, and consent to my identity being verified and recorded on the Hedera blockchain.
                      </div>
                    </label>
                  </div>

                  {submitError && (
                    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '7px', padding: '10px 12px' }}>
                      <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>❌ {submitError}</p>
                    </div>
                  )}

                  <button onClick={handleSubmitKYC} disabled={!canSubmit} className="w-full btn-primary disabled:opacity-40" style={{ padding: '11px', fontSize: '14px', fontWeight: 600 }}>
                    {submitting ? '⏳ Submitting to Hedera...' : 'Submit KYC Application'}
                  </button>

                  <p style={{ fontSize: '11px', color: '#334155', textAlign: 'center', margin: 0 }}>
                    No wallet signing required · Approval is recorded on-chain by the compliance operator
                  </p>

                  {successTx && (
                    <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#10B981', marginBottom: '4px' }}>✅ KYC Approved!</div>
                      <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px' }}>Your wallet is now whitelisted. You can trade all RWA tokens.</div>
                      {successTx !== 'already-verified' && (
                        <a href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(successTx)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', fontSize: '12px' }}>
                          View approval on HashScan →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="Asset Compliance Requirements">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {POOL_SYMBOLS.map(sym => {
                  const r = assetRestrictions[sym];
                  return (
                    <div key={sym} style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{sym}</div>
                        {r?.isActive
                          ? <span style={{ fontSize: '11px', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', padding: '2px 8px', borderRadius: '10px' }}>Regulated</span>
                          : <span style={{ fontSize: '11px', color: '#10B981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', padding: '2px 8px', borderRadius: '10px' }}>Open</span>
                        }
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {r?.requiresKYC           && <StatusBadge ok={isCompliant}           label="KYC Required" />}
                        {r?.requiresAccreditation && <StatusBadge ok={profile?.isAccredited} label="Accredited Required" />}
                        {!r?.isActive             && <span style={{ fontSize: '12px', color: '#64748b' }}>No restrictions</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(51,65,85,0.3)', borderRadius: '8px', fontSize: '12px', color: '#475569', lineHeight: 1.6 }}>
                Compliance is enforced on-chain via ERC-3643. Non-whitelisted addresses cannot execute trades, add liquidity, or remove liquidity for regulated assets.
              </div>

              {/* Link to audit log */}
              <Link to="/audit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', padding: '10px 14px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '8px', textDecoration: 'none' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#3B82F6' }}>📡 View HCS Audit Log</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>Live on-chain compliance activity feed</div>
                </div>
                <span style={{ color: '#3B82F6', fontSize: '16px' }}>→</span>
              </Link>
            </Panel>
          </div>

        </div>
      )}
    </div>
  );
}
