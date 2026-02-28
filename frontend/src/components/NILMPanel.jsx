// =====================================================
// components/NILMPanel.jsx - Appliance State Panel
// =====================================================
// Shows real-time NILM predictions:
//   - ON/OFF state per appliance (with confidence %)
//   - Estimated power draw (W) and load factor
//   - Anomaly flags per appliance
//   - Summary: total detected power vs total reading
//   - Usage history timeline
// =====================================================

import React, { useState, useEffect } from "react";
import { getNILMPrediction, getNILMHistory } from "../services/api";

// Color theme per appliance
const APPLIANCE_COLORS = ["#38bdf8", "#a78bfa", "#fb923c", "#34d399"];

const NILMPanel = () => {
  const [prediction, setPrediction] = useState(null);
  const [history, setHistory]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNILM = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [predRes, histRes] = await Promise.all([
        getNILMPrediction(),
        getNILMHistory(15)
      ]);
      setPrediction(predRes.data);
      setHistory(histRes.data.history || []);
    } catch (err) {
      const msg = err.response?.data?.error || "NILM prediction failed";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNILM();
    // Auto-refresh every 30 seconds to get latest NILM state
    const interval = setInterval(fetchNILM, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={styles.center}>⏳ Running NILM analysis...</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🔌 Appliance State Detection (NILM)</h1>
          <p style={styles.subtitle}>
            Non-Intrusive Load Monitoring — Identifies individual appliance states from aggregate power signal.
            No extra sensors needed. Auto-refreshes every 30s.
          </p>
        </div>
        <button onClick={fetchNILM} disabled={refreshing} style={styles.refreshBtn}>
          {refreshing ? "⏳ Running..." : "🔄 Run NILM"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
          {error.includes("not trained") && (
            <span> → Go to <strong>Train Models</strong> page first.</span>
          )}
        </div>
      )}

      {prediction && (
        <>
          {/* Summary Stats */}
          <div style={styles.summaryRow}>
            <div style={styles.summaryCard}>
              <span style={styles.summaryBig}>{prediction.summary.appliances_on}</span>
              <span style={styles.summarySmall}>Appliances ON</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={styles.summaryBig}>{prediction.summary.appliances_off}</span>
              <span style={styles.summarySmall}>Appliances OFF</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={{ ...styles.summaryBig, color: "#38bdf8" }}>
                {prediction.summary.detected_power_w.toFixed(0)} W
              </span>
              <span style={styles.summarySmall}>Detected Power</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={{ ...styles.summaryBig, color: "#64748b" }}>
                {prediction.summary.undetected_power_w.toFixed(0)} W
              </span>
              <span style={styles.summarySmall}>Undetected (Other)</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={{ ...styles.summaryBig, color: "#a78bfa" }}>
                {(prediction.summary.total_power_kw * 1000).toFixed(0)} W
              </span>
              <span style={styles.summarySmall}>Total Measured</span>
            </div>
          </div>

          {/* Appliance Cards */}
          <div style={styles.applianceGrid}>
            {prediction.appliances.map((appl, idx) => {
              const isOn     = appl.status === "ON";
              const color    = APPLIANCE_COLORS[idx % APPLIANCE_COLORS.length];
              const loadPct  = Math.round(appl.load_factor * 100);

              return (
                <div
                  key={appl.name}
                  style={{
                    ...styles.applianceCard,
                    border: isOn
                      ? `2px solid ${color}`
                      : "2px solid #334155",
                    opacity: isOn ? 1 : 0.7
                  }}
                >
                  {/* Header */}
                  <div style={styles.applianceHeader}>
                    <span style={styles.applianceName}>{appl.name}</span>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: isOn ? color + "33" : "#334155",
                      color           : isOn ? color : "#64748b",
                      border          : `1px solid ${isOn ? color : "#334155"}`
                    }}>
                      {isOn ? "● ON" : "○ OFF"}
                    </span>
                  </div>

                  {/* Anomaly Warning */}
                  {appl.anomaly?.is_anomaly && (
                    <div style={styles.anomalyBadge}>
                      🚨 {appl.anomaly.reason}
                    </div>
                  )}

                  {/* Metrics Grid */}
                  <div style={styles.metricsGrid}>
                    <div style={styles.metricBox}>
                      <span style={{ ...styles.metricVal, color }}>
                        {appl.power_w.toFixed(1)} W
                      </span>
                      <span style={styles.metricLbl}>Current Draw</span>
                    </div>
                    <div style={styles.metricBox}>
                      <span style={styles.metricVal}>{appl.rated_power_w} W</span>
                      <span style={styles.metricLbl}>Rated Power</span>
                    </div>
                    <div style={styles.metricBox}>
                      <span style={{ ...styles.metricVal, color: loadPct > 80 ? "#ef4444" : "#94a3b8" }}>
                        {loadPct}%
                      </span>
                      <span style={styles.metricLbl}>Load Factor</span>
                    </div>
                    <div style={styles.metricBox}>
                      <span style={styles.metricVal}>
                        {(appl.confidence * 100).toFixed(1)}%
                      </span>
                      <span style={styles.metricLbl}>Confidence</span>
                    </div>
                  </div>

                  {/* Power bar */}
                  {isOn && (
                    <div style={styles.powerBar}>
                      <div
                        style={{
                          ...styles.powerBarFill,
                          width          : `${Math.min(loadPct, 100)}%`,
                          backgroundColor: loadPct > 80 ? "#ef4444" : color,
                        }}
                      />
                    </div>
                  )}

                  {/* Confidence bar */}
                  <div style={styles.confidenceRow}>
                    <span style={styles.confidenceLbl}>NILM Confidence</span>
                    <div style={styles.confidenceBar}>
                      <div style={{
                        ...styles.confidenceFill,
                        width: `${appl.confidence * 100}%`,
                        backgroundColor: appl.confidence > 0.8 ? "#22c55e" : appl.confidence > 0.5 ? "#f59e0b" : "#ef4444"
                      }} />
                    </div>
                    <span style={styles.confidencePct}>{(appl.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reading used for this prediction */}
          <div style={styles.infoCard}>
            <strong>📡 Sensor values used for this prediction:</strong>
            {Object.entries(prediction.reading_used || {}).map(([k, v]) => (
              <span key={k} style={styles.readingChip}>
                {k}: <strong>{typeof v === "number" ? v.toFixed(4) : v}</strong>
              </span>
            ))}
            <span style={{ float: "right", color: "#475569" }}>
              {prediction.timestamp ? new Date(prediction.timestamp).toLocaleTimeString() : ""}
            </span>
          </div>

          {/* History Table */}
          {history.length > 0 && (
            <div style={styles.historyCard}>
              <h3 style={styles.historyTitle}>📜 Recent NILM History ({history.length} records)</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Time</th>
                      <th style={styles.th}>Appliances ON</th>
                      <th style={styles.th}>Detected Power</th>
                      <th style={styles.th}>Total Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((record, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>
                        <td style={styles.td}>
                          {record.timestamp ? new Date(record.timestamp).toLocaleString() : "—"}
                        </td>
                        <td style={{ ...styles.td, color: "#38bdf8" }}>
                          {record.summary?.appliances_on ?? "—"} / {record.summary?.total_appliances ?? "—"}
                        </td>
                        <td style={styles.td}>
                          {record.summary?.detected_power_w?.toFixed(0) ?? "—"} W
                        </td>
                        <td style={styles.td}>
                          {record.summary?.total_power_kw
                            ? `${(record.summary.total_power_kw * 1000).toFixed(0)} W`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const styles = {
  page:           { padding: "24px", maxWidth: "1400px", margin: "0 auto" },
  header:         { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", flexWrap: "wrap", gap: "16px" },
  title:          { fontSize: "28px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
  subtitle:       { color: "#64748b", fontSize: "14px", marginTop: "4px", maxWidth: "700px" },
  refreshBtn:     { padding: "10px 20px", backgroundColor: "#0284c7", border: "none", borderRadius: "8px", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "600" },
  errorBanner:    { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fca5a5" },
  summaryRow:     { display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" },
  summaryCard:    { backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "10px", padding: "16px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "4px", minWidth: "120px" },
  summaryBig:     { fontSize: "28px", fontWeight: "700", color: "#f1f5f9" },
  summarySmall:   { fontSize: "12px", color: "#64748b", textTransform: "uppercase" },
  applianceGrid:  { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px", marginBottom: "24px" },
  applianceCard:  { backgroundColor: "#1e293b", borderRadius: "12px", padding: "20px", transition: "all 0.3s" },
  applianceHeader:{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" },
  applianceName:  { fontSize: "15px", fontWeight: "600", color: "#f1f5f9" },
  statusBadge:    { padding: "4px 12px", borderRadius: "20px", fontSize: "13px", fontWeight: "700" },
  anomalyBadge:   { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "6px", padding: "8px", marginBottom: "12px", color: "#fca5a5", fontSize: "12px" },
  metricsGrid:    { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" },
  metricBox:      { backgroundColor: "#0f172a", borderRadius: "6px", padding: "8px", textAlign: "center" },
  metricVal:      { display: "block", fontSize: "16px", fontWeight: "700", color: "#94a3b8" },
  metricLbl:      { display: "block", fontSize: "10px", color: "#475569", textTransform: "uppercase", marginTop: "2px" },
  powerBar:       { height: "6px", backgroundColor: "#0f172a", borderRadius: "3px", marginBottom: "10px", overflow: "hidden" },
  powerBarFill:   { height: "100%", borderRadius: "3px", transition: "width 0.5s" },
  confidenceRow:  { display: "flex", alignItems: "center", gap: "8px" },
  confidenceLbl:  { fontSize: "10px", color: "#475569", textTransform: "uppercase", whiteSpace: "nowrap" },
  confidenceBar:  { flex: 1, height: "4px", backgroundColor: "#0f172a", borderRadius: "2px", overflow: "hidden" },
  confidenceFill: { height: "100%", borderRadius: "2px", transition: "width 0.5s" },
  confidencePct:  { fontSize: "11px", color: "#64748b", minWidth: "35px", textAlign: "right" },
  infoCard:       { backgroundColor: "#1e293b", borderRadius: "8px", padding: "12px 16px", color: "#94a3b8", fontSize: "13px", marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
  readingChip:    { backgroundColor: "#0f172a", borderRadius: "6px", padding: "4px 10px", color: "#64748b", fontSize: "12px" },
  historyCard:    { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155" },
  historyTitle:   { fontSize: "16px", fontWeight: "600", color: "#f1f5f9", marginBottom: "16px" },
  table:          { width: "100%", borderCollapse: "collapse" },
  th:             { padding: "10px 16px", textAlign: "left", fontSize: "12px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #334155" },
  td:             { padding: "10px 16px", fontSize: "14px", color: "#94a3b8" },
  center:         { display: "flex", justifyContent: "center", alignItems: "center", height: "50vh", color: "#64748b", fontSize: "18px" },
};

export default NILMPanel;