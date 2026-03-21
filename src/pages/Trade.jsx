import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContracts } from '../hooks/useContracts';
import { POOLS, POOL_SYMBOLS, CONTRACTS } from '../config/contracts';
import { useHCS } from '../hooks/useHCS';
import { useToast } from '../components/Toast';
import { KYCBanner } from '../components/KYCBanner';
import { NotificationBanner } from '../components/NotificationBanner';

function Trade() {
  const { poolId: poolIdParam } = useParams();
  const initialSymbol = POOL_SYMBOLS.find(s => POOLS[s].ammPoolId === poolIdParam) ?? POOL_SYMBOLS[0];
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
  const pool = POOLS[selectedSymbol];
  const { isConnected, account, connect } = useWallet();
  const { contracts, approveToken, checkAllowance, getTokenBalance, executeContractCall } = useContracts();
  const { publishEvent } = useHCS();
  const toast = useToast();
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('0');
  const [buyMode, setBuyMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [poolData, setPoolData] = useState(null);
  const [tokenBalances, setTokenBalances] = useState({ asset: '0', quote: '0' });
  const [slippage, setSlippage] = useState(0.5);
  const [txHash, setTxHash] = useState(null);
  const [txSuccess, setTxSuccess] = useState(null);

  useEffect(() => {
    setPoolData(null); setAmountIn(''); setAmountOut('0'); setTxHash(null); setTxSuccess(null);
    if (contracts?.adaptiveAMM) loadPoolData();
  }, [selectedSymbol, contracts]);

  useEffect(() => { if (isConnected && poolData) loadBalances(); }, [isConnected, poolData, account, selectedSymbol]);
  useEffect(() => {
    if (amountIn && parseFloat(amountIn) > 0 && poolData) calculateOutput();
    else setAmountOut('0');
  }, [amountIn, buyMode, poolData]);

  const loadPoolData = async () => {
    try {
      const raw = await contracts.adaptiveAMM.getPool(pool.ammPoolId);
      setPoolData({ assetReserve: raw.assetReserve, quoteReserve: raw.quoteReserve, feeRate: raw.tradingFee, active: raw.isActive });
    } catch (err) { console.error(err); }
  };

  const loadBalances = async () => {
    try {
      const [a, q] = await Promise.all([getTokenBalance(pool.assetToken), getTokenBalance(pool.quoteToken)]);
      setTokenBalances({ asset: ethers.formatEther(a), quote: ethers.formatEther(q) });
    } catch (err) { console.error(err); }
  };

  const calculateOutput = () => {
    if (!poolData) return;
    try {
      const amtIn = ethers.parseEther(amountIn);
      const reserveIn = buyMode ? poolData.quoteReserve : poolData.assetReserve;
      const reserveOut = buyMode ? poolData.assetReserve : poolData.quoteReserve;
      const feePercent = Number(poolData.feeRate) / 10000;
      const amtInAfterFee = amtIn * BigInt(Math.floor((1 - feePercent) * 10000)) / 10000n;
      const out = (amtInAfterFee * reserveOut) / (reserveIn + amtInAfterFee);
      setAmountOut(ethers.formatEther(out));
    } catch { setAmountOut('0'); }
  };

  const handleSwap = async () => {
    if (!isConnected) { await connect(); return; }
    if (!amountIn || parseFloat(amountIn) <= 0) return;

    setLoading(true); setTxHash(null); setTxSuccess(null);
    try {
      const tokenIn = buyMode ? pool.quoteToken : pool.assetToken;
      const amtInWei = ethers.parseEther(amountIn);
      const tokenSymbol = buyMode ? 'USDC' : pool.assetSymbol;

      // Auto-approve if needed
      const allowance = await checkAllowance(tokenIn, CONTRACTS.ADAPTIVE_AMM);
      if (allowance < amtInWei) {
        toast.info('Approval needed', `Approving ${tokenSymbol}...`);
        await approveToken(tokenIn, CONTRACTS.ADAPTIVE_AMM, amtInWei);
      }

      // Execute swap
      const minOut = ethers.parseEther((parseFloat(amountOut) * (1 - slippage / 100)).toFixed(18));
      const result = await executeContractCall('adaptiveAMM', 'swap', [pool.ammPoolId, tokenIn, amtInWei, minOut]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId);
      setTxSuccess({ type: 'swap', amountIn, amountOut, symbol: buyMode ? pool.assetSymbol : 'USDC' });
      toast.success('Swap Successful', `${amountIn} → ~${parseFloat(amountOut).toFixed(6)} ${buyMode ? pool.assetSymbol : 'USDC'}`, txId);
      setAmountIn(''); setAmountOut('0');
      publishEvent('swap', {
        pool: `${pool.assetSymbol}/USDC`,
        direction: buyMode ? 'buy' : 'sell',
        amountIn,
        amountOut: parseFloat(amountOut).toFixed(6),
        token: buyMode ? pool.assetSymbol : 'USDC',
        txId,
      });
      setTimeout(() => { loadPoolData(); loadBalances(); }, 4000);
    } catch (err) {
      const msg = err.message?.includes('Slippage') ? 'Slippage exceeded — try increasing tolerance.' : err.message;
      setTxSuccess({ type: 'error', message: msg });
      toast.error('Swap Failed', msg);
    } finally { setLoading(false); }
  };

  const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const price = poolData ? (Number(ethers.formatEther(poolData.quoteReserve)) / Number(ethers.formatEther(poolData.assetReserve))).toFixed(4) : '—';

  const inputStyle = {
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: '22px', fontWeight: 700, color: '#f1f5f9', width: '60%', padding: 0,
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }} className="animate-fadeIn">
      <KYCBanner />
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>Trade RWA Tokens</h1>
        <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>Swap with instant settlement and adaptive pricing on Hedera.</p>
      </div>

      <NotificationBanner badge="stake" />

      {/* Pool selector */}
      <div className="flex gap-2 flex-wrap" style={{ marginBottom: '16px' }}>
        {POOL_SYMBOLS.map(sym => (
          <button key={sym} onClick={() => setSelectedSymbol(sym)}
            className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition-all ${selectedSymbol === sym ? 'bg-primary text-white' : 'bg-dark-tertiary text-muted hover:text-white'}`}>
            {sym}/USDC
          </button>
        ))}
      </div>

      {!poolData ? (
        <div style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p className="text-muted text-sm animate-pulse">Loading pool...</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          {/* Swap card */}
          <div style={{ gridColumn: 'span 2', background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Swap</h2>
              <button onClick={() => { setBuyMode(!buyMode); setAmountIn(''); setAmountOut('0'); }}
                style={{ fontSize: '14px', color: '#94a3b8', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
                {buyMode ? `⇄ Switch to Sell` : `⇄ Switch to Buy`}
              </button>
            </div>

            {!isConnected && (
              <div style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
                <p style={{ color: '#fbbf24', fontSize: '14px', margin: 0 }}>⚠️ Connect your wallet to trade</p>
              </div>
            )}

            {/* You Pay */}
            <div style={{ marginBottom: '4px' }}>
              <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>You Pay</label>
              <div style={{ background: 'rgba(51,65,85,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <input type="number" value={amountIn} onChange={e => setAmountIn(e.target.value)} placeholder="0.00" style={inputStyle} />
                <span style={{ background: 'rgba(71,85,105,0.6)', padding: '4px 10px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                  {buyMode ? 'USDC' : pool.assetSymbol}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                <span style={{ color: '#475569' }}>Balance: {fmt(buyMode ? tokenBalances.quote : tokenBalances.asset, 4)}</span>
                <button onClick={() => setAmountIn(buyMode ? tokenBalances.quote : tokenBalances.asset)} style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>MAX</button>
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
              <button onClick={() => { setBuyMode(!buyMode); setAmountIn(''); setAmountOut('0'); }}
                style={{ background: 'rgba(71,85,105,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="12" height="12" fill="none" stroke="#94a3b8" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>

            {/* You Receive */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>You Receive</label>
              <div style={{ background: 'rgba(51,65,85,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <input type="text" value={parseFloat(amountOut).toFixed(6)} readOnly style={{ ...inputStyle, color: '#10B981' }} />
                <span style={{ background: 'rgba(71,85,105,0.6)', padding: '4px 10px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                  {buyMode ? pool.assetSymbol : 'USDC'}
                </span>
              </div>
            </div>

            {/* Details */}
            <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Price</span>
                <span style={{ color: '#e2e8f0', fontWeight: 500 }}>1 {pool.assetSymbol} = {price} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Fee (0.3%)</span>
                <span style={{ color: '#e2e8f0' }}>{amountIn ? (parseFloat(amountIn) * 0.003).toFixed(6) : '0'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                <span style={{ color: '#64748b' }}>Slippage</span>
                <select value={slippage} onChange={e => setSlippage(parseFloat(e.target.value))}
                  style={{ background: '#334155', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '2px 6px', color: '#e2e8f0', fontSize: '14px' }}>
                  <option value={0.1}>0.1%</option><option value={0.5}>0.5%</option>
                  <option value={1}>1%</option><option value={2}>2%</option>
                </select>
              </div>
            </div>

            {/* Action button */}
            {!isConnected ? (
              <button onClick={connect} className="w-full btn-primary" style={{ padding: '10px', fontSize: '16px' }}>Connect Wallet</button>
            ) : (
              <button onClick={handleSwap} disabled={loading || !amountIn || parseFloat(amountIn) <= 0} className="w-full btn-primary disabled:opacity-50" style={{ padding: '10px', fontSize: '15px' }}>
                {loading ? 'Processing...' : `Swap ${buyMode ? `USDC → ${pool.assetSymbol}` : `${pool.assetSymbol} → USDC`}`}
              </button>
            )}

            {txSuccess?.type === 'swap' && txHash && (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '10px 12px', marginTop: '10px' }}>
                <p style={{ color: '#10B981', fontSize: '14px', margin: '0 0 3px' }}>✅ Swapped {txSuccess.amountIn} → ~{parseFloat(txSuccess.amountOut).toFixed(6)} {txSuccess.symbol}</p>
                <a href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(txHash)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', fontSize: '13px' }}>View on HashScan →</a>
              </div>
            )}
            {txSuccess?.type === 'error' && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '10px 12px', marginTop: '10px' }}>
                <p style={{ color: '#f87171', fontSize: '14px', margin: 0 }}>❌ {txSuccess.message}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px' }}>Pool Stats</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
                <div>
                  <div style={{ color: '#475569', marginBottom: '2px' }}>Price</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9' }}>${price}</div>
                </div>
                {[
                  { label: `${pool.assetSymbol} Reserve`, value: fmt(ethers.formatEther(poolData.assetReserve)) },
                  { label: 'USDC Reserve', value: fmt(ethers.formatEther(poolData.quoteReserve)) },
                  { label: 'Fee', value: '0.3%', green: true },
                ].map(({ label, value, green }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#475569' }}>{label}</span>
                    <span style={{ fontWeight: 600, color: green ? '#10B981' : '#e2e8f0' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px' }}>Your Balances</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
                {[
                  { label: pool.assetSymbol, value: fmt(tokenBalances.asset, 4) },
                  { label: 'USDC', value: fmt(tokenBalances.quote, 4) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#475569' }}>{label}</span>
                    <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default Trade;