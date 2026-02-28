// =====================================================
// components/AnomalyAlerts.jsx - Anomaly Detection Panel
// =====================================================
// Displays energy consumption anomalies detected by
// Z-score analysis on DB readings.
//
// Shows:
//   - Alert count by severity (HIGH / MEDIUM)
//   - Timeline of recent anomalies
//   - Z-score bar per alert
//   - Auto-refreshes every 60 seconds
// =====================================================

import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import { getAnomalies } from "../services/api";

const AnomalyAlerts = () => {
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [scannedAt, setScannedAt] = useState(null);
  const [error, setError]         = useState(null);

  const fetchAnomalies = async () => {
    setLoading(true);
    try {
      const res = await getAnomalies(50);
      setAnomalies(res.data.anomalies || []);
      setScannedAt(res.data.scanned_at);
      setError(null);
    } catch (err) {
      setError("Failed to fetch anomalies.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 60000);
    return () => clearInterval(interval);
  }, []);

  // Count by severity
  const high   = anomalies.filter((a) => a.severity === "HIGH").length;
  const medium = anomalies.filter((a) => a.severity === "MEDIUM").length;

  // Chart data: last 20 anomalies by z-score
  const chartData = anomalies.slice(0, 20).map((a, i) => ({
    index  : i + 1,
    z_score: parseFloat(a.z_score?.toFixed(2)) || 0,
    power  : parseFloat(a.active_power?.toFixed(4)) || 0,
  }));

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🚨 Anomaly Detection</h1>
          <p style={styles.subtitle}>
            Z-score based anomaly detection on energy readings.
            Readings beyond {2.5} standard deviations from mean are flagged.
            Auto-refreshes every 60 seconds.
          </p>
        </div>
        <button onClick={fetchAnomalies} style={styles.refreshBtn}>🔄 Scan Now</button>
      </div>

      {error && <div style={styles.errorBanner}>⚠️ {error}</div>}

      {/* Summary Stats */}
      <div style={styles.statsRow}>
        <div style={{ ...styles.statCard, borderColor: "#991b1b" }}>
          <span style={{ ...styles.statNum, color: "#ef4444" }}>{high}</span>
          <span style={styles.statLabel}>🔴 HIGH Severity</span>
          <span style={styles.statHint}>Z-score &gt; {2.5 * 1.5}</span>
        </div>
        <div style={{ ...styles.statCard, borderColor: "#92400e" }}>
          <span style={{ ...styles.statNum, color: "#f59e0b" }}>{medium}</span>
          <span style={styles.statLabel}>🟡 MEDIUM Severity</span>
          <span style={styles.statHint}>Z-score &gt; 2.5</span>
        </div>
        <div style={{ ...styles.statCard, borderColor: "#334155" }}>
          <span style={{ ...styles.statNum, color: "#94a3b8" }}>{anomalies.length}</span>
          <span style={styles.statLabel}>Total Detected</span>
          <span style={styles.statHint}>All time</span>
        </div>
        {scannedAt && (
          <div style={{ ...styles.statCard, borderColor: "#334155" }}>
            <span style={{ ...styles.statNum, color: "#38bdf8", fontSize: "14px" }}>
              {new Date(scannedAt).toLocaleTimeString()}
            </span>
            <span style={styles.statLabel}>Last Scan</span>
            <span style={styles.statHint}>{new Date(scannedAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {loading && <div style={styles.loadingBox}>⏳ Scanning for anomalies...</div>}

      {!loading && anomalies.length === 0 && (
        <div style={styles.noAnomalies}>
          ✅ No anomalies detected! Energy consumption looks normal.
          <p style={{ fontSize: "14px", color: "#475569", marginTop: "8px" }}>
            Make sure readings are being sent to POST /api/readings first.
          </p>
        </div>
      )}

      {/* Z-Score Chart */}
      {chartData.length > 0 && (
        <div style={styles.chartCard}>
          <h2 style={styles.chartTitle}>📊 Z-Score Distribution — Last 20 Anomalies</h2>
          <p style={styles.chartHint}>
            Higher Z-score = further from normal. Threshold is set at Z={2.5}.
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="index" tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Anomaly #", position: "insideBottom", fill: "#64748b", offset: -5 }} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155" }}
                formatter={(val, name) => [
                  name === "z_score" ? `${val} σ` : `${val} kW`,
                  name === "z_score" ? "Z-Score" : "Power"
                ]}
              />
              <Bar dataKey="z_score" fill="#ef4444" name="z_score" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Anomaly List */}
      {anomalies.length > 0 && (
        <div style={styles.listCard}>
          <h3 style={styles.listTitle}>📋 Anomaly Log ({anomalies.length} events)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Time", "Power (kW)", "Z-Score", "Severity", "Description"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: a.severity === "HIGH"
                        ? "#1c0a0a" : i % 2 === 0 ? "#1e293b" : "#0f172a"
                    }}
                  >
                    <td style={styles.td}>
                      {a.timestamp ? new Date(a.timestamp).toLocaleString() : "—"}
                    </td>
                    <td style={{ ...styles.td, color: "#38bdf8", fontWeight: "600" }}>
                      {a.active_power?.toFixed(4) ?? "—"}
                    </td>
                    <td style={{ ...styles.td, color: a.severity === "HIGH" ? "#ef4444" : "#f59e0b", fontWeight: "600" }}>
                      {a.z_score?.toFixed(2) ?? "—"} σ
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        padding        : "3px 10px",
                        borderRadius   : "12px",
                        fontSize       : "12px",
                        fontWeight     : "700",
                        backgroundColor: a.severity === "HIGH" ? "#450a0a" : "#1c1917",
                        color          : a.severity === "HIGH" ? "#ef4444" : "#f59e0b",
                        border         : `1px solid ${a.severity === "HIGH" ? "#991b1b" : "#92400e"}`
                      }}>
                        {a.severity === "HIGH" ? "🔴 HIGH" : "🟡 MEDIUM"}
                      </span>
                    </td>
                    <td style={{ ...styles.td, fontSize: "13px", maxWidth: "400px" }}>
                      {a.description ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  page:         { padding: "24px", maxWidth: "1400px", margin: "0 auto" },
  header:       { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", flexWrap: "wrap", gap: "16px" },
  title:        { fontSize: "28px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
  subtitle:     { color: "#64748b", fontSize: "14px", marginTop: "4px", maxWidth: "700px" },
  refreshBtn:   { padding: "10px 20px", backgroundColor: "#7c3aed", border: "none", borderRadius: "8px", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "600" },
  errorBanner:  { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fca5a5" },
  statsRow:     { display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" },
  statCard:     { backgroundColor: "#1e293b", border: "2px solid", borderRadius: "10px", padding: "16px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "4px", minWidth: "140px" },
  statNum:      { fontSize: "36px", fontWeight: "700" },
  statLabel:    { fontSize: "13px", color: "#94a3b8", fontWeight: "600" },
  statHint:     { fontSize: "11px", color: "#475569" },
  loadingBox:   { textAlign: "center", padding: "60px", color: "#64748b", fontSize: "18px" },
  noAnomalies:  { backgroundColor: "#052e16", border: "1px solid #166534", borderRadius: "12px", padding: "40px", textAlign: "center", color: "#86efac", fontSize: "18px", marginBottom: "16px" },
  chartCard:    { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155", marginBottom: "16px" },
  chartTitle:   { fontSize: "18px", fontWeight: "600", color: "#f1f5f9", marginBottom: "4px" },
  chartHint:    { fontSize: "13px", color: "#64748b", marginBottom: "16px" },
  listCard:     { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155" },
  listTitle:    { fontSize: "16px", fontWeight: "600", color: "#f1f5f9", marginBottom: "16px" },
  table:        { width: "100%", borderCollapse: "collapse" },
  th:           { padding: "10px 16px", textAlign: "left", fontSize: "12px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #334155" },
  td:           { padding: "10px 16px", fontSize: "14px", color: "#94a3b8", borderBottom: "1px solid #1e293b" },
};

export default AnomalyAlerts;