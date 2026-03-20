import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContracts } from '../hooks/useContracts';
import { POOLS, POOL_SYMBOLS, CONTRACTS } from '../config/contracts';
import { useHCS } from '../hooks/useHCS';
import { NotificationBanner } from '../components/NotificationBanner';
import { KYCBanner } from '../components/KYCBanner';
import { useToast } from '../components/Toast';

function Pools() {
  const { isConnected, account, connect } = useWallet();
  const { contracts, approveToken, checkAllowance, getTokenBalance, executeContractCall, getERC20Contract } = useContracts();
  const { publishEvent } = useHCS();
  const toast = useToast();
  const [selectedSymbol, setSelectedSymbol] = useState(POOL_SYMBOLS[0]);
  const pool = POOLS[selectedSymbol];
  const [tab, setTab] = useState('add');
  const [assetAmount, setAssetAmount] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [lpToRemove, setLpToRemove] = useState('');
  const [loading, setLoading] = useState(false);
  const [poolData, setPoolData] = useState(null);
  const [userLPBalance, setUserLPBalance] = useState('0');
  const [lpTotalSupply, setLpTotalSupply] = useState('0');
  const [tokenBalances, setTokenBalances] = useState({ asset: '0', quote: '0' });
  const [needsApproval, setNeedsApproval] = useState({ asset: false, quote: false });
  const [approving, setApproving] = useState({ asset: false, quote: false });
  const [lpNeedsApproval, setLpNeedsApproval] = useState(false);
  const [lpApproving, setLpApproving] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [lastEdited, setLastEdited] = useState('asset'); // track which field user typed in
  const [searchParams] = useSearchParams();

  // Deep-link support — notifications pass ?symbol=RWAPROP to land on correct pool
  useEffect(() => {
    const symbol = searchParams.get('symbol');
    if (symbol && POOL_SYMBOLS.includes(symbol)) setSelectedSymbol(symbol);
  }, [searchParams]);

  // Auto-calculate paired amount based on current pool ratio
  useEffect(() => {
    if (!poolData || tab !== 'add') return;
    const assetRes = parseFloat(ethers.formatEther(poolData.assetReserve));
    const quoteRes = parseFloat(ethers.formatEther(poolData.quoteReserve));
    if (!assetRes || !quoteRes) return;
    const ratio = quoteRes / assetRes;
    if (lastEdited === 'asset' && assetAmount && parseFloat(assetAmount) > 0) {
      setQuoteAmount((parseFloat(assetAmount) * ratio).toFixed(6));
    } else if (lastEdited === 'quote' && quoteAmount && parseFloat(quoteAmount) > 0) {
      setAssetAmount((parseFloat(quoteAmount) / ratio).toFixed(6));
    }
  }, [assetAmount, quoteAmount, lastEdited, poolData, tab]);

  useEffect(() => {
    setPoolData(null); setUserLPBalance('0'); setTxHash(null);
    if (contracts?.adaptiveAMM) loadPoolData();
  }, [selectedSymbol, contracts]);

  useEffect(() => {
    if (isConnected && contracts?.adaptiveAMM) loadUserData();
  }, [isConnected, contracts, account, selectedSymbol]);

  useEffect(() => {
    if (tab === 'add' && assetAmount && quoteAmount) checkApprovals();
  }, [assetAmount, quoteAmount, tab, selectedSymbol]);

  useEffect(() => {
    if (tab === 'remove' && lpToRemove && isConnected) checkLPApproval();
    else setLpNeedsApproval(false);
  }, [lpToRemove, tab, selectedSymbol, isConnected]);

  // Calculate max balanced amounts user can add given their actual balances
  const handleMaxBalanced = () => {
    if (!poolData || !tokenBalances.asset || !tokenBalances.quote) return;
    const assetRes = parseFloat(ethers.formatEther(poolData.assetReserve));
    const quoteRes = parseFloat(ethers.formatEther(poolData.quoteReserve));
    if (!assetRes || !quoteRes) return;
    const ratio = quoteRes / assetRes; // USDC per RWAPROP

    const maxAsset = parseFloat(tokenBalances.asset);
    const maxQuote = parseFloat(tokenBalances.quote);

    // How much USDC is needed if we use all asset tokens?
    const quoteNeededForMaxAsset = maxAsset * ratio;
    // How much asset is needed if we use all quote tokens?
    const assetNeededForMaxQuote = maxQuote / ratio;

    if (quoteNeededForMaxAsset <= maxQuote) {
      // Asset is limiting factor — use all asset, calculate quote
      setLastEdited('asset');
      setAssetAmount(maxAsset.toFixed(6));
      setQuoteAmount(quoteNeededForMaxAsset.toFixed(6));
    } else {
      // Quote is limiting factor — use all quote, calculate asset
      setLastEdited('quote');
      setQuoteAmount(maxQuote.toFixed(6));
      setAssetAmount(assetNeededForMaxQuote.toFixed(6));
    }
  };

  const loadPoolData = async () => {
    try {
      const raw = await contracts.adaptiveAMM.getPool(pool.ammPoolId);
      const lpContract = getERC20Contract(pool.lpToken);
      const totalSupply = await lpContract.totalSupply();
      setLpTotalSupply(ethers.formatEther(totalSupply));
      setPoolData({ assetReserve: raw.assetReserve, quoteReserve: raw.quoteReserve, feeRate: raw.tradingFee, active: raw.isActive });
    } catch (err) { console.error(err); }
  };

  const loadUserData = async () => {
    if (!account) return;
    try {
      const lpContract = getERC20Contract(pool.lpToken);
      const [lpBal, assetBal, quoteBal] = await Promise.all([
        lpContract.balanceOf(account), getTokenBalance(pool.assetToken), getTokenBalance(pool.quoteToken),
      ]);
      setUserLPBalance(ethers.formatEther(lpBal));
      setTokenBalances({ asset: ethers.formatEther(assetBal), quote: ethers.formatEther(quoteBal) });
    } catch (err) { console.error(err); }
  };

  const checkApprovals = async () => {
    if (!isConnected) return;
    try {
      const [a, q] = await Promise.all([checkAllowance(pool.assetToken, CONTRACTS.ADAPTIVE_AMM), checkAllowance(pool.quoteToken, CONTRACTS.ADAPTIVE_AMM)]);
      setNeedsApproval({ asset: a < ethers.parseEther(assetAmount || '0'), quote: q < ethers.parseEther(quoteAmount || '0') });
    } catch (err) { console.error(err); }
  };

  const handleApprove = async (tokenType) => {
    if (!isConnected) { await connect(); return; }
    setApproving(prev => ({ ...prev, [tokenType]: true }));
    try {
      const addr = tokenType === 'asset' ? pool.assetToken : pool.quoteToken;
      await approveToken(addr, CONTRACTS.ADAPTIVE_AMM, ethers.parseEther(tokenType === 'asset' ? assetAmount : quoteAmount));
      setNeedsApproval(prev => ({ ...prev, [tokenType]: false }));
      toast.success('Approved', `${tokenType === 'asset' ? pool.assetSymbol : 'USDC'} approved`);
    } catch (err) { alert(`Approval failed: ${err.message}`); toast.error('Approval Failed', err.message); }
    finally { setApproving(prev => ({ ...prev, [tokenType]: false })); }
  };

  const handleAddLiquidity = async () => {
    if (!isConnected) { await connect(); return; }
    if (!assetAmount || !quoteAmount || parseFloat(assetAmount) <= 0) return;

    // Balance guards
    if (parseFloat(assetAmount) > parseFloat(tokenBalances.asset)) {
      toast.error('Insufficient Balance', `You only have ${parseFloat(tokenBalances.asset).toFixed(4)} ${pool.assetSymbol}`);
      return;
    }
    if (parseFloat(quoteAmount) > parseFloat(tokenBalances.quote)) {
      toast.error('Insufficient Balance', `You only have ${parseFloat(tokenBalances.quote).toFixed(4)} USDC`);
      return;
    }

    setLoading(true); setTxHash(null);
    try {
      const assetWei = ethers.parseEther(assetAmount);
      const quoteWei = ethers.parseEther(quoteAmount);

      // Step 1 — approve asset token if needed
      const assetAllowance = await checkAllowance(pool.assetToken, CONTRACTS.ADAPTIVE_AMM);
      if (assetAllowance < assetWei) {
        toast.info('Approval needed', `Approving ${pool.assetSymbol}... (1 of 2)`);
        await approveToken(pool.assetToken, CONTRACTS.ADAPTIVE_AMM, assetWei);
        setNeedsApproval(prev => ({ ...prev, asset: false }));
      }

      // Step 2 — approve USDC if needed
      const quoteAllowance = await checkAllowance(pool.quoteToken, CONTRACTS.ADAPTIVE_AMM);
      if (quoteAllowance < quoteWei) {
        toast.info('Approval needed', `Approving USDC... (2 of 2)`);
        await approveToken(pool.quoteToken, CONTRACTS.ADAPTIVE_AMM, quoteWei);
        setNeedsApproval(prev => ({ ...prev, quote: false }));
      }

      // Step 3 — add liquidity
      toast.info('Adding liquidity', 'Almost done...');
      const result = await executeContractCall('adaptiveAMM', 'addLiquidity', [pool.ammPoolId, assetWei, quoteWei]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId);
      setAssetAmount(''); setQuoteAmount('');
      toast.success('Liquidity Added!', `~${Math.sqrt(parseFloat(assetAmount) * parseFloat(quoteAmount)).toFixed(4)} LP tokens received`, txId);
      publishEvent('liquidity_added', { pool: `${selectedSymbol}/USDC`, assetAmount, quoteAmount, txId });
      setTimeout(() => { loadPoolData(); loadUserData(); }, 4000);
    } catch (err) {
      toast.error('Transaction Failed', err.message);
    } finally { setLoading(false); }
  };

  const checkLPApproval = async () => {
    if (!lpToRemove || !isConnected) { setLpNeedsApproval(false); return; }
    try {
      const allowance = await checkAllowance(pool.lpToken, CONTRACTS.ADAPTIVE_AMM);
      setLpNeedsApproval(allowance < ethers.parseEther(lpToRemove));
    } catch { setLpNeedsApproval(true); }
  };

  const handleApproveLPToken = async () => {
    if (!isConnected) { await connect(); return; }
    setLpApproving(true);
    try {
      await approveToken(pool.lpToken, CONTRACTS.ADAPTIVE_AMM, ethers.parseEther(lpToRemove));
      setLpNeedsApproval(false);
      toast.success('LP Token Approved', 'You can now remove liquidity');
    } catch (err) { alert(`Approval failed: ${err.message}`); toast.error('Approval Failed', err.message); }
    finally { setLpApproving(false); }
  };

  const handleRemoveLiquidity = async () => {
    if (!isConnected) { await connect(); return; }
    if (!lpToRemove || parseFloat(lpToRemove) <= 0) return;

    setLoading(true); setTxHash(null);
    try {
      const lpWei = ethers.parseEther(lpToRemove);

      // Step 1 — approve LP token if needed
      const lpAllowance = await checkAllowance(pool.lpToken, CONTRACTS.ADAPTIVE_AMM);
      if (lpAllowance < lpWei) {
        toast.info('Approval needed', 'Approving LP token...');
        await approveToken(pool.lpToken, CONTRACTS.ADAPTIVE_AMM, lpWei);
        setLpNeedsApproval(false);
      }

      // Step 2 — remove liquidity
      toast.info('Removing liquidity', 'Almost done...');
      const result = await executeContractCall('adaptiveAMM', 'removeLiquidity', [pool.ammPoolId, lpWei]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId);
      setLpToRemove('');
      toast.success('Liquidity Removed!', `${lpToRemove} LP tokens burned`, txId);
      publishEvent('liquidity_removed', { pool: `${selectedSymbol}/USDC`, lpTokens: lpToRemove, txId });
      setTimeout(() => { loadPoolData(); loadUserData(); }, 4000);
    } catch (err) {
      toast.error('Transaction Failed', err.message);
    } finally { setLoading(false); }
  };

  const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const poolShare = () => {
    const total = parseFloat(lpTotalSupply), user = parseFloat(userLPBalance);
    if (!total || !user) return '0.0000';
    return ((user / total) * 100).toFixed(4);
  };
  const positionValue = () => {
    if (!poolData) return '0.00';
    const total = parseFloat(lpTotalSupply), user = parseFloat(userLPBalance);
    if (!total || !user) return '0.00';
    const share = user / total;
    const rA = parseFloat(ethers.formatEther(poolData.assetReserve));
    const rB = parseFloat(ethers.formatEther(poolData.quoteReserve));
    return (share * (rA * (rB / rA) + rB)).toFixed(2);
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontSize: '20px', fontWeight: 700, color: '#f1f5f9', width: '60%', padding: 0 };
  const panelStyle = { background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px' };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }} className="animate-fadeIn">
      <KYCBanner />
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>Liquidity Pools</h1>
        <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>Add liquidity to earn 0.3% trading fees. Receive LP tokens you can stake for bonus rewards.</p>
      </div>

  <NotificationBanner badge="pools" />
  
      {/* Pool selector */}
      <div className="flex gap-2 flex-wrap" style={{ marginBottom: '14px' }}>
        {POOL_SYMBOLS.map(sym => (
          <button key={sym} onClick={() => setSelectedSymbol(sym)}
            className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition-all ${selectedSymbol === sym ? 'bg-primary text-white' : 'bg-dark-tertiary text-muted hover:text-white'}`}>
            {sym}/USDC
          </button>
        ))}
      </div>


      {!isConnected && (
        <div style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ color: '#fbbf24', fontSize: '14px', margin: 0 }}>⚠️ Connect your wallet to manage liquidity</p>
          <button onClick={connect} className="btn-primary" style={{ fontSize: '14px', padding: '5px 14px' }}>Connect</button>
        </div>
      )}

      {/* Pool stats */}
      {poolData ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '14px' }}>
          {[
            { label: 'LP Supply', value: fmt(lpTotalSupply) },
            { label: `${pool.assetSymbol} Reserve`, value: fmt(ethers.formatEther(poolData.assetReserve)) },
            { label: 'USDC Reserve', value: fmt(ethers.formatEther(poolData.quoteReserve)) },
            { label: 'Fee', value: `${Number(poolData.feeRate) / 100}%` },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'rgba(30,41,59,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...panelStyle, textAlign: 'center', padding: '20px', marginBottom: '14px' }}>
          <p className="text-muted text-sm animate-pulse">Loading pool data...</p>
        </div>
      )}

      {/* User position */}
      {isConnected && parseFloat(userLPBalance) > 0 && (
        <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', padding: '12px 16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px', fontWeight: 600 }}>Your Position — {pool.assetSymbol}/USDC</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
            {[
              { label: 'LP Tokens', value: fmt(userLPBalance, 4), color: '#f1f5f9' },
              { label: 'Pool Share', value: `${poolShare()}%`, color: '#3B82F6' },
              { label: 'Est. Value', value: `$${positionValue()}`, color: '#10B981' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: '13px', color: '#475569', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Main panel */}
        <div style={{ gridColumn: 'span 2', ...panelStyle }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0' }}>
            {['add', 'remove'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                paddingBottom: '10px', paddingLeft: '2px', paddingRight: '2px', fontWeight: 600, fontSize: '15px',
                background: 'none', border: 'none', cursor: 'pointer', transition: 'color 0.15s',
                color: tab === t ? '#3B82F6' : '#64748b',
                borderBottom: tab === t ? '2px solid #3B82F6' : '2px solid transparent',
              }}>{t === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}</button>
            ))}
          </div>

          {tab === 'add' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { label: `${pool.assetSymbol} Amount`, key: 'asset', amount: assetAmount, setAmount: v => { setLastEdited('asset'); setAssetAmount(v); }, symbol: pool.assetSymbol, balance: tokenBalances.asset, approval: 'asset' },
                { label: 'USDC Amount', key: 'quote', amount: quoteAmount, setAmount: v => { setLastEdited('quote'); setQuoteAmount(v); }, symbol: 'USDC', balance: tokenBalances.quote, approval: 'quote' },
              ].map(({ label, key, amount, setAmount, symbol, balance, approval }) => (
                <div key={key}>
                  <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '5px' }}>{label}</label>
                  <div style={{ background: 'rgba(51,65,85,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
                    <span style={{ background: 'rgba(71,85,105,0.6)', padding: '3px 9px', borderRadius: '5px', fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{symbol}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '3px' }}>
                    <span style={{ color: '#475569' }}>Balance: {fmt(balance, 4)}</span>
                    <button onClick={handleMaxBalanced} style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>MAX</button>
                  </div>
                  {needsApproval[approval] && amount && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#f59e0b', padding: '4px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: '5px', border: '1px solid rgba(245,158,11,0.2)' }}>
                      ⚠️ {symbol} approval required — will be handled automatically on Add Liquidity
                    </div>
                  )}
                </div>
              ))}
              <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '7px', padding: '10px 12px', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>You will receive</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 500 }}>
                    ~{assetAmount && quoteAmount ? fmt(Math.sqrt(parseFloat(assetAmount) * parseFloat(quoteAmount)), 4) : '0'} LP
                  </span>
                </div>
              </div>
              <button onClick={handleAddLiquidity} disabled={loading || !assetAmount || !quoteAmount}
                className="w-full btn-primary disabled:opacity-50" style={{ padding: '10px', fontSize: '15px' }}>
                {loading ? 'Processing...' : 'Add Liquidity'}
              </button>
            </div>
          )}

          {tab === 'remove' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '5px' }}>LP Tokens to Remove</label>
                <div style={{ background: 'rgba(51,65,85,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <input type="number" value={lpToRemove} onChange={e => setLpToRemove(e.target.value)} placeholder="0.00" style={inputStyle} />
                  <span style={{ background: 'rgba(71,85,105,0.6)', padding: '3px 9px', borderRadius: '5px', fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>LP</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '3px' }}>
                  <span style={{ color: '#475569' }}>Your LP: {fmt(userLPBalance, 4)}</span>
                  <button onClick={() => setLpToRemove(userLPBalance)} style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>MAX</button>
                </div>
              </div>
              {poolData && lpToRemove && parseFloat(lpTotalSupply) > 0 && (
                <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '7px', padding: '10px 12px', fontSize: '14px' }}>
                  <div style={{ color: '#64748b', marginBottom: '6px' }}>You will receive approximately:</div>
                  {[
                    { label: pool.assetSymbol, value: fmt((parseFloat(lpToRemove) / parseFloat(lpTotalSupply)) * parseFloat(ethers.formatEther(poolData.assetReserve)), 4) },
                    { label: 'USDC', value: fmt((parseFloat(lpToRemove) / parseFloat(lpTotalSupply)) * parseFloat(ethers.formatEther(poolData.quoteReserve)), 4) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ color: '#64748b' }}>{label}</span>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={handleRemoveLiquidity} disabled={loading || !lpToRemove || parseFloat(lpToRemove) <= 0}
                className="w-full btn-primary disabled:opacity-50" style={{ padding: '10px', fontSize: '15px' }}>
                {loading ? 'Processing...' : 'Remove Liquidity'}
              </button>
            </div>
          )}

          {txHash && (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '7px', padding: '10px 12px', marginTop: '12px' }}>
              <p style={{ color: '#10B981', fontSize: '14px', margin: '0 0 2px' }}>✅ Transaction submitted!</p>
              <a href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(txHash)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', fontSize: '13px' }}>View on HashScan →</a>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={panelStyle}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>How It Works</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '14px', color: '#64748b' }}>
              {['Add both tokens → get LP tokens', 'LP tokens earn 0.3% of all trades', 'Stake LP tokens for bonus rewards', 'Remove anytime to get tokens back'].map((step, i) => (
                <div key={i}><span style={{ color: '#3B82F6', fontWeight: 700, marginRight: '6px' }}>{i + 1}.</span>{step}</div>
              ))}
            </div>
          </div>
          <div style={panelStyle}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>Pool Info</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
              {[
                { label: 'Pair', value: `${pool.assetSymbol}/USDC` },
                { label: 'Fee', value: '0.3%', green: true },
                { label: 'Your Share', value: `${poolShare()}%` },
              ].map(({ label, value, green }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#475569' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: green ? '#10B981' : '#e2e8f0' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default Pools;
