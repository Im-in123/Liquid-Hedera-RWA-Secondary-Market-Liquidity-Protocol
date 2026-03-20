import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContracts } from '../hooks/useContracts';
import { useMirrorNode } from '../hooks/useMirrorNode';
import { POOLS, POOL_SYMBOLS, TOKENS, CONTRACTS, NETWORK } from '../config/contracts';
import { NotificationBanner } from '../components/NotificationBanner';

const FEATURED = POOL_SYMBOLS[0];

const Sparkline = ({ color = '#3B82F6' }) => {
  const heights = [40, 55, 35, 60, 45, 70, 50, 65, 48, 72, 58, 80];
  return (
    <svg width="56" height="20" viewBox="0 0 56 20" fill="none">
      {heights.map((h, i) => (
        <rect key={i} x={i * 4.8} y={20 - (h / 100) * 20} width="3" height={(h / 100) * 20}
          rx="1" fill={color} opacity={0.25 + (i / heights.length) * 0.65} />
      ))}
    </svg>
  );
};

function StatCard({ label, value, sub, accent, loading }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%)',
      border: accent ? '1px solid rgba(59,130,246,0.35)' : '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px', padding: '16px 18px', position: 'relative', overflow: 'hidden',
    }}>
      {accent && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)' }} />}
      <div style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '8px' }}>{label}</div>
      {loading
        ? <div style={{ height: '22px', background: '#1e293b', borderRadius: '4px', width: '55%' }} />
        : <div style={{ fontSize: '22px', fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>{value}</div>
      }
      {sub && <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function TokenRow({ sym, bal, value, price, description, loading }) {
  const has = parseFloat(bal) > 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 12px', borderRadius: '8px', marginBottom: '5px',
      background: has ? 'rgba(59,130,246,0.04)' : 'rgba(255,255,255,0.015)',
      border: has ? '1px solid rgba(59,130,246,0.14)' : '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 700, color: '#fff',
        }}>{sym.slice(0, 2)}</div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{sym}</div>
          <div style={{ fontSize: '13px', color: '#475569' }}>{description}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {loading
          ? <div style={{ height: '13px', width: '55px', background: '#1e293b', borderRadius: '3px' }} />
          : <>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{Number(bal).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
              {sym !== 'USDC' && price > 0 && <div style={{ fontSize: '13px', color: '#475569' }}>${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>}
            </>
        }
      </div>
    </div>
  );
}

function LPRow({ sym, lpBal, share, loading }) {
  const has = parseFloat(lpBal) > 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 12px', borderRadius: '8px', marginBottom: '5px',
      background: has ? 'rgba(16,185,129,0.04)' : 'rgba(255,255,255,0.015)',
      border: has ? '1px solid rgba(16,185,129,0.14)' : '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '30px', height: '30px', borderRadius: '7px', flexShrink: 0,
          background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px',
        }}>💧</div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{sym}/USDC</div>
          <div style={{ fontSize: '13px', color: '#475569' }}>{share}% pool share</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {loading
          ? <div style={{ height: '13px', width: '50px', background: '#1e293b', borderRadius: '3px' }} />
          : <>
              <div style={{ fontSize: '15px', fontWeight: 600, color: has ? '#10B981' : '#334155' }}>
                {Number(lpBal).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </div>
              <div style={{ fontSize: '13px', color: '#475569' }}>LP tokens</div>
            </>
        }
      </div>
    </div>
  );
}

function Panel({ title, action, badge, children }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.75) 0%, rgba(15,23,42,0.85) 100%)',
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{title}</h2>
          {badge && (
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#8B5CF6', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '4px', padding: '1px 6px', letterSpacing: '0.05em' }}>
              {badge}
            </span>
          )}
        </div>
        {action && (
          <Link to={action.to} style={{
            fontSize: '13px', color: '#3B82F6', textDecoration: 'none', fontWeight: 600,
            padding: '3px 9px', borderRadius: '20px',
            border: '1px solid rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.07)',
          }}>{action.label}</Link>
        )}
      </div>
      {children}
    </div>
  );
}

// Format a Mirror Node timestamp
function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Decode 4-byte function selector to human label
const SELECTORS = {
  '0x3593564c': 'Swap',
  '0xe8e33700': 'Add Liquidity',
  '0x4a25d94a': 'Remove Liquidity',
  '0xb6b55f25': 'Stake',
  '0x2e1a7d4d': 'Unstake',
  '0x379607f5': 'Claim Rewards',
};
function decodeSelector(hex) {
  if (!hex) return 'Contract Call';
  const sel = hex.slice(0, 10).toLowerCase();
  return SELECTORS[sel] ?? 'Contract Call';
}

