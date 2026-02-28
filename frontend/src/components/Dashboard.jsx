// =====================================================
// components/Dashboard.jsx - Main Dashboard
// =====================================================
// Shows:
//   - Live energy metrics (power, voltage, current, temp)
//   - Real-time line chart of recent readings (last 50)
//   - Quick stats: appliances ON, anomaly count
//   - Auto-refreshes every 10 seconds
// =====================================================

import React, { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { getReadings, getModelStatus } from "../services/api";

// Format ISO timestamp → HH:MM:SS for chart x-axis
const formatTime = (ts) => {
  if (!ts) return "";
  try { return new Date(ts).toLocaleTimeString(); }
  catch { return ts; }
};

const Dashboard = () => {
  const [readings, setReadings]       = useState([]);
  const [modelStatus, setModelStatus] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch latest readings from Flask backend
  const fetchData = useCallback(async () => {
    try {
      const [readingsRes, statusRes] = await Promise.all([
        getReadings(50),
        getModelStatus()
      ]);

      // Reverse to show oldest → newest on chart
      setReadings([...readingsRes.data.readings].reverse());
      setModelStatus(statusRes.data);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError("Could not connect to backend. Is Flask running on port 5000?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Latest reading for the stat cards
  const latest = readings.length > 0 ? readings[readings.length - 1] : null;

  // Stat card data
  const stats = [
    {
      label  : "Active Power",
      value  : latest ? `${(latest.active_power || 0).toFixed(3)} kW` : "—",
      icon   : "⚡",
      color  : "#38bdf8",
      hint   : "Current household power draw"
    },
    {
      label  : "Voltage",
      value  : latest ? `${(latest.voltage || 0).toFixed(1)} V` : "—",
      icon   : "🔋",
      color  : "#a78bfa",
      hint   : "Mains supply voltage"
    },
    {
      label  : "Current",
      value  : latest ? `${(latest.current || 0).toFixed(2)} A` : "—",
      icon   : "🌀",
      color  : "#34d399",
      hint   : "Total current draw"
    },
    {
      label  : "Temperature",
      value  : latest ? `${(latest.temperature || 0).toFixed(1)} °C` : "—",
      icon   : "🌡️",
      color  : "#fb923c",
      hint   : "Ambient room temperature"
    },
    {
      label  : "Humidity",
      value  : latest ? `${(latest.humidity || 0).toFixed(1)} %` : "—",
      icon   : "💧",
      color  : "#60a5fa",
      hint   : "Relative humidity"
    },
    {
      label  : "Models Ready",
      value  : modelStatus?.lstm_trained && modelStatus?.nilm_trained ? "✅ Yes" : "❌ No",
      icon   : "🤖",
      color  : modelStatus?.lstm_trained ? "#22c55e" : "#ef4444",
      hint   : "LSTM + NILM training status"
    },
  ];

  if (loading) return <div style={styles.center}>⏳ Loading dashboard...</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Energy Dashboard</h1>
          <p style={styles.subtitle}>
            Live readings from ESP32 sensors • 0-5V scaled for IoT prototype
            {lastUpdated && ` • Updated: ${lastUpdated}`}
          </p>
        </div>
        <button onClick={fetchData} style={styles.refreshBtn}>🔄 Refresh</button>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
        </div>
      )}

      {/* Model Status Banner */}
      {modelStatus && !modelStatus.lstm_trained && (
        <div style={styles.warningBanner}>
          🤖 Models not trained yet. Go to <strong>Train Models</strong> page to get started.
        </div>
      )}

      {/* Stat Cards */}
      <div style={styles.statsGrid}>
        {stats.map((stat) => (
          <div key={stat.label} style={styles.statCard} title={stat.hint}>
            <div style={styles.statIcon}>{stat.icon}</div>
            <div style={styles.statValue} style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div style={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Real-time Power Chart */}
      <div style={styles.chartCard}>
        <h2 style={styles.chartTitle}>
          ⚡ Live Power Consumption — Last {readings.length} readings
        </h2>
        <p style={styles.chartHint}>
          Showing active power (kW) over time. Data is scaled to 0-5V for ESP32 ADC compatibility.
        </p>

        {readings.length === 0 ? (
          <div style={styles.noData}>
            No readings yet. Send sensor data via POST /api/readings to see chart.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={readings} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                tick={{ fill: "#64748b", fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit=" kW" />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(val) => [`${val?.toFixed(4)} kW`, "Power"]}
                labelFormatter={formatTime}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="active_power"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                name="Active Power (kW)"
              />
              {/* Sub-metering lines if available */}
              <Line
                type="monotone"
                dataKey="sub1"
                stroke="#a78bfa"
                strokeWidth={1}
                dot={false}
                name="Kitchen (Wh)"
                strokeDasharray="4 2"
              />
              <Line
                type="monotone"
                dataKey="sub2"
                stroke="#34d399"
                strokeWidth={1}
                dot={false}
                name="Laundry (Wh)"
                strokeDasharray="4 2"
              />
              <Line
                type="monotone"
                dataKey="sub3"
                stroke="#fb923c"
                strokeWidth={1}
                dot={false}
                name="Water Heater (Wh)"
                strokeDasharray="4 2"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Last Training Info */}
      {modelStatus?.trained_at && (
        <div style={styles.infoCard}>
          <strong>🤖 Models last trained:</strong> {new Date(modelStatus.trained_at).toLocaleString()}
          {modelStatus.lstm_metrics && (
            <span style={{ marginLeft: "16px" }}>
              LSTM MAE: <strong>{modelStatus.lstm_metrics.mae} kW</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  page:          { padding: "24px", maxWidth: "1400px", margin: "0 auto" },
  header:        { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" },
  title:         { fontSize: "28px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
  subtitle:      { color: "#64748b", fontSize: "14px", marginTop: "4px" },
  refreshBtn:    { padding: "8px 16px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#94a3b8", cursor: "pointer", fontSize: "14px" },
  statsGrid:     { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" },
  statCard:      { backgroundColor: "#1e293b", borderRadius: "12px", padding: "20px", textAlign: "center", border: "1px solid #334155", cursor: "help" },
  statIcon:      { fontSize: "28px", marginBottom: "8px" },
  statValue:     { fontSize: "22px", fontWeight: "700", marginBottom: "4px" },
  statLabel:     { fontSize: "12px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" },
  chartCard:     { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155", marginBottom: "16px" },
  chartTitle:    { fontSize: "18px", fontWeight: "600", color: "#f1f5f9", marginBottom: "4px" },
  chartHint:     { fontSize: "13px", color: "#64748b", marginBottom: "16px" },
  noData:        { textAlign: "center", color: "#64748b", padding: "40px", fontSize: "14px" },
  errorBanner:   { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fca5a5" },
  warningBanner: { backgroundColor: "#1c1917", border: "1px solid #92400e", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fcd34d" },
  infoCard:      { backgroundColor: "#1e293b", borderRadius: "8px", padding: "12px 16px", color: "#94a3b8", fontSize: "14px" },
  center:        { display: "flex", justifyContent: "center", alignItems: "center", height: "50vh", color: "#64748b", fontSize: "18px" },
};

export default Dashboard;