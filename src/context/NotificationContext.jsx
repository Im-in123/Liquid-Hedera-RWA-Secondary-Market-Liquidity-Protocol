import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';
import { useContracts } from '../hooks/useContracts';
import { POOLS, POOL_SYMBOLS, TOKENS } from '../config/contracts';

const REWARD_THRESHOLD = 0.01;   // USDC
const POLL_INTERVAL = 30000;     // 30s
const LOW_LIQUIDITY_USDC = 5000; // below this USDC reserve = low liquidity warning

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { isConnected, account } = useWallet();
  const { contracts, getTokenBalance, getERC20Contract } = useContracts();
  const [notifications, setNotifications] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const intervalRef = useRef(null);

  const buildNotifications = useCallback(async () => {
    if (!isConnected || !account || !contracts?.liquidityVault || !contracts?.adaptiveAMM || !contracts?.complianceRegistry) return;

    const next = [];

    try {
      // 0. Check if wallet is KYC verified — most critical notification
      try {
        const isCompliant = await contracts.complianceRegistry.isInvestorCompliant(account);
        let atsVerified = false;
        try {
          const atsVerifiedRaw = await contracts.atsIdentityRegistry.isVerified(account);
          atsVerified = atsVerifiedRaw;
        } catch (_) {}

        if (!isCompliant && !atsVerified) {
          next.push({
            id: 'kyc-required',
            type: 'idle',
            icon: '🛡️',
            title: 'KYC Verification Required',
            message: 'Complete KYC to trade RWA tokens',
            path: '/compliance',
            badge: 'compliance',
            priority: 0,
          });
        }
      } catch (_) {}

      // 1. Check pending rewards — always badge 'stake' (rewards are claimed from Stake page)
      for (const sym of POOL_SYMBOLS) {
        const pool = POOLS[sym];

        try {
          const [rwaRewards, lpRewards] = await Promise.all([
            contracts.liquidityVault.pendingRewards(pool.rwaStakePoolId, account),
            contracts.liquidityVault.pendingRewards(pool.lpMiningPoolId, account),
          ]);
          const rwaAmt = parseFloat(ethers.formatEther(rwaRewards));
          const lpAmt = parseFloat(ethers.formatEther(lpRewards));

          if (rwaAmt > REWARD_THRESHOLD || lpAmt > REWARD_THRESHOLD) {
            const parts = [];
            if (rwaAmt > REWARD_THRESHOLD) parts.push(`${rwaAmt.toFixed(4)} USDC`);
            if (lpAmt > REWARD_THRESHOLD) parts.push(`${lpAmt.toFixed(4)} ${sym}`);
            next.push({
              id: `rewards-${sym}`,
              type: 'rewards',
              icon: '💰',
              title: `${sym} Rewards Ready`,
              message: `${parts.join(' + ')} claimable`,
              path: `/stake?tab=claim&symbol=${sym}&mode=${lpAmt > REWARD_THRESHOLD ? 'lp' : 'rwa'}`,
              badge: 'stake', // rewards are always claimed on Stake page — never show on Liquidity
              priority: 1,
            });
          }
        } catch (_) {}

        // 2. User has RWA tokens but zero LP in this pool — nudge them to add liquidity
        try {
          const lpContract = getERC20Contract(pool.lpToken);
          const [lpWallet, lpStakeInfo, assetBal] = await Promise.all([
            lpContract.balanceOf(account),
            contracts.liquidityVault.getStakeInfo(pool.lpMiningPoolId, account),
            getTokenBalance(pool.assetToken),
          ]);
          const walletLP = parseFloat(ethers.formatEther(lpWallet));
          const stakedLP = parseFloat(ethers.formatEther(lpStakeInfo.amount ?? lpStakeInfo[0]));
          const assetHeld = parseFloat(ethers.formatEther(assetBal));
          // Use a small threshold rather than strict 0 to avoid floating point false positives
          const hasNoLiquidity = walletLP < 0.0001 && stakedLP < 0.0001;

          // LP tokens in wallet but not staked — nudge to stake
          if (walletLP > 0.001 && stakedLP === 0) {
            next.push({
              id: `unstaked-lp-${sym}`,
              type: 'idle',
              icon: '💧',
              title: `Idle ${sym}/USDC LP`,
              message: `${walletLP.toFixed(4)} LP tokens not earning rewards`,
              path: `/stake?tab=stake&symbol=${sym}&mode=lp`,
              badge: 'pools',
              priority: 2,
            });
          }

          // Has the asset token but hasn't added liquidity to this pool at all
          if (hasNoLiquidity && assetHeld > 1) {
            next.push({
              id: `no-liquidity-${sym}`,
              type: 'idle',
              icon: '💧',
              title: `Add ${sym}/USDC Liquidity`,
              message: `You have ${assetHeld.toFixed(0)} ${sym} — provide liquidity to earn 0.3% fees`,
              path: `/pools?symbol=${sym}`,
              badge: 'pools',
              priority: 3,
            });
          }
        } catch (_) {}

        // 3. Low pool USDC reserve warning
        try {
          const raw = await contracts.adaptiveAMM.getPool(pool.ammPoolId);
          const usdcReserve = parseFloat(ethers.formatEther(raw.quoteReserve));
          if (usdcReserve > 0 && usdcReserve < LOW_LIQUIDITY_USDC) {
            next.push({
              id: `low-liquidity-${sym}`,
              type: 'idle',
              icon: '⚠️',
              title: `${sym}/USDC Low Liquidity`,
              message: `Pool has $${usdcReserve.toFixed(0)} USDC — add liquidity to earn fees`,
              path: `/pools?symbol=${sym}`,
              badge: 'pools',
              priority: 3,
            });
          }
        } catch (_) {}
      }

      // 4. RWA tokens idle — notify if wallet > 1, zero RWA staked, AND no LP position in the pool
      for (const sym of POOL_SYMBOLS) {
        try {
          const pool = POOLS[sym];
          const lpContract = getERC20Contract(pool.lpToken);
          const [walletBal, stakeInfo, lpWallet, lpStakeInfo] = await Promise.all([
            getTokenBalance(pool.assetToken),
            contracts.liquidityVault.getStakeInfo(pool.rwaStakePoolId, account),
            lpContract.balanceOf(account),
            contracts.liquidityVault.getStakeInfo(pool.lpMiningPoolId, account),
          ]);
          const wallet = parseFloat(ethers.formatEther(walletBal));
          const rwaStaked = parseFloat(ethers.formatEther(stakeInfo.amount ?? stakeInfo[0]));
          const lpInWallet = parseFloat(ethers.formatEther(lpWallet));
          const lpStaked = parseFloat(ethers.formatEther(lpStakeInfo.amount ?? lpStakeInfo[0]));
          // Suppress if user already has any LP position — they're already participating in this pool
          const alreadyInPool = lpInWallet > 0.0001 || lpStaked > 0.0001 || rwaStaked > 0.0001;
          if (wallet > 1 && !alreadyInPool) {
            next.push({
              id: `unstaked-rwa-${sym}`,
              type: 'idle',
              icon: '🔒',
              title: `Stake ${sym} to Earn`,
              message: `${wallet.toFixed(0)} ${sym} idle — stake to earn USDC`,
              path: `/stake?tab=stake&symbol=${sym}&mode=rwa`,
              badge: 'stake',
              priority: 3,
            });
          }
        } catch (_) {}
      }

    } catch (_) {}

    // Sort by priority, dedupe by id
    next.sort((a, b) => a.priority - b.priority);
    setNotifications(next);
  }, [isConnected, account, contracts]);

  // Poll on interval
  useEffect(() => {
    if (!isConnected || !account) {
      setNotifications([]);
      return;
    }
    buildNotifications();
    intervalRef.current = setInterval(buildNotifications, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [isConnected, account, buildNotifications]);

  const dismiss = (id) => setDismissed(prev => new Set([...prev, id]));
  const dismissAll = () => setDismissed(new Set(notifications.map(n => n.id)));

  const visible = notifications.filter(n => !dismissed.has(n.id));

  // Badge map: which nav paths have notifications
  const badges = {};
  visible.forEach(n => { if (n.badge) badges[n.badge] = (badges[n.badge] || 0) + 1; });

  return (
    <NotificationContext.Provider value={{ notifications: visible, badges, dismiss, dismissAll, refresh: buildNotifications }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}