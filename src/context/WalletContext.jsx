// src/context/WalletContext.jsx - FINAL VERSION (Prevents Double Init)
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { 
  HederaSessionEvent, 
  HederaJsonRpcMethod, 
  DAppConnector,
  HederaChainId,
} from '@hashgraph/hedera-wallet-connect';
import { LedgerId } from '@hashgraph/sdk';

const WalletContext = createContext();

// Hedera Testnet configuration
const HEDERA_TESTNET_CONFIG = {
  chainId: '0x128', // 296 in decimal
  chainName: 'Hedera Testnet',
  nativeCurrency: {
    name: 'HBAR',
    symbol: 'HBAR',
    decimals: 8,
  },
  rpcUrls: ['https://testnet.hashio.io/api'],
  blockExplorerUrls: ['https://hashscan.io/testnet'],
};

const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;


// ---------------------------------------------------------------------------
// HederaEthSigner — bridges Hedera DAppSigner → ethers AbstractSigner
// Signs transactions using the Hedera WalletConnect DAppSigner and broadcasts
// them via the Hedera JSON-RPC relay (Hashio), which is the correct pattern
// for EVM smart contract calls on Hedera via HashPack WalletConnect.
// ---------------------------------------------------------------------------
class HederaEthSigner extends ethers.AbstractSigner {
  constructor(hederaSigner, provider, address) {
    super(provider);
    this._hederaSigner = hederaSigner;
    this._address = address;
  }

  async getAddress() {
    return this._address;
  }

  async signMessage(message) {
    // Use the DAppSigner's sign capability
    const bytes = typeof message === 'string' ? ethers.toUtf8Bytes(message) : message;
    const sig = await this._hederaSigner.sign([{ message: bytes }]);
    return sig[0]?.signature ? ethers.hexlify(sig[0].signature) : '0x';
  }

  async signTransaction(tx) {
    throw new Error('signTransaction not supported — use sendTransaction directly');
  }

  async signTypedData(domain, types, value) {
    throw new Error('signTypedData not supported on Hedera WalletConnect signer');
  }

  async sendTransaction(tx) {
    // Populate missing fields using the provider
    const populated = await this.provider.populateTransaction({
      ...tx,
      from: this._address,
    });

    // Encode as RLP for signing
    const txObj = ethers.Transaction.from(populated);
    const unsignedRlp = txObj.unsignedSerialized;

    // Ask DAppSigner to sign the raw EVM transaction bytes
    // hedera-wallet-connect DAppSigner supports eth_signTransaction via
    // the hedera:testnet WalletConnect RPC method
    let signedRlp;
    try {
      signedRlp = await this._hederaSigner.request({
        method: 'eth_signTransaction',
        params: [{ ...populated, from: this._address }],
      });
    } catch (e) {
      // Fallback: try personal_sign on the serialized tx
      signedRlp = await this._hederaSigner.request({
        method: 'personal_sign',
        params: [unsignedRlp, this._address],
      });
    }

    // Broadcast via JSON-RPC relay
    const result = await this.provider.broadcastTransaction(signedRlp);
    return result;
  }

  connect(provider) {
    return new HederaEthSigner(this._hederaSigner, provider, this._address);
  }
}

