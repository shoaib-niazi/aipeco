// =====================================================
// components/TrainModels.jsx - Model Training Page
// =====================================================
// Lets the user trigger training for both LSTM and NILM
// models directly from the UI.
//
// Shows:
//   - Training status (trained / not trained)
//   - "Train Now" button (calls POST /api/train)
//   - Real-time training progress log
//   - Post-training metrics (MAE, RMSE, per-appliance)
// =====================================================

import React, { useState, useEffect } from "react";
import { trainModels, getModelStatus } from "../services/api";

const TrainModels = () => {
  const [status, setStatus]     = useState(null);
  const [training, setTraining] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [log, setLog]           = useState([]);

  // Append a message to the training log
  const addLog = (msg) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, `[${ts}] ${msg}`]);
  };

  useEffect(() => {
    // Load current model status on page open
    getModelStatus().then((res) => setStatus(res.data)).catch(() => {});
  }, []);

  const handleTrain = async () => {
    setTraining(true);
    setResult(null);
    setError(null);
    setLog([]);

    addLog("🚀 Starting training pipeline...");
    addLog("📂 Loading UCI Household Power Consumption dataset (first 20,000 rows)...");
    addLog("🔌 Scaling features to 0-5V range for ESP32 ADC compatibility...");
    addLog("📊 Creating LSTM training sequences (window size: 60 steps)...");
    addLog("🧠 Training LSTM energy forecasting model (may take 1-5 minutes)...");

    try {
      const res = await trainModels();
      const data = res.data;

      addLog(`✅ LSTM training complete! MAE: ${data.lstm_metrics?.mae} kW, RMSE: ${data.lstm_metrics?.rmse} kW`);
      addLog(`   Epochs run: ${data.lstm_metrics?.epochs_run}`);
      addLog("🔌 Generating NILM appliance labels from sub-metering data...");
      addLog("🧠 Training NILM multi-output model (ON/OFF + power estimation)...");
      addLog(`✅ NILM training complete! ${data.nilm_metrics?.n_appliances} appliances detected.`);
      addLog("💾 Models saved to disk (saved_models/ directory)...");
      addLog("✅ All done! Models are ready for inference.");

      setResult(data);

      // Refresh status
      const statusRes = await getModelStatus();
      setStatus(statusRes.data);

    } catch (err) {
      const msg = err.response?.data?.error || err.message || "Training failed";
      const hint = err.response?.data?.hint || "";
      addLog(`❌ ERROR: ${msg}`);
      if (hint) addLog(`💡 Hint: ${hint}`);
      setError(msg + (hint ? ` — ${hint}` : ""));
    } finally {
      setTraining(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>🤖 Train ML Models</h1>
        <p style={styles.subtitle}>
          Trains LSTM (energy forecasting) and NILM (appliance detection) models
          on the UCI Household Power Consumption dataset — first 20,000 rows.
          Data is scaled to 0-5V for IoT prototype compatibility.
        </p>
      </div>

      {/* Dataset Requirements */}
      <div style={styles.infoCard}>
        <h3 style={styles.infoTitle}>📋 Before Training — Dataset Setup</h3>
        <p style={styles.infoText}>
          Download the UCI Household Electric Power Consumption dataset and place it at:
        </p>
        <code style={styles.codeBlock}>
          backend/data/household_power_consumption.txt
        </code>
        <p style={styles.infoText}>
          Download from:{" "}
          <a
            href="https://archive.ics.uci.edu/ml/datasets/Individual+household+electric+power+consumption"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#38bdf8" }}
          >
            UCI ML Repository
          </a>
        </p>
      </div>

      {/* Current Status */}
      {status && (
        <div style={styles.statusCard}>
          <h3 style={styles.statusTitle}>📊 Current Model Status</h3>
          <div style={styles.statusGrid}>
            <StatusBadge label="LSTM Forecaster" trained={status.lstm_trained} />
            <StatusBadge label="NILM Detector"   trained={status.nilm_trained} />
          </div>
          {status.trained_at && (
            <p style={styles.statusHint}>
              Last trained: {new Date(status.trained_at).toLocaleString()}
            </p>
          )}
          {status.lstm_metrics && (
            <div style={styles.metricsRow}>
              <span>LSTM — MAE: <strong style={{ color: "#38bdf8" }}>{status.lstm_metrics.mae} kW</strong></span>
              <span>RMSE: <strong style={{ color: "#a78bfa" }}>{status.lstm_metrics.rmse} kW</strong></span>
              <span>Epochs: <strong>{status.lstm_metrics.epochs_run}</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Train Button */}
      <div style={styles.trainSection}>
        <button
          onClick={handleTrain}
          disabled={training}
          style={{ ...styles.trainBtn, opacity: training ? 0.7 : 1, cursor: training ? "not-allowed" : "pointer" }}
        >
          {training ? "⏳ Training in progress... (do not close this page)" : "🚀 Train Both Models Now"}
        </button>
        <p style={styles.trainHint}>
          Training on 20,000 rows typically takes 1–5 minutes depending on hardware.
          LSTM uses 20 epochs, NILM uses 15 epochs with early stopping.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={styles.errorBanner}>
          ❌ Training Error: {error}
        </div>
      )}

      {/* Training Log */}
      {log.length > 0 && (
        <div style={styles.logCard}>
          <h3 style={styles.logTitle}>📝 Training Log</h3>
          <div style={styles.logBox}>
            {log.map((line, i) => (
              <div key={i} style={{
                ...styles.logLine,
                color: line.includes("❌") ? "#ef4444"
                     : line.includes("✅") ? "#22c55e"
                     : line.includes("⏳") || line.includes("🚀") ? "#38bdf8"
                     : "#94a3b8"
              }}>
                {line}
              </div>
            ))}
            {training && <div style={{ ...styles.logLine, color: "#f59e0b" }}>⏳ Training in progress...</div>}
          </div>
        </div>
      )}

      {/* Training Results */}
      {result && (
        <div style={styles.resultsCard}>
          <h3 style={styles.resultsTitle}>🎉 Training Complete!</h3>

          {/* LSTM Results */}
          <h4 style={styles.sectionTitle}>📈 LSTM Forecasting Model</h4>
          <div style={styles.metricsGrid}>
            {[
              { label: "MAE",   value: `${result.lstm_metrics?.mae} kW`,  hint: "Mean Absolute Error — lower is better" },
              { label: "RMSE",  value: `${result.lstm_metrics?.rmse} kW`, hint: "Root Mean Square Error" },
              { label: "Epochs", value: result.lstm_metrics?.epochs_run,  hint: "Training epochs completed" },
            ].map((m) => (
              <div key={m.label} style={styles.metricCard} title={m.hint}>
                <span style={styles.metricVal}>{m.value}</span>
                <span style={styles.metricLabel}>{m.label}</span>
              </div>
            ))}
          </div>

          {/* NILM Results */}
          <h4 style={styles.sectionTitle}>🔌 NILM Appliance Detection Model</h4>
          {result.nilm_metrics?.appliance_metrics && (
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Appliance", "Accuracy", "Precision", "Recall", "F1", "Power MAE (W)"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.nilm_metrics.appliance_metrics).map(([name, m], i) => (
                  <tr key={name} style={{ backgroundColor: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>
                    <td style={{ ...styles.td, fontWeight: "600", color: "#f1f5f9" }}>{name}</td>
                    <td style={{ ...styles.td, color: m.accuracy > 0.8 ? "#22c55e" : "#f59e0b" }}>
                      {(m.accuracy * 100).toFixed(1)}%
                    </td>
                    <td style={styles.td}>{(m.precision * 100).toFixed(1)}%</td>
                    <td style={styles.td}>{(m.recall * 100).toFixed(1)}%</td>
                    <td style={styles.td}>{(m.f1 * 100).toFixed(1)}%</td>
                    <td style={styles.td}>{m.power_mae_w} W</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// Small reusable badge component
const StatusBadge = ({ label, trained }) => (
  <div style={{
    display        : "flex",
    alignItems     : "center",
    gap            : "10px",
    backgroundColor: trained ? "#052e16" : "#1c1917",
    border         : `1px solid ${trained ? "#166534" : "#92400e"}`,
    borderRadius   : "8px",
    padding        : "10px 16px",
  }}>
    <span style={{ fontSize: "20px" }}>{trained ? "✅" : "❌"}</span>
    <div>
      <div style={{ fontSize: "14px", fontWeight: "600", color: "#f1f5f9" }}>{label}</div>
      <div style={{ fontSize: "12px", color: trained ? "#86efac" : "#fcd34d" }}>
        {trained ? "Trained & Ready" : "Not trained yet"}
      </div>
    </div>
  </div>
);

const styles = {
  page:         { padding: "24px", maxWidth: "1000px", margin: "0 auto" },
  header:       { marginBottom: "24px" },
  title:        { fontSize: "28px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
  subtitle:     { color: "#64748b", fontSize: "14px", marginTop: "8px", lineHeight: "1.6" },
  infoCard:     { backgroundColor: "#172554", border: "1px solid #1e40af", borderRadius: "12px", padding: "20px", marginBottom: "20px" },
  infoTitle:    { fontSize: "16px", fontWeight: "600", color: "#bfdbfe", marginBottom: "8px" },
  infoText:     { color: "#93c5fd", fontSize: "14px", marginBottom: "8px" },
  codeBlock:    { display: "block", backgroundColor: "#0f172a", borderRadius: "6px", padding: "8px 12px", color: "#38bdf8", fontSize: "13px", fontFamily: "monospace", margin: "8px 0" },
  statusCard:   { backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "20px", marginBottom: "20px" },
  statusTitle:  { fontSize: "16px", fontWeight: "600", color: "#f1f5f9", marginBottom: "12px" },
  statusGrid:   { display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" },
  statusHint:   { color: "#64748b", fontSize: "13px" },
  metricsRow:   { display: "flex", gap: "24px", color: "#94a3b8", fontSize: "14px", flexWrap: "wrap" },
  trainSection: { textAlign: "center", marginBottom: "24px" },
  trainBtn:     { padding: "16px 40px", backgroundColor: "#0284c7", border: "none", borderRadius: "10px", color: "#fff", fontSize: "16px", fontWeight: "700", transition: "opacity 0.2s" },
  trainHint:    { color: "#64748b", fontSize: "13px", marginTop: "8px" },
  errorBanner:  { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fca5a5" },
  logCard:      { backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "12px", padding: "20px", marginBottom: "20px" },
  logTitle:     { fontSize: "14px", fontWeight: "600", color: "#64748b", marginBottom: "12px" },
  logBox:       { maxHeight: "300px", overflowY: "auto", fontFamily: "monospace", fontSize: "13px" },
  logLine:      { padding: "3px 0", lineHeight: "1.6" },
  resultsCard:  { backgroundColor: "#1e293b", border: "1px solid #166534", borderRadius: "12px", padding: "24px" },
  resultsTitle: { fontSize: "20px", fontWeight: "700", color: "#86efac", marginBottom: "20px" },
  sectionTitle: { fontSize: "15px", fontWeight: "600", color: "#94a3b8", marginBottom: "12px", marginTop: "16px" },
  metricsGrid:  { display: "flex", gap: "12px", marginBottom: "12px", flexWrap: "wrap" },
  metricCard:   { backgroundColor: "#0f172a", borderRadius: "8px", padding: "12px 20px", textAlign: "center", minWidth: "100px" },
  metricVal:    { display: "block", fontSize: "18px", fontWeight: "700", color: "#38bdf8" },
  metricLabel:  { display: "block", fontSize: "11px", color: "#64748b", textTransform: "uppercase", marginTop: "4px" },
  table:        { width: "100%", borderCollapse: "collapse" },
  th:           { padding: "10px 16px", textAlign: "left", fontSize: "12px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #334155" },
  td:           { padding: "10px 16px", fontSize: "14px", color: "#94a3b8" },
};

export default TrainModels;