function Dashboard() {
  const { isConnected, account, connect, getDisplayName } = useWallet();
  const { contracts, getTokenBalance, getERC20Contract } = useContracts();
  const { ammTransactions, protocolStats, loading: mirrorLoading, refresh: mirrorRefresh, lastFetched } = useMirrorNode();

  const [loading, setLoading]               = useState(true);
  const [tokenBalances, setTokenBalances]   = useState({});
  const [lpBalances, setLpBalances]         = useState({});
  const [lpTotalSupplies, setLpTotalSupplies] = useState({});
  const [poolPrices, setPoolPrices]         = useState({});
  const [allStakeInfo, setAllStakeInfo]     = useState({});
  // Computed totals across all stake pools
  const totalStaked = Object.values(allStakeInfo).reduce((sum, s) => sum + parseFloat(s.stakedAmount || 0), 0);
  const totalPendingRewards = Object.values(allStakeInfo).reduce((sum, s) => sum + parseFloat(s.pendingRewards || 0), 0);
  // Keep rwaStakeInfo for backward compat with existing UI references
  const rwaStakeInfo = allStakeInfo['rwa-RWAPROP'] || { amount: '0', pendingRewards: '0' };

  useEffect(() => { if (contracts?.adaptiveAMM) loadPoolData(); }, [contracts]);
  useEffect(() => {
    if (isConnected && contracts?.adaptiveAMM && account) loadUserData();
    else setLoading(false);
  }, [isConnected, contracts, account]);

  useEffect(() => {
    if (!isConnected || !contracts?.adaptiveAMM || !account) return;
    const interval = setInterval(() => { loadPoolData(); loadUserData(); }, 30000);
    return () => clearInterval(interval);
  }, [isConnected, contracts, account]);

  const loadPoolData = async () => {
    try {
      const prices = {}, supplies = {};
      await Promise.all(POOL_SYMBOLS.map(async sym => {
        const pool = POOLS[sym];
        try {
          const raw = await contracts.adaptiveAMM.getPool(pool.ammPoolId);
          const ar = parseFloat(ethers.formatEther(raw.assetReserve));
          const qr = parseFloat(ethers.formatEther(raw.quoteReserve));
          prices[sym] = ar > 0 ? (qr / ar).toFixed(4) : '0';
          const lpSupply = await contracts.adaptiveAMM.getLPTotalSupply(pool.ammPoolId);
          supplies[sym] = ethers.formatEther(lpSupply);
        } catch (_) { prices[sym] = '0'; supplies[sym] = '0'; }
      }));
      setPoolPrices(prices); setLpTotalSupplies(supplies);
    } catch (_) {}
  };

  const loadUserData = async () => {
    setLoading(true);
    try {
      const balResults = await Promise.all(
        Object.entries(TOKENS).map(([sym, t]) =>
          getTokenBalance(t.address).then(b => [sym, ethers.formatEther(b)]).catch(() => [sym, '0'])
        )
      );
      setTokenBalances(Object.fromEntries(balResults));
      const lpResults = await Promise.all(
        POOL_SYMBOLS.map(async sym => {
          try {
            const lpContract = getERC20Contract(POOLS[sym].lpToken);
            const bal = await lpContract.balanceOf(account);
            return [sym, ethers.formatEther(bal)];
          } catch { return [sym, '0']; }
        })
      );
      setLpBalances(Object.fromEntries(lpResults));
      // Query ALL stake pools — RWA staking and LP mining across all 3 assets
      const stakeResults = {};
      await Promise.all(POOL_SYMBOLS.flatMap(sym => {
        const pool = POOLS[sym];
        return [
          // RWA staking pool
          Promise.all([
            contracts.liquidityVault.getStakeInfo(pool.rwaStakePoolId, account),
            contracts.liquidityVault.pendingRewards(pool.rwaStakePoolId, account),
          ]).then(([info, rewards]) => {
            stakeResults[`rwa-${sym}`] = {
              sym, mode: 'rwa',
              stakedAmount: ethers.formatEther(info.amount ?? info[0]),
              pendingRewards: ethers.formatEther(rewards),
              label: `${sym} Staked`,
              rewardSymbol: 'USDC',
            };
          }).catch(() => {}),
          // LP mining pool
          Promise.all([
            contracts.liquidityVault.getStakeInfo(pool.lpMiningPoolId, account),
            contracts.liquidityVault.pendingRewards(pool.lpMiningPoolId, account),
          ]).then(([info, rewards]) => {
            stakeResults[`lp-${sym}`] = {
              sym, mode: 'lp',
              stakedAmount: ethers.formatEther(info.amount ?? info[0]),
              pendingRewards: ethers.formatEther(rewards),
              label: `${sym}/USDC LP Staked`,
              rewardSymbol: sym,
            };
          }).catch(() => {}),
        ];
      }));
      setAllStakeInfo(stakeResults);
    } catch (err) { console.error('Dashboard load error:', err); }
    finally { setLoading(false); }
  };

  const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const portfolioValue = () => {
    const usdc = parseFloat(tokenBalances['USDC'] ?? 0);
    const rwaValue = POOL_SYMBOLS.reduce((sum, sym) =>
      sum + parseFloat(tokenBalances[sym] ?? 0) * parseFloat(poolPrices[sym] ?? 0), 0);
    return fmt(usdc + rwaValue);
  };
  const activeLPCount = POOL_SYMBOLS.filter(s => parseFloat(lpBalances[s] ?? 0) > 0).length;

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>Portfolio</h1>
          <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>
            {isConnected ? `${getDisplayName?.() ?? account?.slice(0, 12)} · Hedera Testnet` : 'Connect wallet to view portfolio'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[{ to: '/marketplace', label: '💱 Trade' }, { to: '/pools', label: '💧 Liquidity' }, { to: '/stake', label: '🔒 Stake' }, { to: '/faucet', label: '🚰 Faucet' }].map(({ to, label }) => (
            <Link key={to} to={to} style={{
              fontSize: '14px', color: '#94a3b8', textDecoration: 'none',
              padding: '5px 11px', borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(255,255,255,0.025)',
            }}>{label}</Link>
          ))}
        </div>
      </div>

      <NotificationBanner badge="all" />

      {!isConnected ? (
        <div style={{
          background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.18)',
          borderRadius: '10px', padding: '40px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '34px', marginBottom: '10px' }}>🔐</div>
          <p style={{ color: '#fbbf24', fontSize: '16px', marginBottom: '16px', margin: '0 0 16px' }}>Connect your wallet to view your portfolio</p>
          <button onClick={connect} className="btn-primary" style={{ fontSize: '15px', padding: '8px 20px' }}>Connect Wallet</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>

          {/* Stat row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <StatCard label="Portfolio Value" value={`$${portfolioValue()}`} sub="Estimated in USDC" accent loading={loading} />
            <StatCard label="USDC Balance" value={`$${fmt(tokenBalances['USDC'] ?? 0)}`} sub="Available" loading={loading} />
            <StatCard label="LP Positions" value={activeLPCount} sub={`of ${POOL_SYMBOLS.length} pools active`} loading={loading} />
            <StatCard label="Total Staked" value={fmt(totalStaked, 2)} sub={`${fmt(totalPendingRewards, 4)} rewards pending`} loading={loading} />
          </div>

          {/* Main grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
            <Panel title="Token Holdings" action={{ to: '/marketplace', label: 'Trade →' }}>
              {Object.entries(TOKENS).map(([sym, token]) => {
                const bal = tokenBalances[sym] ?? '0';
                const price = parseFloat(poolPrices[sym] ?? 0);
                const value = sym === 'USDC' ? parseFloat(bal) : parseFloat(bal) * price;
                return <TokenRow key={sym} sym={sym} bal={bal} value={value} price={price} description={token.description} loading={loading} />;
              })}
            </Panel>

            <Panel title="Liquidity Positions" action={{ to: '/pools', label: 'Manage →' }}>
              {POOL_SYMBOLS.map(sym => {
                const lpBal = lpBalances[sym] ?? '0';
                const lpTotal = parseFloat(lpTotalSupplies[sym] ?? 0);
                const share = lpTotal > 0 ? ((parseFloat(lpBal) / lpTotal) * 100).toFixed(4) : '0.0000';
                return <LPRow key={sym} sym={sym} lpBal={lpBal} share={share} loading={loading} />;
              })}
              <Link to="/pools" style={{
                display: 'block', textAlign: 'center', marginTop: '8px',
                padding: '7px', borderRadius: '7px', fontSize: '14px', fontWeight: 600,
                color: '#3B82F6', textDecoration: 'none',
                border: '1px dashed rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.04)',
              }}>+ Add Liquidity</Link>
            </Panel>
          </div>

          {/* Bottom row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
            <Panel title="Staking Positions" action={{ to: '/stake', label: 'Manage →' }}>
              {Object.values(allStakeInfo).filter(s => parseFloat(s.stakedAmount) > 0).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '13px' }}>
                  No active staking positions.{' '}
                  <Link to="/stake" style={{ color: '#3B82F6', textDecoration: 'none' }}>Start staking →</Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {Object.values(allStakeInfo)
                    .filter(s => parseFloat(s.stakedAmount) > 0)
                    .map(s => (
                      <div key={`${s.mode}-${s.sym}`} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: '8px',
                        background: s.mode === 'lp' ? 'rgba(16,185,129,0.04)' : 'rgba(59,130,246,0.04)',
                        border: s.mode === 'lp' ? '1px solid rgba(16,185,129,0.14)' : '1px solid rgba(59,130,246,0.14)',
                      }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{s.label}</div>
                          <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                            {fmt(s.stakedAmount, 4)} staked
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#10B981' }}>
                            {fmt(s.pendingRewards, 4)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#475569' }}>{s.rewardSymbol} pending</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </Panel>

            <Panel title="Market Prices" action={{ to: '/marketplace', label: 'Trade →' }}>
              {POOL_SYMBOLS.map(sym => (
                <div key={sym} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: '7px', marginBottom: '5px',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Sparkline />
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{sym}</div>
                      <div style={{ fontSize: '13px', color: '#475569' }}>vs USDC</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9' }}>${poolPrices[sym] ?? '—'}</div>
                </div>
              ))}
            </Panel>
          </div>

          {/* ── Hedera Mirror Node Activity ── */}
          <Panel
            title="On-Chain Activity"
            badge="HEDERA MIRROR NODE"
            action={null}
          >
            {/* Protocol stats from Mirror Node */}
            {protocolStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '14px' }}>
                {[
                  { label: 'Total Txs', value: protocolStats.totalTransactions },
                  { label: 'Successful', value: protocolStats.successfulTxs },
                  { label: 'Unique Users', value: protocolStats.uniqueUsers },
                  { label: 'Last Activity', value: fmtTs(protocolStats.lastActivity) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#e2e8f0' }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Transaction list */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: '#475569' }}>
                {lastFetched ? `Updated ${lastFetched.toLocaleTimeString()}` : 'Loading from Hedera Mirror Node...'}
              </span>
              <button onClick={mirrorRefresh} disabled={mirrorLoading} style={{
                fontSize: '12px', color: '#6366f1', background: 'rgba(99,102,241,0.08)',
                border: '1px solid rgba(99,102,241,0.2)', borderRadius: '5px',
                padding: '3px 10px', cursor: 'pointer',
              }}>
                {mirrorLoading ? 'Fetching...' : '↻ Refresh'}
              </button>
            </div>

            {mirrorLoading && ammTransactions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '14px' }}>
                <div className="animate-pulse">Fetching from Hedera Mirror Node...</div>
              </div>
            ) : ammTransactions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '14px' }}>
                No transactions found yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto' }}>
                {ammTransactions.map((tx, i) => (
                  <div key={tx.hash ?? i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: '7px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
                        background: tx.result === 'SUCCESS' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                        color: tx.result === 'SUCCESS' ? '#10B981' : '#f87171',
                        border: `1px solid ${tx.result === 'SUCCESS' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                      }}>{tx.result === 'SUCCESS' ? '✓' : '✗'}</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                          {decodeSelector(tx.functionCall)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#475569' }}>
                          {tx.from ? `${tx.from.slice(0, 8)}...${tx.from.slice(-6)}` : '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{fmtTs(tx.timestamp)}</div>
                      <a
                        href={`${NETWORK.explorerUrl}/transaction/${tx.hash}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: '#6366f1', textDecoration: 'none' }}>
                        HashScan →
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Mirror Node attribution */}
            <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.1)' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                📡 Data sourced directly from{' '}
                <a href="https://testnet.mirrornode.hedera.com" target="_blank" rel="noopener noreferrer" style={{ color: '#8B5CF6', textDecoration: 'none' }}>
                  Hedera Mirror Node
                </a>
                {' '}— not from Liquid's backend. Immutable, verifiable on-chain data.
              </div>
            </div>
          </Panel>

        </div>
      )}
    </div>
  );
}

export default Dashboard;
