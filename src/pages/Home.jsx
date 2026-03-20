import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useContracts } from '../hooks/useContracts';
import { POOLS, POOL_SYMBOLS } from '../config/contracts';

function Home() {
  const { contracts } = useContracts();
  const [marketStats, setMarketStats] = useState({ tvl: '—', pools: '—', topPrice: '—', topSymbol: '' });

  useEffect(() => {
    if (!contracts?.adaptiveAMM) return;
    const load = async () => {
      try {
        const poolCount = await contracts.adaptiveAMM.getPoolCount();
        const poolData = await Promise.all(
          POOL_SYMBOLS.map(sym => contracts.adaptiveAMM.getPool(POOLS[sym].ammPoolId).catch(() => null))
        );
        let tvl = 0, topPrice = 0, topSymbol = '';
        poolData.forEach((p, i) => {
          if (!p) return;
          const qr = parseFloat(ethers.formatEther(p.quoteReserve));
          const ar = parseFloat(ethers.formatEther(p.assetReserve));
          const appr = parseFloat(ethers.formatEther(p.appraisalValue));
          tvl += qr + ar * appr;
          const price = ar > 0 ? qr / ar : 0;
          if (price > topPrice) { topPrice = price; topSymbol = POOL_SYMBOLS[i]; }
        });
        setMarketStats({
          tvl: tvl > 0 ? `$${tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—',
          pools: poolCount.toString(),
          topPrice: topPrice > 0 ? `$${topPrice.toFixed(2)}` : '—',
          topSymbol,
        });
      } catch (err) { console.error(err); }
    };
    load();
  }, [contracts]);

  const stats = [
    { label: 'Total Value Locked', value: marketStats.tvl, sub: 'Across all pools' },
    { label: 'Active Pools', value: marketStats.pools, sub: 'Live on Hedera Testnet' },
    { label: 'RWA Asset Classes', value: '3', sub: 'Property · Equity · Bond' },
    { label: 'Top Asset Price', value: marketStats.topPrice, sub: marketStats.topSymbol || 'USDC' },
  ];

  const features = [
    { icon: '💧', title: 'Adaptive AMM', description: 'Smart bonding curves that adapt to illiquid RWA assets, preventing wild price swings.' },
    { icon: '🛡️', title: 'Compliance Built-In', description: 'KYC/AML whitelist system ensures regulatory compliance for tokenized securities.' },
    { icon: '💰', title: 'Earn Rewards', description: 'Stake RWA tokens to earn USDC yield. Provide liquidity to earn bonus RWA rewards.' },
    { icon: '🔒', title: 'Secure Treasury', description: 'Multi-sig treasury with timelock for enterprise-grade asset management.' },
  ];

  return (
    <div className="space-y-14 animate-fadeIn">
      {/* Hero */}
      <section className="text-center space-y-5 py-12">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '20px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', marginBottom: '4px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
          <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 600 }}>Live on Hedera Testnet</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight">Liquid Protocol</h1>
        <div className="max-w-3xl mx-auto space-y-2">
          <h2 className="text-lg md:text-xl text-primary font-semibold leading-relaxed">
            Secondary Market for Boutique RWA Tokenization
          </h2>
          <p className="text-sm text-muted leading-relaxed max-w-2xl mx-auto">
            Bringing liquidity to small-cap real-world assets on Hedera. Trade tokenized properties,
            equity funds, and corporate bonds with adaptive pricing.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Link to="/marketplace" className="btn-primary px-6 py-2.5 text-sm shadow-lg">Explore Markets</Link>
          <Link to="/pools" className="btn-secondary px-6 py-2.5 text-sm">Add Liquidity</Link>
        </div>
      </section>

      {/* Stats */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-center text-white uppercase tracking-wide" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Platform Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <div key={i} className="card animate-fadeIn" style={{ animationDelay: `${i * 80}ms`, padding: '14px 16px' }}>
              <div className="text-xs text-muted font-medium uppercase tracking-wide mb-1">{s.label}</div>
              <div className="text-xl font-bold text-white mb-0.5">{s.value}</div>
              <div className="text-xs text-muted">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-center uppercase tracking-wide" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Why Choose Liquid?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((f, i) => (
            <div key={i} className="card-elevated animate-fadeIn" style={{ animationDelay: `${i * 100}ms`, padding: '16px 20px' }}>
              <div className="flex items-start space-x-3">
                <div className="text-2xl mt-0.5">{f.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1 text-white">{f.title}</h3>
                  <p className="text-muted text-xs leading-relaxed">{f.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        background: 'linear-gradient(135deg, rgba(30,41,59,0.8) 0%, rgba(15,23,42,0.9) 100%)',
        border: '1px solid rgba(59,130,246,0.2)', borderRadius: '12px', padding: '32px',
        textAlign: 'center',
      }}>
        <h2 className="text-xl font-bold mb-2 text-white">Ready to get started?</h2>
        <p className="text-muted mb-6 max-w-xl mx-auto text-sm leading-relaxed">
          Connect your wallet and claim testnet tokens from the faucet to start trading
          tokenized RWA assets on Hedera.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/faucet" className="btn-secondary text-sm px-6 py-2.5">Get Test Tokens</Link>
          <Link to="/marketplace" className="btn-primary text-sm px-6 py-2.5">Start Trading</Link>
        </div>
      </section>
    </div>
  );
}

export default Home;
