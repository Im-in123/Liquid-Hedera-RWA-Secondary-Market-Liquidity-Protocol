import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContracts } from '../hooks/useContracts';
import { TOKENS, FAUCET_TOKENS, CONTRACTS } from '../config/contracts';

const MINT_AMOUNT = '1000';

const TOKEN_COLORS = {
  RWAPROP:   { text: '#60a5fa', border: 'rgba(96,165,250,0.2)',  bg: 'rgba(96,165,250,0.04)'  },
  RWAEQUITY: { text: '#a78bfa', border: 'rgba(167,139,250,0.2)', bg: 'rgba(167,139,250,0.04)' },
  RWABOND:   { text: '#fbbf24', border: 'rgba(251,191,36,0.2)',  bg: 'rgba(251,191,36,0.04)'  },
  USDC:      { text: '#34d399', border: 'rgba(52,211,153,0.2)',  bg: 'rgba(52,211,153,0.04)'  },
};

function Faucet() {
  const { isConnected, account, connect } = useWallet();
  const { getERC20Contract, executeERC20Call, executeATSCall, getATSRegistryContract } = useContracts();

  const [balances, setBalances]         = useState({});
  const [loading, setLoading]           = useState({});
  const [txIds, setTxIds]               = useState({});
  // identity registration step
  const [isIdentityVerified, setIsIdentityVerified] = useState(null); // null = loading
  const [registering, setRegistering]               = useState(false);
  const [registerTxId, setRegisterTxId]             = useState(null);
  const [registerError, setRegisterError]           = useState(null);

  useEffect(() => {
    if (isConnected && account) {
      loadBalances();
      checkIdentity();
    }
  }, [isConnected, account]);

  const loadBalances = async () => {
    try {
      const results = await Promise.all(
        FAUCET_TOKENS.map(sym => getERC20Contract(TOKENS[sym].address).balanceOf(account))
      );
      const updated = {};
      FAUCET_TOKENS.forEach((sym, i) => {
        updated[sym] = parseFloat(ethers.formatEther(results[i])).toLocaleString(undefined, { maximumFractionDigits: 2 });
      });
      setBalances(updated);
    } catch (err) { console.error(err); }
  };

  // Check if this wallet is verified in the ATSIdentityRegistry.
  // faucetMint() on RWAToken requires _identityRegistry.isVerified(msg.sender).
  const checkIdentity = async () => {
    try {
      const atsRegistry = getATSRegistryContract();
      const verified = await atsRegistry.isVerified(account);
      setIsIdentityVerified(verified);
    } catch (err) {
      console.warn('Identity check failed:', err.message);
      setIsIdentityVerified(false);
    }
  };

  // Call ATSIdentityRegistry.selfRegister() — demo mode must be enabled (set in deploy script).
  // This is a one-time step that registers the user's wallet in the identity registry so
  // they can receive ERC-3643 tokens. In production this would be done by the compliance operator.
  const handleSelfRegister = async () => {
    setRegistering(true);
    setRegisterError(null);
    setRegisterTxId(null);
    try {
      const result = await executeATSCall('selfRegister', [], 200_000);
      setRegisterTxId(result?.transactionId?.toString() ?? 'submitted');
      // Wait briefly then re-check identity status
      setTimeout(async () => {
        await checkIdentity();
      }, 3000);
    } catch (err) {
      setRegisterError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleMint = async (symbol) => {
    if (!isConnected) { await connect(); return; }
    setLoading(prev => ({ ...prev, [symbol]: true }));
    setTxIds(prev => ({ ...prev, [symbol]: null }));
    try {
      const isRWA = TOKENS[symbol]?.standard === 'ERC-3643';
      const result = isRWA
        ? await executeERC20Call(TOKENS[symbol].address, 'faucetMint', [])
        : await executeERC20Call(TOKENS[symbol].address, 'mint', [account, ethers.parseEther(MINT_AMOUNT)]);
      setTxIds(prev => ({ ...prev, [symbol]: result?.transactionId?.toString() ?? 'submitted' }));
      setTimeout(loadBalances, 3000);
    } catch (err) {
      alert('Mint failed: ' + err.message);
    } finally {
      setLoading(prev => ({ ...prev, [symbol]: false }));
    }
  };

  // RWA tokens require identity verification to faucetMint.
  // USDC (MockERC20) has no such restriction.
  const canMintRWA = isIdentityVerified === true;

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', width: '100%' }} className="animate-fadeIn">

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>Testnet Faucet 🚰</h1>
        <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>Claim {MINT_AMOUNT} test tokens to your wallet. No real value.</p>
      </div>

      <div style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.18)', borderRadius: '7px', padding: '8px 12px', marginBottom: '12px' }}>
        <p style={{ color: '#fbbf24', fontSize: '14px', margin: 0 }}>⚠️ <strong>Testnet only.</strong> These tokens have no real value.</p>
      </div>

      {!isConnected ? (
        <div style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '30px', marginBottom: '10px' }}>🔐</div>
          <p style={{ color: '#94a3b8', fontSize: '15px', marginBottom: '16px' }}>Connect your wallet to claim test tokens.</p>
          <button onClick={connect} className="btn-primary" style={{ fontSize: '15px', padding: '8px 20px' }}>Connect Wallet</button>
        </div>
      ) : (
        <>
          {/* ── Step 1: Identity Registration ─────────────────────────────── */}
          {isIdentityVerified === null ? (
            /* loading */
            <div style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', fontSize: '13px', color: '#475569' }}>
              Checking identity status...
            </div>
          ) : !isIdentityVerified ? (
            <div style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '20px', flexShrink: 0 }}>🪪</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#a78bfa', marginBottom: '4px' }}>
                    Step 1 — Register your identity
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px', lineHeight: 1.6 }}>
                    ERC-3643 tokens require identity verification before they can be held or transferred.
                    Click below to register your wallet in the ATS Identity Registry (demo mode — testnet only).
                  </div>
                  <button
                    onClick={handleSelfRegister}
                    disabled={registering}
                    className="btn-primary"
                    style={{ padding: '7px 16px', fontSize: '13px', opacity: registering ? 0.6 : 1 }}
                  >
                    {registering ? 'Registering...' : 'Register Identity (Self-Register)'}
                  </button>
                  {registerTxId && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#10B981' }}>
                      ✓ Submitted — waiting for confirmation...
                    </div>
                  )}
                  {registerError && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444' }}>
                      ✗ {registerError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>✅</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#10B981' }}>Identity Verified</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  Your wallet is registered in the ATS Identity Registry. You can claim all tokens.
                </div>
              </div>
            </div>
          )}

          {/* ── Token list ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {FAUCET_TOKENS.map(symbol => {
              const token    = TOKENS[symbol];
              const colors   = TOKEN_COLORS[symbol];
              const isRWA    = token?.standard === 'ERC-3643';
              const disabled = loading[symbol] || (isRWA && !canMintRWA);
              return (
                <div key={symbol} style={{
                  background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))',
                  border: `1px solid ${colors.border}`,
                  borderRadius: '10px', padding: '14px 16px',
                  boxShadow: `inset 0 0 0 1000px ${colors.bg}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: 700, color: colors.text, margin: 0 }}>{symbol}</h2>
                        {isRWA && (
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '3px', padding: '1px 5px' }}>
                            ERC-3643
                          </span>
                        )}
                      </div>
                      <p style={{ color: '#475569', fontSize: '13px', margin: '2px 0 0' }}>{token.description}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Balance</div>
                      <div style={{ fontSize: '17px', fontWeight: 700, color: '#f1f5f9', marginTop: '1px' }}>{balances[symbol] ?? '0'}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleMint(symbol)}
                    disabled={disabled}
                    className="w-full btn-primary disabled:opacity-50"
                    style={{ padding: '7px', fontSize: '14px' }}
                    title={isRWA && !canMintRWA ? 'Complete Step 1 (identity registration) first' : ''}
                  >
                    {loading[symbol]
                      ? 'Minting...'
                      : (isRWA && !canMintRWA)
                        ? `Register identity first`
                        : `Claim ${MINT_AMOUNT} ${symbol}`}
                  </button>
                  {txIds[symbol] && (
                    <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px', padding: '7px 10px', marginTop: '8px' }}>
                      <p style={{ color: '#10B981', fontSize: '13px', margin: '0 0 2px' }}>✅ Minted {MINT_AMOUNT} {symbol}!</p>
                      <a href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(txIds[symbol])}`} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', fontSize: '13px' }}>
                        View on HashScan →
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Next Steps ──────────────────────────────────────────────────── */}
          <div style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.7), rgba(15,23,42,0.8))', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px 16px', marginTop: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>Next Steps</h3>
            <ol style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '14px', color: '#64748b', listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                'Register identity (Step 1 above), then claim USDC and RWA tokens',
                <React.Fragment key="2">Go to <strong style={{ color: '#e2e8f0' }}>Compliance</strong> → complete KYC for full trading access</React.Fragment>,
                <React.Fragment key="3">Go to <strong style={{ color: '#e2e8f0' }}>Trade</strong> → swap USDC for RWA tokens</React.Fragment>,
                <React.Fragment key="4">Go to <strong style={{ color: '#e2e8f0' }}>Pools</strong> → add liquidity to earn trading fees</React.Fragment>,
                <React.Fragment key="5">Go to <strong style={{ color: '#e2e8f0' }}>Stake</strong> → stake LP tokens for bonus rewards</React.Fragment>,
              ].map((step, i) => (
                <li key={i}><span style={{ color: '#3B82F6', fontWeight: 700, marginRight: '6px' }}>{i + 1}.</span>{step}</li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

export default Faucet;