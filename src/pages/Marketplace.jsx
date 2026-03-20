import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useContracts } from '../hooks/useContracts';
import { NotificationBanner } from '../components/NotificationBanner';

function Marketplace() {
  const { contracts, getERC20Contract } = useContracts();
  const [filter, setFilter] = useState('all');
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marketStats, setMarketStats] = useState({ totalLiquidity: '0', activePools: 0, avgFee: '0' });

  useEffect(() => {
    if (contracts?.adaptiveAMM) loadPools();
  }, [contracts]);

  const loadPools = async () => {
    setLoading(true);
    try {
      const count = Number(await contracts.adaptiveAMM.getPoolCount());
      if (count === 0) { setPools([]); setLoading(false); return; }
      const poolIds = await Promise.all(Array.from({ length: count }, (_, i) => contracts.adaptiveAMM.getPoolId(i)));
      const poolDataResults = await Promise.all(poolIds.map(id => contracts.adaptiveAMM.getPool(id)));
      const enriched = await Promise.all(poolIds.map(async (poolId, i) => {
        const pool = poolDataResults[i];
        let assetSymbol = 'ASSET', assetName = 'RWA Asset';
        try {
          const c = getERC20Contract(pool.assetToken);
          [assetSymbol, assetName] = await Promise.all([c.symbol(), c.name()]);
        } catch (_) {}
        let lpSupply = '0';
        try {
          const lpSupplyRaw = await contracts.adaptiveAMM.getLPTotalSupply(poolId);
          lpSupply = ethers.formatEther(lpSupplyRaw);
        } catch (_) {}
        const assetReserve = parseFloat(ethers.formatEther(pool.assetReserve));
        const quoteReserve = parseFloat(ethers.formatEther(pool.quoteReserve));
        const price = assetReserve > 0 ? quoteReserve / assetReserve : 0;
        const appraisalValue = parseFloat(ethers.formatEther(pool.appraisalValue));
        const tvl = quoteReserve + (assetReserve * appraisalValue);
        const feePercent = Number(pool.tradingFee) / 100;
        return {
          poolId, assetSymbol, assetName,
          name: `${assetSymbol}/USDC`,
          price: price.toFixed(4),
          assetReserve: assetReserve.toFixed(2),
          quoteReserve: quoteReserve.toFixed(2),
          tvl: tvl.toFixed(2),
          lpSupply,
          fee: feePercent.toFixed(2),
          isActive: pool.isActive,
        };
      }));
      const active = enriched.filter(p => p.isActive);
      const totalLiquidity = active.reduce((s, p) => s + parseFloat(p.tvl), 0);
      const avgFee = active.length > 0 ? (active.reduce((s, p) => s + parseFloat(p.fee), 0) / active.length).toFixed(2) : '0';
      setPools(enriched);
      setMarketStats({ totalLiquidity: totalLiquidity.toFixed(2), activePools: active.length, avgFee });
    } catch (err) {
      console.error('Error loading pools:', err);
    } finally { setLoading(false); }
  };

  const fmt = n => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const filtered = filter === 'all' ? pools : pools.filter(p => filter === 'active' ? p.isActive : !p.isActive);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>RWA Marketplace</h1>
          <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>
            Browse and trade tokenized real-world assets. Compliance-ready with built-in KYC/AML on Hedera.
          </p>
        </div>
        <Link to="/faucet" style={{
          fontSize: '14px', color: '#94a3b8', textDecoration: 'none',
          padding: '5px 11px', borderRadius: '6px',
          border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)',
        }}>🚰 Get Test Tokens</Link>
      </div>

    

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        {[
          { label: 'Total Liquidity', value: loading ? '—' : `$${fmt(marketStats.totalLiquidity)}`, sub: 'Across all pools' },
          { label: 'Active Pools', value: loading ? '—' : marketStats.activePools, sub: 'Live on Hedera Testnet' },
          { label: 'Avg Fee', value: loading ? '—' : `${marketStats.avgFee}%`, sub: 'Per trade', accent: true },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} style={{
            background: 'linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.95))',
            border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 16px',
          }}>
            <div style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: accent ? '#3B82F6' : '#f1f5f9' }}>{value}</div>
            <div style={{ fontSize: '13px', color: '#475569', marginTop: '3px' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {['all', 'active', 'inactive'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition-all ${filter === f ? 'bg-primary text-white' : 'bg-dark-tertiary text-muted hover:text-white'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
          <p className="text-muted text-sm animate-pulse">Loading pools from chain...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10"><p className="text-muted text-sm">No pools found.</p></div>
      ) : (
        <div style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(15,23,42,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Asset', 'Price', 'Asset Reserve', 'USDC Reserve', 'TVL', 'Fee', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((pool) => (
                  <tr key={pool.poolId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    className="group">
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{pool.assetSymbol}</div>
                      <div style={{ fontSize: '13px', color: '#475569' }}>{pool.assetName}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>${pool.price}</div>
                      <div style={{ fontSize: '13px', color: '#475569' }}>USDC/{pool.assetSymbol}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '15px', color: '#e2e8f0', fontWeight: 500 }}>{fmt(pool.assetReserve)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '15px', color: '#e2e8f0', fontWeight: 500 }}>{fmt(pool.quoteReserve)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '15px', color: '#e2e8f0', fontWeight: 500 }}>${fmt(pool.tvl)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '15px', color: '#10B981', fontWeight: 600 }}>{pool.fee}%</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '20px', fontSize: '13px', fontWeight: 600,
                        background: pool.isActive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                        color: pool.isActive ? '#10B981' : '#ef4444',
                        border: `1px solid ${pool.isActive ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                        {pool.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Link to={`/trade/${pool.poolId}`} style={{
                        fontSize: '14px', fontWeight: 600, color: '#3B82F6', textDecoration: 'none',
                        padding: '4px 12px', borderRadius: '6px',
                        border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.08)',
                      }}>Trade</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Marketplace;
