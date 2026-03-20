// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { NotificationProvider } from './context/NotificationContext';
import { ToastProvider } from './components/Toast';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Marketplace from './pages/Marketplace';
import Trade from './pages/Trade';
import Pools from './pages/Pools';
import Stake from './pages/Stake';
import Dashboard from './pages/Dashboard';
import Faucet from './pages/Faucet';
import Compliance from './pages/Compliance';
import AuditLog from './pages/AuditLog';

// Helper to get initial theme from localStorage or system preference
const getInitialTheme = () => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme) return storedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function App() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return (
    <WalletProvider>
      <Router>
        <NotificationProvider>
        <ToastProvider>
        <div className="min-h-screen bg-dark text-white">
          <Navbar theme={theme} toggleTheme={toggleTheme} />
          <main className="container mx-auto px-4 py-8 min-h-[calc(100vh-64px)]">
            <Routes>
              <Route path="/"            element={<Home />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/trade/:poolId" element={<Trade />} />
              <Route path="/pools"       element={<Pools />} />
              <Route path="/stake"       element={<Stake />} />
              <Route path="/dashboard"   element={<Dashboard />} />
              <Route path="/faucet"      element={<Faucet />} />
              <Route path="/compliance"  element={<Compliance />} />
              <Route path="/audit"       element={<AuditLog />} />
            </Routes>
          </main>
          <Footer />
        </div>
        </ToastProvider>
        </NotificationProvider>
      </Router>
    </WalletProvider>
  );
}

export default App;
