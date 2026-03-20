// src/hooks/useContracts.js
//
// Architecture:
// - READS:  ethers.Contract + JsonRpcProvider (Hashio relay)
// - WRITES: dAppConnector.signAndExecuteTransaction() using the hedera native WalletConnect path.
//           The transaction is built with @hashgraph/sdk, frozen with a node ID, serialized to
//           base64 via transactionToBase64String, then sent to HashPack for signing + execution.
//
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  ContractExecuteTransaction,
  ContractId,
  AccountId,
  TransactionId,
} from '@hashgraph/sdk';
import { transactionToBase64String } from '@hashgraph/hedera-wallet-connect';
import { useWallet } from '../context/WalletContext';
import contractAddresses from '../config/contracts';
import { TOKENS } from '../config/contracts';

import { AdaptiveAMM__factory } from '../../typechain-types/factories/contracts/AdaptiveAMM__factory';
import { LiquidityVault__factory } from '../../typechain-types/factories/contracts/LiquidityVault__factory';
import { ComplianceRegistry__factory } from '../../typechain-types/factories/contracts/ComplianceRegistry__factory';
import { TreasuryManager__factory } from '../../typechain-types/factories/contracts/TreasuryManager__factory';
import { MockERC20__factory } from '../../typechain-types/factories/contracts/MockERC20__factory';
import { RWAToken__factory } from '../../typechain-types/factories/contracts/RWAToken__factory';
import { ATSIdentityRegistry__factory } from '../../typechain-types/factories/contracts/ATSIdentityRegistry__factory';

// RWA token addresses (ERC-3643) — identified by checking TOKENS config
// These require RWAToken ABI for functions like mint, pause, freeze, etc.
const getRWATokenAddresses = () => {
  try {
    return Object.values(TOKENS)
      .filter(t => t.standard === 'ERC-3643')
      .map(t => t.address.toLowerCase());
  } catch { return []; }
};

const ABI_MAP = {
  adaptiveAMM:        AdaptiveAMM__factory.abi,
  liquidityVault:     LiquidityVault__factory.abi,
  complianceRegistry: ComplianceRegistry__factory.abi,
  treasuryManager:    TreasuryManager__factory.abi,
  atsIdentityRegistry: ATSIdentityRegistry__factory.abi,
};

const ADDRESS_MAP = {
  adaptiveAMM:        contractAddresses.AdaptiveAMM,
  liquidityVault:     contractAddresses.LiquidityVault,
  complianceRegistry: contractAddresses.ComplianceRegistry,
  treasuryManager:    contractAddresses.TreasuryManager,
  atsIdentityRegistry: contractAddresses.ATSIdentityRegistry,
};

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com/api/v1';

const TESTNET_NODES = [
  AccountId.fromString('0.0.3'),
  AccountId.fromString('0.0.4'),
  AccountId.fromString('0.0.5'),
];

// Resolve a short EVM address to a Hedera ContractId via mirror node
const contractIdCache = {};
async function resolveContractId(evmAddress) {
  if (contractIdCache[evmAddress]) return contractIdCache[evmAddress];
  const res = await fetch(`${MIRROR_BASE}/contracts/${evmAddress}`);
  if (!res.ok) throw new Error(`Mirror node lookup failed for ${evmAddress}: ${res.status}`);
  const data = await res.json();
  if (!data.contract_id) throw new Error(`No contract_id in mirror node response for ${evmAddress}`);
  const id = ContractId.fromString(data.contract_id);
  contractIdCache[evmAddress] = id;
  console.log(`Resolved ${evmAddress} -> ${id.toString()}`);
  return id;
}

