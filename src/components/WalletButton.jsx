// src/components/WalletButton.jsx - FIXED VERSION
import React from 'react';
import { useWallet } from '../context/WalletContext';

export default function WalletButton() {
  const { 
    isConnected, 
    isConnecting, 
    isInitialized,
    getDisplayName, 
    connect, 
    disconnect,
    error 
  } = useWallet();

  // Show initialization state
  if (!isInitialized) {
    return (
      <div className="px-4 py-2 bg-gray-700 rounded-lg border border-gray-600 animate-pulse">
        <span className="text-sm text-gray-400">
          Initializing...
        </span>
      </div>
    );
  }

  // Connected state
  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-gray-300">
              {getDisplayName()}
            </span>
          </div>
        </div>
        <button
          onClick={disconnect}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium text-white transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // Disconnected state
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={connect}
        disabled={isConnecting || !isInitialized}
        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 rounded-lg font-semibold text-white transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
      >
        {isConnecting ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle 
                className="opacity-25" 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="4" 
                fill="none" 
              />
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" 
              />
            </svg>
            Connecting...
          </span>
        ) : (
          'Connect Wallet'
        )}
      </button>
      
      {error && (
        <div className="max-w-xs text-right">
          <span className="text-xs text-red-400 block">
            {error}
          </span>
          {error.includes('Project ID') && (
            <a 
              href="https://cloud.reown.com/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Get Project ID
            </a>
          )}
        </div>
      )}
    </div>
  );
}
