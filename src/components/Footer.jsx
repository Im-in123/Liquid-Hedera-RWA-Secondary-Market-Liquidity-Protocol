// src/components/Footer.jsx
import React from 'react';

function Footer() {
  return (
    <footer className="bg-dark-secondary border-t border-dark-tertiary pt-12 pb-8 mt-auto"> {/* Added mt-auto to push footer down */}
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold text-white">L</span>
              </div>
              <span className="text-xl font-bold text-white">
                Liquid Protocol
              </span>
            </div>
            <p className="text-muted text-sm leading-relaxed">
              Professional RWA tokenization and secondary market protocol on Hedera.
            </p>
          </div>

          {/* Links */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white text-lg mb-3">Protocol</h3>
            <div className="space-y-3">
              <a href="/marketplace" className="block text-muted hover:text-primary transition-colors text-sm">
                Marketplace
              </a>
              <a href="/pools" className="block text-muted hover:text-primary transition-colors text-sm">
                Liquidity Pools
              </a>
              <a href="/stake" className="block text-muted hover:text-primary transition-colors text-sm">
                Staking
              </a>
              <a href="/dashboard" className="block text-muted hover:text-primary transition-colors text-sm">
                Dashboard
              </a>
            </div>
          </div>

          {/* Resources */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white text-lg mb-3">Resources</h3>
            <div className="space-y-3">
              <a
                href="https://hashscan.io/testnet"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-muted hover:text-primary transition-colors text-sm"
              >
                Hashscan Explorer
              </a>
              <a
                href="https://docs.hedera.com"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-muted hover:text-primary transition-colors text-sm"
              >
                Hedera Docs
              </a>
              <a
                href="https://github.com/your-org/liquid-hedera" // IMPORTANT: Update with your actual repo link
                target="_blank"
                rel="noopener noreferrer"
                className="block text-muted hover:text-primary transition-colors text-sm"
              >
                GitHub
              </a>
              <a
                href="#" // Add link to your project documentation if available
                className="block text-muted hover:text-primary transition-colors text-sm"
              >
                Documentation
              </a>
            </div>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white text-lg mb-3">Legal</h3>
            <div className="space-y-3">
              <a href="#" className="block text-muted hover:text-primary transition-colors text-sm">
                Terms of Service
              </a>
              <a href="#" className="block text-muted hover:text-primary transition-colors text-sm">
                Privacy Policy
              </a>
              <a href="#" className="block text-muted hover:text-primary transition-colors text-sm">
                Disclaimer
              </a>
              <a href="#" className="block text-muted hover:text-primary transition-colors text-sm">
                Compliance
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-dark-tertiary mt-8 pt-6">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="text-muted text-sm">
              © 2026 Liquid Protocol. Built on Hedera Hashgraph.
            </div>
            <div className="text-muted text-sm">
              Hedera Hello Future Apex Hackathon 2026 • DeFi & Tokenization Track
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;