export function useContracts() {
  const { provider, account, accountId, dAppConnector, isConnected } = useWallet();
  const [contracts, setContracts] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Read-only ethers contracts — available once provider is ready
  useEffect(() => {
    if (!provider) { setContracts(null); return; }
    try {
      setContracts({
        adaptiveAMM:         new ethers.Contract(contractAddresses.AdaptiveAMM,        AdaptiveAMM__factory.abi,        provider),
        liquidityVault:      new ethers.Contract(contractAddresses.LiquidityVault,     LiquidityVault__factory.abi,     provider),
        complianceRegistry:  new ethers.Contract(contractAddresses.ComplianceRegistry, ComplianceRegistry__factory.abi, provider),
        treasuryManager:     new ethers.Contract(contractAddresses.TreasuryManager,    TreasuryManager__factory.abi,    provider),
        atsIdentityRegistry: new ethers.Contract(contractAddresses.ATSIdentityRegistry, ATSIdentityRegistry__factory.abi, provider),
      });
    } catch (error) {
      console.error('Error initializing read contracts:', error);
    }
  }, [provider]);

  /**
   * Execute a state-changing contract call via dAppConnector.signAndExecuteTransaction.
   */
  const _executeCall = async (evmAddress, abi, functionName, args = [], gas = 400_000) => {
    if (!dAppConnector) throw new Error('DAppConnector not initialized.');
    if (!accountId) throw new Error('Wallet not connected. Please connect your wallet first.');

    const iface = new ethers.Interface(abi);
    const calldata = iface.encodeFunctionData(functionName, args);
    const calldataBytes = ethers.getBytes(calldata);

    const contractId = await resolveContractId(evmAddress);

    const txId = TransactionId.generate(AccountId.fromString(accountId));
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunctionParameters(calldataBytes)
      .setTransactionId(txId)
      .setNodeAccountIds(TESTNET_NODES)
      .freeze();

    const base64tx = transactionToBase64String(tx);

    console.log(`📤 ${functionName} on ${contractId.toString()} via signAndExecuteTransaction`);

    const result = await dAppConnector.signAndExecuteTransaction({
      signerAccountId: `hedera:testnet:${accountId}`,
      transactionList: base64tx,
    });

    console.log('✅ Success:', result?.transactionId);
    return result;
  };

  const executeContractCall = (contractName, functionName, args = [], gas = 400_000) => {
    const address = ADDRESS_MAP[contractName];
    const abi = ABI_MAP[contractName];
    if (!address || !abi) throw new Error(`Unknown contract: ${contractName}`);
    return _executeCall(address, abi, functionName, args, gas);
  };

  /**
   * Execute a call on a token contract.
   * Uses RWAToken ABI for ERC-3643 tokens, MockERC20 ABI for USDC.
   * This matters because RWAToken has additional functions (mint checks identity,
   * pause, freeze, etc.) that aren't in the plain ERC-20 ABI.
   */
  const executeERC20Call = (tokenAddress, functionName, args = [], gas = 300_000) => {
    const rwaAddresses = getRWATokenAddresses();
    const isRWA = rwaAddresses.includes(tokenAddress.toLowerCase());
    const abi = isRWA ? RWAToken__factory.abi : MockERC20__factory.abi;
    return _executeCall(tokenAddress, abi, functionName, args, gas);
  };

  /**
   * Get a read-only ethers Contract for a token.
   * Uses RWAToken ABI for ERC-3643 tokens, MockERC20 ABI for USDC.
   */
  const getERC20Contract = (tokenAddress) => {
    if (!provider) throw new Error('Provider not available');
    const rwaAddresses = getRWATokenAddresses();
    const isRWA = rwaAddresses.includes(tokenAddress.toLowerCase());
    const abi = isRWA ? RWAToken__factory.abi : MockERC20__factory.abi;
    return new ethers.Contract(tokenAddress, abi, provider);
  };

  /**
   * Get a read-only ethers Contract for the ATS identity registry.
   */
  const getATSRegistryContract = () => {
    if (!provider) throw new Error('Provider not available');
    return new ethers.Contract(
      contractAddresses.ATSIdentityRegistry,
      ATSIdentityRegistry__factory.abi,
      provider
    );
  };

  /**
   * Execute a call on the ATS identity registry.
   * Used by the faucet for selfRegister().
   */
  const executeATSCall = (functionName, args = [], gas = 200_000) => {
    return _executeCall(
      contractAddresses.ATSIdentityRegistry,
      ATSIdentityRegistry__factory.abi,
      functionName,
      args,
      gas
    );
  };

  const approveToken = (tokenAddress, spenderAddress, amount) =>
    executeERC20Call(tokenAddress, 'approve', [spenderAddress, amount]);

  const checkAllowance = async (tokenAddress, spenderAddress) => {
    try {
      if (!account) return ethers.parseEther('0');
      return await getERC20Contract(tokenAddress).allowance(account, spenderAddress);
    } catch { return ethers.parseEther('0'); }
  };

  const getTokenBalance = async (tokenAddress, address) => {
    try {
      const addr = address ?? account;
      if (!addr) return ethers.parseEther('0');
      return await getERC20Contract(tokenAddress).balanceOf(addr);
    } catch { return ethers.parseEther('0'); }
  };

  return {
    contracts,
    isLoading,
    isConnected,
    executeContractCall,
    executeERC20Call,
    executeATSCall,
    getERC20Contract,
    getATSRegistryContract,
    approveToken,
    checkAllowance,
    getTokenBalance,
    contractAddresses,
  };
}

export default useContracts;
