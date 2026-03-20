// src/hooks/useMirrorNode.js
//
// Hedera Mirror Node REST API integration
// Pulls live on-chain data directly from Hedera's infrastructure
// — not from our own backend or RPC node.
//
// Endpoints used:
//   /api/v1/contracts/{address}/results  — transaction history per contract
//   /api/v1/contracts/{address}/state    — contract state slots
//   /api/v1/tokens/{tokenId}             — HTS token info (if applicable)
//
import { useState, useEffect, useCallback } from 'react';
import { CONTRACTS } from '../config/contracts';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com/api/v1';

// Convert EVM address to mirror node format (lowercase with 0x)
const toMirrorAddress = (addr) => addr?.toLowerCase();

export function useMirrorNode() {
  const [ammTransactions, setAmmTransactions]   = useState([]);
  const [protocolStats, setProtocolStats]       = useState(null);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState(null);
  const [lastFetched, setLastFetched]           = useState(null);

  /**
   * Fetch transaction history for the AdaptiveAMM contract from Mirror Node.
   * This gives us every swap, addLiquidity, removeLiquidity call with timestamps.
   */
  const fetchAMMTransactions = useCallback(async (limit = 25) => {
    const address = toMirrorAddress(CONTRACTS.ADAPTIVE_AMM);
    if (!address) return [];

    try {
      const res = await fetch(
        `${MIRROR_BASE}/contracts/${address}/results?limit=${limit}&order=desc`
      );
      if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
      const data = await res.json();
      return (data.results || []).map(tx => ({
        hash:         tx.hash,
        from:         tx.from,
        timestamp:    tx.timestamp,
        gasUsed:      tx.gas_used,
        result:       tx.result,
        functionCall: tx.function_parameters?.slice(0, 10), // 4-byte selector
        blockNumber:  tx.block_number,
      }));
    } catch (err) {
      console.warn('Mirror Node AMM fetch failed:', err.message);
      return [];
    }
  }, []);

  /**
   * Fetch contract call results for the LiquidityVault (staking transactions)
   */
  const fetchVaultTransactions = useCallback(async (limit = 10) => {
    const address = toMirrorAddress(CONTRACTS.LIQUIDITY_VAULT);
    if (!address) return [];

    try {
      const res = await fetch(
        `${MIRROR_BASE}/contracts/${address}/results?limit=${limit}&order=desc`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Fetch contract call count — used as proxy for total trade count
   */
  const fetchTransactionCount = useCallback(async (address) => {
    const addr = toMirrorAddress(address);
    if (!addr) return 0;

    try {
      const res = await fetch(
        `${MIRROR_BASE}/contracts/${addr}/results?limit=1&order=desc`
      );
      if (!res.ok) return 0;
      const data = await res.json();
      // Mirror node returns total count in links or we estimate from latest block
      return data.results?.length > 0 ? parseInt(data.results[0].block_number ?? 0) : 0;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Fetch full protocol stats in one call
   */
  const fetchProtocolStats = useCallback(async () => {
    const ammAddress = toMirrorAddress(CONTRACTS.ADAPTIVE_AMM);
    if (!ammAddress) return null;

    try {
      // Fetch recent AMM transactions
      const res = await fetch(
        `${MIRROR_BASE}/contracts/${ammAddress}/results?limit=100&order=desc`
      );
      if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
      const data = await res.json();
      const txs = data.results || [];

      // Derive stats from transaction list
      const totalTxs    = txs.length;
      const successTxs  = txs.filter(t => t.result === 'SUCCESS').length;
      const uniqueUsers = new Set(txs.map(t => t.from).filter(Boolean)).size;
      const firstTx     = txs.length > 0 ? txs[txs.length - 1].timestamp : null;
      const lastTx      = txs.length > 0 ? txs[0].timestamp              : null;

      return {
        totalTransactions: totalTxs,
        successfulTxs:     successTxs,
        uniqueUsers,
        firstActivity:     firstTx,
        lastActivity:      lastTx,
        source:            'Hedera Mirror Node',
      };
    } catch (err) {
      console.warn('Mirror Node stats fetch failed:', err.message);
      return null;
    }
  }, []);

  /**
   * Main refresh — fetches all data
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [txs, stats] = await Promise.all([
        fetchAMMTransactions(20),
        fetchProtocolStats(),
      ]);
      setAmmTransactions(txs);
      setProtocolStats(stats);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAMMTransactions, fetchProtocolStats]);

  // Auto-fetch on mount
  useEffect(() => {
    refresh();
  }, []);

  return {
    ammTransactions,
    protocolStats,
    loading,
    error,
    lastFetched,
    refresh,
    fetchAMMTransactions,
    fetchVaultTransactions,
  };
}

export default useMirrorNode;
