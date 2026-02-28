// =====================================================
// components/Navbar.jsx - Navigation Bar
// =====================================================
// Top navigation bar with logo, links, and backend
// connection status indicator (green/red dot).
// =====================================================

import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { healthCheck } from "../services/api";

const Navbar = () => {
  const location = useLocation();
  const [backendOnline, setBackendOnline] = useState(null); // null = checking

  // Check backend connectivity every 30 seconds
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await healthCheck();
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const navLinks = [
    { path: "/",          label: "Dashboard"  },
    { path: "/forecast",  label: "Forecast"   },
    { path: "/nilm",      label: "Appliances" },
    { path: "/anomalies", label: "Anomalies"  },
    { path: "/train",     label: "Train Models"},
  ];

  return (
    <nav style={styles.nav}>
      {/* Logo */}
      <div style={styles.logo}>
        <span style={styles.logoIcon}>⚡</span>
        <span style={styles.logoText}>AiPECO</span>
        <span style={styles.logoSub}>Energy Optimizer</span>
      </div>

      {/* Navigation Links */}
      <div style={styles.links}>
        {navLinks.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            style={{
              ...styles.link,
              ...(location.pathname === link.path ? styles.activeLink : {})
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {/* Backend Status Indicator */}
      <div style={styles.status}>
        <span
          style={{
            ...styles.statusDot,
            backgroundColor: backendOnline === null ? "#f59e0b"  // Yellow = checking
                           : backendOnline           ? "#22c55e"  // Green = online
                                                     : "#ef4444"  // Red = offline
          }}
        />
        <span style={styles.statusText}>
          {backendOnline === null ? "Checking..." : backendOnline ? "Backend Online" : "Backend Offline"}
        </span>
      </div>
    </nav>
  );
};

const styles = {
  nav: {
    display        : "flex",
    alignItems     : "center",
    justifyContent : "space-between",
    padding        : "12px 24px",
    backgroundColor: "#0f172a",
    borderBottom   : "1px solid #1e293b",
    position       : "sticky",
    top            : 0,
    zIndex         : 100,
  },
  logo: {
    display    : "flex",
    alignItems : "center",
    gap        : "8px",
  },
  logoIcon: {
    fontSize: "24px",
  },
  logoText: {
    fontSize  : "20px",
    fontWeight: "700",
    color     : "#38bdf8",
  },
  logoSub: {
    fontSize: "12px",
    color   : "#64748b",
    marginLeft: "4px",
  },
  links: {
    display: "flex",
    gap    : "4px",
  },
  link: {
    padding       : "8px 16px",
    borderRadius  : "6px",
    color         : "#94a3b8",
    textDecoration: "none",
    fontSize      : "14px",
    fontWeight    : "500",
    transition    : "all 0.2s",
  },
  activeLink: {
    backgroundColor: "#1e293b",
    color          : "#38bdf8",
  },
  status: {
    display   : "flex",
    alignItems: "center",
    gap       : "8px",
  },
  statusDot: {
    width       : "10px",
    height      : "10px",
    borderRadius: "50%",
    display     : "inline-block",
  },
  statusText: {
    fontSize: "13px",
    color   : "#64748b",
  },
};

export default Navbar;