export function WalletProvider({ children }) {
  const [dAppConnector, setDAppConnector] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Create a read-only provider immediately so pages can fetch public data before wallet connects
  const [provider, setProvider] = useState(() => {
    const network = new ethers.Network('Hedera Testnet', 296);
    return new ethers.JsonRpcProvider(
      HEDERA_TESTNET_CONFIG.rpcUrls[0],
      network,
      { staticNetwork: network }
    );
  });
  
  // Prevent double initialization in React Strict Mode
  const initRef = useRef(false);

  // Initialize Hedera WalletConnect
  useEffect(() => {
    // Skip if already initialized
    if (initRef.current) {
      console.log('⏭️ Skipping duplicate initialization (React Strict Mode)');
      return;
    }
    
    initRef.current = true;

    const initWalletConnect = async () => {
      try {
        console.log('🚀 Initializing Hedera WalletConnect...');
        console.log('📋 Project ID:', PROJECT_ID ? 'Set ✓' : 'Missing ✗');
        
        // DApp metadata
        const metadata = {
          name: 'Liquid Protocol',
          description: 'Boutique RWA Secondary Market on Hedera',
          url: window.location.origin,
          icons: [window.location.origin + '/favicon.ico'],
        };

        // Create DAppConnector
        const connector = new DAppConnector(
          metadata,
          LedgerId.TESTNET,
          PROJECT_ID,
          Object.values(HederaJsonRpcMethod),
          [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
          [HederaChainId.Testnet]
        );

        // Initialize
        await connector.init({ logger: 'error' });
        console.log('✅ DAppConnector initialized');
        
        setDAppConnector(connector);
        setIsInitialized(true);

        // Check for existing sessions immediately after init
        checkAndRestoreSession(connector);

      } catch (err) {
        console.error('❌ WalletConnect initialization error:', err);
        setError(err.message);
        setIsInitialized(true);
      }
    };

    initWalletConnect();

    return () => {
      // Only cleanup on real unmount, not Strict Mode re-render
      if (dAppConnector && !import.meta.env.DEV) {
        try {
          dAppConnector.disconnectAll().catch(console.error);
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      }
    };
  }, []); // Empty deps - run once

  // Check and restore existing session
  const checkAndRestoreSession = (connector) => {
    try {
      // Check if we have signers (which means we're connected)
      if (connector.signers && connector.signers.length > 0) {
        console.log('🔄 Found existing session with', connector.signers.length, 'signer(s)');
        handleConnection(connector.signers[0]);
      } else {
        console.log('ℹ️ No existing session found');
      }
    } catch (err) {
      console.error('Session restore error:', err);
    }
  };

  // Handle connection after wallet connects
  const handleConnection = async (hederaSigner) => {
    try {
      const hederaAccountId = hederaSigner.getAccountId()?.toString();
      const rawEvmAddress = hederaSigner.getAccountId()?.toSolidityAddress();
      const evmAddress = rawEvmAddress
        ? ethers.getAddress('0x' + rawEvmAddress)
        : null;

      console.log('✅ Wallet connected:', {
        hederaAccountId,
        evmAddress,
        signerType: hederaSigner.constructor.name,
      });

      setAccountId(hederaAccountId);

      // Fetch the canonical EVM address from the mirror node.
      // toSolidityAddress() gives the long-form zero-padded address (0x000...006E60EE),
      // but msg.sender in EVM contracts is the aliased short-form evm_address.
      // We must use the mirror node address for correct contract storage reads.
      let canonicalEvmAddress = evmAddress;
      try {
        const mirrorRes = await fetch(
          `https://testnet.mirrornode.hedera.com/api/v1/accounts/${hederaAccountId}`
        );
        if (mirrorRes.ok) {
          const mirrorData = await mirrorRes.json();
          if (mirrorData.evm_address) {
            canonicalEvmAddress = ethers.getAddress(mirrorData.evm_address);
            console.log('✅ Canonical EVM address from mirror node:', canonicalEvmAddress);
          }
        }
      } catch (e) {
        console.warn('Could not fetch canonical EVM address, using toSolidityAddress fallback:', e.message);
      }
      setAccount(canonicalEvmAddress || hederaAccountId);

      // JSON-RPC relay provider for reads (always works)
      const hederaNetwork = new ethers.Network('Hedera Testnet', 296);
      const jsonRpcProvider = new ethers.JsonRpcProvider(
        HEDERA_TESTNET_CONFIG.rpcUrls[0],
        hederaNetwork,
        { staticNetwork: hederaNetwork }
      );
      setProvider(jsonRpcProvider);

      // Build a custom ethers AbstractSigner that routes write calls through
      // the Hedera WalletConnect DAppSigner via eth_sendRawTransaction.
      // The DAppSigner cannot be passed to ethers.Contract directly, but it
      // can sign raw transactions which we then broadcast via the JSON-RPC relay.
      const hederaEthSigner = new HederaEthSigner(hederaSigner, jsonRpcProvider, evmAddress);
      setSigner(hederaEthSigner);
      console.log('✅ HederaEthSigner ready');

    } catch (err) {
      console.error('❌ Connection handling error:', err);
      setError(err.message);
    }
  };

  // Connect wallet
  const connect = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      if (!isInitialized) {
        throw new Error('WalletConnect is still initializing. Please wait a moment...');
      }

      if (!dAppConnector) {
        throw new Error('WalletConnect not initialized. Please refresh the page.');
      }

      console.log('🔌 Opening connection modal...');

      // Open modal and wait for connection
      await dAppConnector.openModal();

      // After modal closes, check if we got a connection
      setTimeout(() => {
        if (dAppConnector.signers && dAppConnector.signers.length > 0) {
          console.log('✅ Connection successful, found signers:', dAppConnector.signers.length);
          handleConnection(dAppConnector.signers[0]);
        } else {
          console.log('⚠️ Modal closed but no signers found - user may have cancelled');
        }
        setIsConnecting(false);
      }, 1000);

    } catch (err) {
      console.error('❌ Connection error:', err);
      setError(err.message);
      setIsConnecting(false);
    }
  };

  // Disconnect wallet
  const disconnect = async () => {
    try {
      console.log('🔌 Disconnecting wallet...');
      
      if (dAppConnector) {
        await dAppConnector.disconnectAll();
      }

      setAccount(null);
      setAccountId(null);
      // Reset to read-only public provider so pages stay readable after disconnect
      const network = new ethers.Network('Hedera Testnet', 296);
      setProvider(new ethers.JsonRpcProvider(
        HEDERA_TESTNET_CONFIG.rpcUrls[0],
        network,
        { staticNetwork: network }
      ));
      setSigner(null);
      setError(null);
      
      console.log('✅ Wallet disconnected');
    } catch (err) {
      console.error('❌ Disconnect error:', err);
      setError(err.message);
    }
  };

  // Get signer for transactions
  const getSigner = () => {
    return signer;
  };

  // Execute a Hedera native transaction
  const executeTransaction = async (transaction) => {
    try {
      if (!signer) {
        throw new Error('No signer available. Please connect wallet first.');
      }

      console.log('📤 Executing transaction...');

      // Sign and execute using Hedera SDK
      const txResponse = await transaction.executeWithSigner(signer);
      const receipt = await txResponse.getReceipt(signer.getClient());
      
      console.log('✅ Transaction successful:', receipt.status.toString());
      return receipt;
    } catch (err) {
      console.error('❌ Transaction execution error:', err);
      throw err;
    }
  };

  // Execute smart contract read call
  const readContract = async (contractAddress, abi, method, args = []) => {
    try {
      const contract = new ethers.Contract(contractAddress, abi, provider);
      const result = await contract[method](...args);
      return result;
    } catch (err) {
      console.error('❌ Contract read error:', err);
      throw err;
    }
  };

  // Get display name
  const getDisplayName = () => {
    if (!account) return '';
    
    // Prefer Hedera account ID format
    if (accountId) {
      return accountId;
    }
    
    // Fallback to truncated EVM address
    if (account.startsWith('0x')) {
      return `${account.slice(0, 6)}...${account.slice(-4)}`;
    }
    
    return account;
  };

  const value = {
    // State
    account,
    accountId,
    provider,
    signer,
    isConnecting,
    error,
    isInitialized,
    dAppConnector,
    
    // Methods
    connect,
    disconnect,
    getSigner,
    executeTransaction,
    readContract,
    getDisplayName,
    
    // Helpers
    isConnected: !!account,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}

export default WalletContext;
