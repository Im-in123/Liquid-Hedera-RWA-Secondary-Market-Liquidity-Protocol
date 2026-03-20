// src/hooks/useCompliance.js
//
// Centralizes all compliance status logic.
// Any page can import this to check if the connected wallet is whitelisted
// and to trigger the KYC request flow.

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { CONTRACTS, NETWORK } from '../config/contracts';

const COMPLIANCE_ABI = [
  'function getInvestorProfile(address investor) external view returns (bool isWhitelisted, bool isKYCVerified, bool isAccredited, uint256 kycExpiryTime, string memory jurisdiction)',
];

function getComplianceContract() {
  const network = new ethers.Network(NETWORK.name, NETWORK.chainId);
  const provider = new ethers.JsonRpcProvider(NETWORK.rpcUrl, network, { staticNetwork: network });
  return new ethers.Contract(CONTRACTS.COMPLIANCE_REGISTRY, COMPLIANCE_ABI, provider);
}

export function useCompliance() {
  const { account, isConnected } = useWallet();

  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [isLoading, setIsLoading]         = useState(true);
  const [profile, setProfile]             = useState(null);

  const checkStatus = useCallback(async () => {
    if (!isConnected || !account) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const registry = getComplianceContract();
      const p = await registry.getInvestorProfile(account);
      const whitelisted = p[0];
      const kycExpired  = Number(p[3]) > 0 && Date.now() / 1000 > Number(p[3]);
      setIsWhitelisted(whitelisted && !kycExpired);
      setProfile({
        isWhitelisted:  p[0],
        isKYCVerified:  p[1],
        isAccredited:   p[2],
        kycExpiryTime:  Number(p[3]),
        jurisdiction:   p[4],
      });
    } catch (err) {
      console.warn('Compliance check failed:', err.message);
      setIsWhitelisted(false);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, account]);

  // Check on mount and whenever wallet or account changes
  useEffect(() => { checkStatus(); }, [checkStatus]);

  /**
   * Request KYC approval from the compliance operator.
   * Sends name + jurisdiction to the serverless function which calls
   * whitelistInvestor() on-chain using the deployer key.
   * No wallet signing required from the user.
   */
  const requestKYC = useCallback(async ({ name, jurisdiction }) => {
    if (!account) throw new Error('Wallet not connected');

    const res = await fetch('/api/whitelist', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address: account, name, jurisdiction }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'KYC request failed');

    // Re-check status after whitelisting
    await checkStatus();

    return data;
  }, [account, checkStatus]);

  return { isWhitelisted, isLoading, profile, checkStatus, requestKYC };
}

export default useCompliance;
