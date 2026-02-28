// =====================================================
// components/ForecastChart.jsx - LSTM 7-Day Forecast
// =====================================================
// Displays the LSTM energy consumption forecast for
// the next 7 days as a bar + line chart.
//
// Also shows forecast accuracy from training metrics.
// =====================================================

import React, { useState, useEffect } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { getForecast, getModelStatus } from "../services/api";

const ForecastChart = () => {
  const [forecast, setForecast]         = useState(null);
  const [modelStatus, setModelStatus]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [selectedDays, setSelectedDays] = useState(7);

  const fetchForecast = async (days) => {
    setLoading(true);
    setError(null);
    try {
      const [forecastRes, statusRes] = await Promise.all([
        getForecast(days),
        getModelStatus()
      ]);
      setForecast(forecastRes.data);
      setModelStatus(statusRes.data);
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to fetch forecast";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchForecast(selectedDays); }, [selectedDays]);

  // Build chart data from forecast response
  const chartData = forecast
    ? forecast.dates.map((date, i) => ({
        date   : new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        energy : parseFloat(forecast.forecast[i]?.toFixed(3)),
      }))
    : [];

  // Summary stats
  const total   = chartData.reduce((s, d) => s + d.energy, 0);
  const peak    = Math.max(...chartData.map((d) => d.energy));
  const average = chartData.length ? total / chartData.length : 0;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>📈 LSTM Energy Forecast</h1>
          <p style={styles.subtitle}>
            Predicted household energy consumption using LSTM neural network (UCI dataset, first 20k rows)
          </p>
        </div>

        {/* Day selector */}
        <div style={styles.daySelector}>
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDays(d)}
              style={{
                ...styles.dayBtn,
                ...(selectedDays === d ? styles.dayBtnActive : {})
              }}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* LSTM Metrics Banner */}
      {modelStatus?.lstm_metrics && (
        <div style={styles.metricsBanner}>
          <span>🤖 LSTM Model Performance:</span>
          <span style={styles.metric}>MAE: <strong>{modelStatus.lstm_metrics.mae} kW</strong></span>
          <span style={styles.metric}>RMSE: <strong>{modelStatus.lstm_metrics.rmse} kW</strong></span>
          <span style={styles.metric}>Trained: <strong>{new Date(modelStatus.trained_at).toLocaleDateString()}</strong></span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
          {!modelStatus?.lstm_trained && (
            <span> — Train models first on the <strong>Train Models</strong> page.</span>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <div style={styles.loadingBox}>⏳ Generating forecast...</div>}

      {/* Summary Cards */}
      {!loading && forecast && (
        <>
          <div style={styles.summaryGrid}>
            {[
              { label: "Total Forecast",   value: `${total.toFixed(2)} kWh`,     icon: "📊", color: "#38bdf8" },
              { label: "Daily Average",    value: `${average.toFixed(2)} kWh`,   icon: "📅", color: "#a78bfa" },
              { label: "Peak Day",         value: `${peak.toFixed(2)} kWh`,      icon: "⚠️", color: "#fb923c" },
              { label: "Forecast Period",  value: `${selectedDays} days`,        icon: "📆", color: "#34d399" },
            ].map((s) => (
              <div key={s.label} style={styles.summaryCard}>
                <span style={styles.summaryIcon}>{s.icon}</span>
                <span style={{ color: s.color, fontSize: "20px", fontWeight: "700" }}>{s.value}</span>
                <span style={styles.summaryLabel}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Forecast Chart */}
          <div style={styles.chartCard}>
            <h2 style={styles.chartTitle}>
              Predicted Energy Consumption — Next {selectedDays} Days (kWh/day)
            </h2>
            <p style={styles.chartHint}>
              Auto-regressive LSTM prediction: each day's forecast is fed back as input for the next day.
              Sequence length: {60} past time steps per prediction.
            </p>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 12 }} unit=" kWh" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155" }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(val) => [`${val} kWh`, "Predicted"]}
                />
                <Legend />
                <Bar
                  dataKey="energy"
                  fill="#1e40af"
                  name="Predicted Energy (kWh)"
                  radius={[4, 4, 0, 0]}
                  opacity={0.8}
                />
                <Line
                  type="monotone"
                  dataKey="energy"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ fill: "#38bdf8", r: 4 }}
                  name="Trend"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Forecast Table */}
          <div style={styles.tableCard}>
            <h3 style={styles.tableTitle}>📋 Daily Breakdown</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Day", "Date", "Predicted (kWh)", "vs Average", "Risk Level"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => {
                  const diff    = row.energy - average;
                  const pct     = average > 0 ? ((diff / average) * 100).toFixed(1) : 0;
                  const risk    = row.energy > peak * 0.9 ? "🔴 High"
                                : row.energy > average   ? "🟡 Medium"
                                :                          "🟢 Low";
                  return (
                    <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>
                      <td style={styles.td}>Day {i + 1}</td>
                      <td style={styles.td}>{row.date}</td>
                      <td style={{ ...styles.td, color: "#38bdf8", fontWeight: "600" }}>{row.energy} kWh</td>
                      <td style={{ ...styles.td, color: diff >= 0 ? "#fb923c" : "#34d399" }}>
                        {diff >= 0 ? "+" : ""}{pct}%
                      </td>
                      <td style={styles.td}>{risk}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {forecast.generated_at && (
            <p style={styles.timestamp}>
              Forecast generated at: {new Date(forecast.generated_at).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
};

const styles = {
  page:          { padding: "24px", maxWidth: "1400px", margin: "0 auto" },
  header:        { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", flexWrap: "wrap", gap: "16px" },
  title:         { fontSize: "28px", fontWeight: "700", color: "#f1f5f9", margin: 0 },
  subtitle:      { color: "#64748b", fontSize: "14px", marginTop: "4px" },
  daySelector:   { display: "flex", gap: "8px" },
  dayBtn:        { padding: "8px 16px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#94a3b8", cursor: "pointer", fontSize: "14px" },
  dayBtnActive:  { backgroundColor: "#0284c7", border: "1px solid #0284c7", color: "#fff" },
  metricsBanner: { display: "flex", gap: "24px", alignItems: "center", backgroundColor: "#172554", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#bfdbfe", fontSize: "14px", flexWrap: "wrap" },
  metric:        { color: "#93c5fd" },
  errorBanner:   { backgroundColor: "#450a0a", border: "1px solid #991b1b", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fca5a5" },
  loadingBox:    { textAlign: "center", padding: "60px", color: "#64748b", fontSize: "18px" },
  summaryGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" },
  summaryCard:   { backgroundColor: "#1e293b", borderRadius: "12px", padding: "20px", textAlign: "center", border: "1px solid #334155", display: "flex", flexDirection: "column", gap: "6px" },
  summaryIcon:   { fontSize: "24px" },
  summaryLabel:  { fontSize: "12px", color: "#64748b", textTransform: "uppercase" },
  chartCard:     { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155", marginBottom: "16px" },
  chartTitle:    { fontSize: "18px", fontWeight: "600", color: "#f1f5f9", marginBottom: "4px" },
  chartHint:     { fontSize: "13px", color: "#64748b", marginBottom: "16px" },
  tableCard:     { backgroundColor: "#1e293b", borderRadius: "12px", padding: "24px", border: "1px solid #334155", marginBottom: "16px", overflowX: "auto" },
  tableTitle:    { fontSize: "16px", fontWeight: "600", color: "#f1f5f9", marginBottom: "16px" },
  table:         { width: "100%", borderCollapse: "collapse" },
  th:            { padding: "10px 16px", textAlign: "left", fontSize: "12px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #334155" },
  td:            { padding: "10px 16px", fontSize: "14px", color: "#94a3b8", borderBottom: "1px solid #1e293b" },
  timestamp:     { color: "#475569", fontSize: "12px", textAlign: "right" },
};

export default ForecastChart;