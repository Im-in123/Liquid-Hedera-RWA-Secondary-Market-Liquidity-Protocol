import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContracts } from '../hooks/useContracts';
import { POOLS, POOL_SYMBOLS, CONTRACTS } from '../config/contracts';
import { useHCS } from '../hooks/useHCS';
import { useNotifications } from '../context/NotificationContext';
import { useToast } from '../components/Toast';
import { KYCBanner } from '../components/KYCBanner';
import { NotificationBanner } from '../components/NotificationBanner';

const STAKE_MODES = ['rwa', 'lp'];

function Stake() {
  const { isConnected, account, connect } = useWallet();
  const { contracts, approveToken, checkAllowance, getTokenBalance, executeContractCall } = useContracts();
  const { publishEvent } = useHCS();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [selectedSymbol, setSelectedSymbol] = useState(POOL_SYMBOLS[0]);
  const [stakeMode, setStakeMode] = useState('rwa');
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'stake');
  // Deep-link support — notifications pass ?mode=lp&symbol=RWAPROP to land on correct tab
  useEffect(() => {
    const mode = searchParams.get('mode');
    const symbol = searchParams.get('symbol');
    if (mode && STAKE_MODES.includes(mode)) setStakeMode(mode);
    if (symbol && POOL_SYMBOLS.includes(symbol)) setSelectedSymbol(symbol);
  }, [searchParams]);
  const pool = POOLS[selectedSymbol];
  const stakingConfig = stakeMode === 'rwa'
    ? { poolId: pool.rwaStakePoolId, stakedToken: pool.assetToken, stakedSymbol: pool.assetSymbol, rewardSymbol: 'USDC', label: `Stake ${pool.assetSymbol} → Earn USDC` }
    : { poolId: pool.lpMiningPoolId, stakedToken: pool.lpToken, stakedSymbol: `${pool.assetSymbol}/USDC LP`, rewardSymbol: pool.assetSymbol, label: `Stake LP → Earn ${pool.assetSymbol}` };

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [poolInfo, setPoolInfo] = useState(null);
  const [userStakeData, setUserStakeData] = useState(null);
  const [tokenBalance, setTokenBalance] = useState('0');
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approving, setApproving] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [allRewards, setAllRewards] = useState([]);
  const [totalStakedAll, setTotalStakedAll] = useState('0');
  const [claimingPool, setClaimingPool] = useState(null); // poolId currently being claimed

  useEffect(() => {
    setPoolInfo(null); setUserStakeData(null); setStakeAmount(''); setUnstakeAmount(''); setTxHash(null);
    if (contracts?.liquidityVault) loadPoolInfo();
  }, [selectedSymbol, stakeMode, contracts]);

  useEffect(() => {
    if (isConnected && contracts?.liquidityVault && account) { loadUserData(); loadTokenBalance(); }
    else { setUserStakeData(null); setTokenBalance('0'); }
  }, [isConnected, contracts, account, selectedSymbol, stakeMode]);

  useEffect(() => { if (tab === 'stake' && stakeAmount) checkStakeApproval(); }, [stakeAmount, tab, stakingConfig.poolId]);
  // Load all rewards on mount and account change — needed for badge count on page load
  // Also reload when rewards tab is opened to get fresh data
  useEffect(() => { if (isConnected && contracts?.liquidityVault) loadAllRewards(); }, [isConnected, account, contracts]);

  const loadPoolInfo = async () => {
    try {
      const info = await contracts.liquidityVault.getPoolInfo(stakingConfig.poolId);
      const rewardRate = info.rewardRatePerSecond, totalStaked = info.totalStakedAmount;
      let apy = null;
      if (rewardRate > 0n && totalStaked > 0n) {
        apy = (Number(ethers.formatEther(rewardRate * 31536000n)) / Number(ethers.formatEther(totalStaked))) * 100;
      }
      setPoolInfo({ apy: apy !== null ? apy.toFixed(2) : null, totalStaked: ethers.formatEther(totalStaked), rewardRate: ethers.formatEther(rewardRate) });
    } catch { setPoolInfo({ apy: '0', totalStaked: '0', rewardRate: '0' }); }
  };

  const loadUserData = async () => {
    try {
      const [stakeInfo, pending, freshPoolInfo] = await Promise.all([
        contracts.liquidityVault.getStakeInfo(stakingConfig.poolId, account),
        contracts.liquidityVault.pendingRewards(stakingConfig.poolId, account),
        contracts.liquidityVault.getPoolInfo(stakingConfig.poolId),
      ]);
      const staked = ethers.formatEther(stakeInfo.amount ?? stakeInfo[0]);
      const rewardRate = freshPoolInfo.rewardRatePerSecond;
      const totalStaked = freshPoolInfo.totalStakedAmount;
      let apy = null;
      if (rewardRate > 0n && totalStaked > 0n) {
        apy = (Number(ethers.formatEther(rewardRate * 31536000n)) / Number(ethers.formatEther(totalStaked))) * 100;
      }
      setPoolInfo({ apy: apy !== null ? apy.toFixed(2) : null, totalStaked: ethers.formatEther(totalStaked), rewardRate: ethers.formatEther(rewardRate) });
      const apyNum = apy ?? 0;
      setUserStakeData({ totalStaked: staked, pendingRewards: ethers.formatEther(pending), dailyRewards: (parseFloat(staked) * (apyNum / 100 / 365)).toFixed(6) });
    } catch { setUserStakeData({ totalStaked: '0', pendingRewards: '0', dailyRewards: '0' }); }
  };

  const loadTokenBalance = async () => {
    try { setTokenBalance(ethers.formatEther(await getTokenBalance(stakingConfig.stakedToken))); }
    catch { setTokenBalance('0'); }
  };

  const checkStakeApproval = async () => {
    if (!stakeAmount || !isConnected) { setNeedsApproval(false); return; }
    try { setNeedsApproval((await checkAllowance(stakingConfig.stakedToken, CONTRACTS.LIQUIDITY_VAULT)) < ethers.parseEther(stakeAmount)); }
    catch { setNeedsApproval(true); }
  };

  const handleApprove = async () => {
    if (!isConnected) { await connect(); return; }
    setApproving(true);
    try {
      await approveToken(stakingConfig.stakedToken, CONTRACTS.LIQUIDITY_VAULT, ethers.parseEther(stakeAmount));
      setNeedsApproval(false);
      toast.success('Approved', `${stakingConfig.stakedSymbol} approved for staking`);
    }
    catch (err) { alert('Approval failed: ' + err.message); toast.error('Approval Failed', err.message); }
    finally { setApproving(false); }
  };

  const handleStake = async () => {
    if (!isConnected) { await connect(); return; }
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) return;
    setLoading(true); setTxHash(null);
    try {
      const stakeWei = ethers.parseEther(stakeAmount);

      // Step 1 — approve if needed
      const allowance = await checkAllowance(stakingConfig.stakedToken, CONTRACTS.LIQUIDITY_VAULT);
      if (allowance < stakeWei) {
        toast.info('Approval needed', `Approving ${stakingConfig.stakedSymbol}...`);
        await approveToken(stakingConfig.stakedToken, CONTRACTS.LIQUIDITY_VAULT, stakeWei);
        setNeedsApproval(false);
      }

      // Step 2 — stake
      toast.info('Staking', 'Almost done...');
      const result = await executeContractCall('liquidityVault', 'stake', [stakingConfig.poolId, stakeWei]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId); setStakeAmount('');
      toast.success('Staked!', `${stakeAmount} ${stakingConfig.stakedSymbol} now earning ${stakingConfig.rewardSymbol}`, txId);
      publishEvent('staked', { pool: selectedSymbol, mode: stakeMode, amount: stakeAmount, txId });
      setTimeout(() => { loadUserData(); loadAllRewards(); }, 5000);
    } catch (err) {
      toast.error('Stake Failed', err.message);
    } finally { setLoading(false); }
  };

  const handleUnstake = async () => {
    if (!isConnected) { await connect(); return; }
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) return;
    setLoading(true); setTxHash(null);
    try {
      const result = await executeContractCall('liquidityVault', 'unstake', [stakingConfig.poolId, ethers.parseEther(unstakeAmount)]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId); setUnstakeAmount('');
      toast.success('Unstaked!', `${unstakeAmount} ${stakingConfig.stakedSymbol} returned to wallet`, txId);
      publishEvent('unstaked', { pool: selectedSymbol, mode: stakeMode, amount: unstakeAmount, txId });
      setTimeout(() => { loadUserData(); loadAllRewards(); }, 5000);
    } catch (err) { alert('Unstake failed: ' + err.message); toast.error('Unstake Failed', err.message); }
    finally { setLoading(false); }
  };

  // Load all pending rewards across every pool and mode — shown in unified claim view
  const loadAllRewards = async () => {
    if (!isConnected || !account || !contracts?.liquidityVault) return;
    const results = [];
    let stakedTotal = 0;
    await Promise.all(POOL_SYMBOLS.flatMap(sym => {
      const pool = POOLS[sym];
      return [
        Promise.all([
          contracts.liquidityVault.pendingRewards(pool.rwaStakePoolId, account),
          contracts.liquidityVault.getStakeInfo(pool.rwaStakePoolId, account),
        ]).then(([r, info]) => {
            const amount = parseFloat(ethers.formatEther(r));
            stakedTotal += parseFloat(ethers.formatEther(info.amount ?? info[0]));
            if (amount > 0) results.push({ poolId: pool.rwaStakePoolId, sym, mode: 'rwa', amount, rewardSymbol: 'USDC', label: `${sym} → USDC` });
          }).catch(() => {}),
        Promise.all([
          contracts.liquidityVault.pendingRewards(pool.lpMiningPoolId, account),
          contracts.liquidityVault.getStakeInfo(pool.lpMiningPoolId, account),
        ]).then(([r, info]) => {
            const amount = parseFloat(ethers.formatEther(r));
            stakedTotal += parseFloat(ethers.formatEther(info.amount ?? info[0]));
            if (amount > 0) results.push({ poolId: pool.lpMiningPoolId, sym, mode: 'lp', amount, rewardSymbol: sym, label: `${sym}/USDC LP → ${sym}` });
          }).catch(() => {}),
      ];
    }));
    results.sort((a, b) => b.amount - a.amount);
    setAllRewards(results);
    setTotalStakedAll(stakedTotal.toFixed(4));
  };

  const handleClaimSingle = async (poolId, rewardSymbol, amount) => {
    if (!isConnected) { await connect(); return; }
    setClaimingPool(poolId);
    try {
      const result = await executeContractCall('liquidityVault', 'claimRewards', [poolId]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId);
      toast.success('Rewards Claimed!', `${parseFloat(amount).toFixed(6)} ${rewardSymbol} sent to wallet`, txId);
      publishEvent('rewards_claimed', { rewardToken: rewardSymbol, amount, txId });
      setTimeout(loadAllRewards, 5000);
    } catch (err) {
      toast.error('Claim Failed', err.message);
    } finally {
      setClaimingPool(null);
    }
  };

  const handleClaimAll = async () => {
    if (!isConnected || allRewards.length === 0) return;
    setLoading(true);
    let claimed = 0;
    for (const r of allRewards) {
      try {
        await executeContractCall('liquidityVault', 'claimRewards', [r.poolId]);
        claimed++;
        toast.success('Claimed!', `${r.amount.toFixed(6)} ${r.rewardSymbol}`);
      } catch (err) {
        toast.error(`Claim failed for ${r.label}`, err.message);
      }
    }
    if (claimed > 0) setTimeout(loadAllRewards, 5000);
    setLoading(false);
  };

  const handleClaimRewards = async () => {
    if (!isConnected) { await connect(); return; }
    setLoading(true); setTxHash(null);
    try {
      const pending = userStakeData?.pendingRewards ?? '0';
      const result = await executeContractCall('liquidityVault', 'claimRewards', [stakingConfig.poolId]);
      const txId = result?.transactionId?.toString() ?? 'submitted';
      setTxHash(txId);
      toast.success('Rewards Claimed!', `${parseFloat(pending).toFixed(6)} ${stakingConfig.rewardSymbol} sent to wallet`, txId);
      publishEvent('rewards_claimed', { pool: selectedSymbol, mode: stakeMode, rewardToken: stakingConfig.rewardSymbol, txId });
      setTimeout(loadUserData, 5000);
    } catch (err) { alert('Claim failed: ' + err.message); toast.error('Claim Failed', err.message); }
    finally { setLoading(false); }
  };

  const rewardNotifCount = allRewards.length;

  const fmt = n => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontSize: '20px', fontWeight: 700, color: '#f1f5f9', width: '60%', padding: 0 };
  const panelStyle = { background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px' };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }} className="animate-fadeIn">
      <KYCBanner />
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 3px 0' }}>Stake & Earn</h1>
        <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>Stake RWA tokens to earn USDC yield. Stake LP tokens to earn bonus RWA rewards.</p>
      </div>

      <NotificationBanner badge="stake" />

      {/* Pool + Mode selectors */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
        <div className="flex gap-2">
          {POOL_SYMBOLS.map(sym => (
            <button key={sym} onClick={() => setSelectedSymbol(sym)}
              className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition-all ${selectedSymbol === sym ? 'bg-primary text-white' : 'bg-dark-tertiary text-muted hover:text-white'}`}>
              {sym}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />
        <div className="flex gap-2">
          {STAKE_MODES.map(mode => (
            <button key={mode} onClick={() => setStakeMode(mode)}
              className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition-all ${stakeMode === mode ? 'bg-indigo-600 text-white' : 'bg-dark-tertiary text-muted hover:text-white'}`}>
              {mode === 'rwa' ? `${selectedSymbol} → USDC` : `LP → ${selectedSymbol}`}
            </button>
          ))}
        </div>
      </div>

      {!isConnected && (
        <div style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ color: '#fbbf24', fontSize: '14px', margin: 0 }}>⚠️ Connect your wallet to stake</p>
          <button onClick={connect} className="btn-primary" style={{ fontSize: '14px', padding: '5px 14px' }}>Connect</button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '14px' }}>
        {[
          { label: 'Your Staked', value: isConnected && userStakeData ? fmt(userStakeData.totalStaked) : '—', sub: stakingConfig.stakedSymbol },
          { label: 'Pending Rewards (All)', value: isConnected ? fmt(allRewards.reduce((s, r) => s + r.amount, 0)) : '—', sub: 'across all pools', green: true },
          { label: 'APY', value: poolInfo ? (poolInfo.apy !== null ? `${poolInfo.apy}%` : '—') : '—', sub: 'Annual Yield', blue: true },
          { label: 'Total Staked', value: poolInfo ? fmt(poolInfo.totalStaked) : '—', sub: stakingConfig.stakedSymbol },
        ].map(({ label, value, sub, green, blue }) => (
          <div key={label} style={{ background: 'rgba(30,41,59,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: green ? '#10B981' : blue ? '#3B82F6' : '#f1f5f9' }}>{value}</div>
            <div style={{ fontSize: '13px', color: '#475569', marginTop: '2px' }}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Main panel */}
        <div style={{ gridColumn: 'span 2', ...panelStyle }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {['stake', 'unstake', 'rewards'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                paddingBottom: '10px', paddingLeft: '2px', paddingRight: '2px', fontWeight: 600, fontSize: '15px',
                background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
                color: tab === t ? '#3B82F6' : '#64748b',
                borderBottom: tab === t ? '2px solid #3B82F6' : '2px solid transparent',
              }}>
                {t === 'rewards' ? 'Claim Rewards' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'rewards' && rewardNotifCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '0px', right: '-14px',
                    minWidth: '16px', height: '16px', borderRadius: '8px',
                    background: '#ef4444', color: '#fff',
                    fontSize: '10px', fontWeight: 700, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px', boxShadow: '0 0 0 1.5px #1e293b',
                  }}>{rewardNotifCount}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'stake' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '5px' }}>Amount to Stake</label>
                <div style={{ background: 'rgba(51,65,85,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
                  <span style={{ background: 'rgba(71,85,105,0.6)', padding: '3px 9px', borderRadius: '5px', fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{stakingConfig.stakedSymbol}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '3px' }}>
                  <span style={{ color: '#475569' }}>Available: {fmt(tokenBalance)}</span>
                  <button onClick={() => setStakeAmount(tokenBalance)} style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>MAX</button>
                </div>
              </div>
              {poolInfo && stakeAmount && (
                <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '7px', padding: '10px 12px', fontSize: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>Daily Earnings</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 500 }}>~{((parseFloat(stakeAmount) * (poolInfo.apy !== null ? parseFloat(poolInfo.apy) / 100 / 365 : 0))).toFixed(6)} {stakingConfig.rewardSymbol}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>APY</span>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>{ poolInfo.apy !== null ? `${poolInfo.apy}%` : '—' }</span>
                  </div>
                </div>
              )}
              {!isConnected ? (
                <button onClick={connect} className="w-full btn-primary" style={{ padding: '10px', fontSize: '15px' }}>Connect Wallet</button>
              ) : (
                <button onClick={handleStake} disabled={loading || !stakeAmount || parseFloat(stakeAmount) <= 0} className="w-full btn-primary disabled:opacity-50" style={{ padding: '10px', fontSize: '15px' }}>
                  {loading ? 'Processing...' : 'Stake'}
                </button>
              )}
            </div>
          )}

          {tab === 'unstake' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* If nothing staked in current mode, show a helpful hint */}
              {isConnected && userStakeData && parseFloat(userStakeData.totalStaked) < 0.0001 && (
                <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '7px', padding: '10px 12px', fontSize: '13px', color: '#fbbf24' }}>
                  ⚠️ Nothing staked in <strong>{stakingConfig.stakedSymbol}</strong> mode.
                  {stakeMode === 'rwa'
                    ? <span> Switch to <button onClick={() => setStakeMode('lp')} style={{ color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>LP mode</button> if you staked LP tokens.</span>
                    : <span> Switch to <button onClick={() => setStakeMode('rwa')} style={{ color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>RWA mode</button> if you staked RWA tokens.</span>
                  }
                </div>
              )}
              <div>
                <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '5px' }}>Amount to Unstake</label>
                <div style={{ background: 'rgba(51,65,85,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <input type="number" value={unstakeAmount} onChange={e => setUnstakeAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
                  <span style={{ background: 'rgba(71,85,105,0.6)', padding: '3px 9px', borderRadius: '5px', fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{stakingConfig.stakedSymbol}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '3px' }}>
                  <span style={{ color: '#475569' }}>Staked: {fmt(userStakeData?.totalStaked ?? '0')}</span>
                  <button onClick={() => setUnstakeAmount(userStakeData?.totalStaked ?? '0')} style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>MAX</button>
                </div>
                {unstakeAmount && parseFloat(unstakeAmount) > parseFloat(userStakeData?.totalStaked ?? '0') && (
                  <div style={{ marginTop: '5px', fontSize: '12px', color: '#ef4444' }}>
                    ✗ Amount exceeds staked balance ({fmt(userStakeData?.totalStaked ?? '0')})
                  </div>
                )}
              </div>
              {/* Preview */}
              {unstakeAmount && parseFloat(unstakeAmount) > 0 && parseFloat(unstakeAmount) <= parseFloat(userStakeData?.totalStaked ?? '0') && (
                <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '7px', padding: '10px 12px', fontSize: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>You will receive</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fmt(unstakeAmount, 4)} {stakingConfig.stakedSymbol}</span>
                  </div>
                  {stakeMode === 'lp' && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>
                      💡 After unstaking LP tokens, go to <a href="/pools" style={{ color: '#3B82F6' }}>Liquidity Pools</a> to remove liquidity and get back your {selectedSymbol} + USDC.
                    </div>
                  )}
                </div>
              )}
              {!isConnected ? (
                <button onClick={connect} className="w-full btn-primary" style={{ padding: '10px', fontSize: '15px' }}>Connect Wallet</button>
              ) : (
                <button
                  onClick={handleUnstake}
                  disabled={loading || !unstakeAmount || parseFloat(unstakeAmount) <= 0 || parseFloat(unstakeAmount) > parseFloat(userStakeData?.totalStaked ?? '0')}
                  className="w-full btn-primary disabled:opacity-50"
                  style={{ padding: '10px', fontSize: '15px' }}>
                  {loading ? 'Unstaking...'
                    : parseFloat(unstakeAmount) > parseFloat(userStakeData?.totalStaked ?? '0') ? 'Exceeds staked balance'
                    : 'Unstake'}
                </button>
              )}
            </div>
          )}

          {tab === 'rewards' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Summary box — total across all pools */}
              {isConnected && (
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Total Pending Rewards</div>
                  <div style={{ fontSize: '30px', fontWeight: 700, color: '#10B981', marginBottom: '4px' }}>
                    {allRewards.reduce((sum, r) => sum + r.amount, 0).toFixed(6)}
                  </div>
                  <div style={{ fontSize: '14px', color: '#475569' }}>across {allRewards.length} pool{allRewards.length !== 1 ? 's' : ''}</div>
                </div>
              )}

              {/* Unified rewards list — all pools all modes */}
              {!isConnected ? (
                <button onClick={connect} className="w-full btn-primary" style={{ padding: '10px', fontSize: '15px' }}>Connect Wallet</button>
              ) : allRewards.length === 0 ? (
                <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '10px', padding: '28px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎯</div>
                  <div style={{ fontSize: '14px', color: '#64748b' }}>No rewards to claim yet.</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>Stake tokens or LP tokens to start earning.</div>
                </div>
              ) : (
                <>
                  {/* Claim all button — only show if multiple rewards */}
                  {allRewards.length > 1 && (
                    <button
                      onClick={handleClaimAll}
                      disabled={loading}
                      className="w-full btn-primary disabled:opacity-50"
                      style={{ padding: '10px', fontSize: '14px', fontWeight: 600 }}
                    >
                      {loading ? 'Claiming...' : `Claim All (${allRewards.length} pools)`}
                    </button>
                  )}

                  {/* Individual reward rows */}
                  {allRewards.map(r => (
                    <div key={r.poolId} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '12px', flexWrap: 'wrap',
                      background: 'rgba(16,185,129,0.05)',
                      border: '1px solid rgba(16,185,129,0.18)',
                      borderRadius: '10px', padding: '14px 16px',
                    }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{r.label}</div>
                        <div style={{ fontSize: '13px', marginTop: '2px' }}>
                          <span style={{ color: '#10B981', fontWeight: 700 }}>{r.amount.toFixed(6)} {r.rewardSymbol}</span>
                          <span style={{ color: '#475569' }}> claimable</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleClaimSingle(r.poolId, r.rewardSymbol, r.amount)}
                        disabled={claimingPool === r.poolId}
                        className="btn-primary disabled:opacity-50"
                        style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600, flexShrink: 0 }}
                      >
                        {claimingPool === r.poolId ? 'Claiming...' : `Claim ${r.rewardSymbol}`}
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* Keep earnings projection for context — based on current selected pool */}
              {userStakeData && parseFloat(userStakeData.dailyRewards) > 0 && (
                <div style={{ background: 'rgba(51,65,85,0.3)', borderRadius: '7px', padding: '10px 12px', fontSize: '14px' }}>
                  {[
                    { label: 'Daily est.', value: `${fmt(userStakeData.dailyRewards)} ${stakingConfig.rewardSymbol}` },
                    { label: 'Monthly est.', value: `${fmt(parseFloat(userStakeData.dailyRewards) * 30)} ${stakingConfig.rewardSymbol}` },
                    { label: 'Yearly est.', value: `${fmt(parseFloat(userStakeData.dailyRewards) * 365)} ${stakingConfig.rewardSymbol}` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: '#64748b' }}>{label}</span>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
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
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>Staking Guide</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: '3px' }}>RWA Staking</div>
                <div style={{ color: '#64748b', lineHeight: 1.5 }}>Stake {selectedSymbol} tokens and earn USDC yield — simulating real asset income.</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: '3px' }}>LP Mining</div>
                <div style={{ color: '#64748b', lineHeight: 1.5 }}>Add liquidity → stake LP tokens → earn bonus {selectedSymbol} rewards.</div>
              </div>
            </div>
          </div>
          <div style={panelStyle}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>Your Stats</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
              {[
                { label: 'Wallet', value: `${fmt(tokenBalance)} ${stakingConfig.stakedSymbol}` },
                { label: 'Staked (All)', value: fmt(totalStakedAll) },
                { label: 'Rewards (All)', value: `${fmt(allRewards.reduce((s, r) => s + r.amount, 0))} tokens`, green: true },
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

export default Stake;
