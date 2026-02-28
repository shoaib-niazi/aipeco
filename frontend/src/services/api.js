// =====================================================
// services/api.js - AiPECO API Service
// =====================================================
// Centralized Axios instance for all Flask backend calls.
// All components import from here — never hardcode URLs.
//
// Base URL: http://localhost:5000
// (React proxy in package.json forwards /api/* to Flask)
// =====================================================

import axios from "axios";

// Create Axios instance with default config
const api = axios.create({
  baseURL: "http://localhost:5000",   // Flask backend URL
  timeout: 60000,                     // 60s timeout (training can be slow)
  headers: {
    "Content-Type": "application/json",
  },
});

// --- Request interceptor: log all outgoing requests ---
api.interceptors.request.use(
  (config) => {
    console.log(`📡 API → ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// --- Response interceptor: log errors globally ---
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const msg = error.response?.data?.error || error.message || "Unknown error";
    console.error(`❌ API Error: ${msg}`);
    return Promise.reject(error);
  }
);

// =====================================================
// API Functions
// =====================================================

/**
 * Trains both LSTM and NILM models on UCI dataset.
 * This can take several minutes — show a loading state in the UI.
 * @returns {Promise} Training metrics for both models
 */
export const trainModels = () => api.post("/api/train");

/**
 * Gets LSTM 7-day energy forecast.
 * @param {number} days - Number of days to forecast (default 7)
 * @returns {Promise} { forecast, dates, unit, generated_at }
 */
export const getForecast = (days = 7) => api.get(`/api/forecast?days=${days}`);

/**
 * Gets NILM appliance state predictions for latest reading.
 * @returns {Promise} { appliances, summary, timestamp }
 */
export const getNILMPrediction = () => api.get("/api/nilm");

/**
 * Gets history of NILM predictions.
 * @param {number} limit - Number of records to return
 * @returns {Promise} { history, count }
 */
export const getNILMHistory = (limit = 20) => api.get(`/api/nilm/history?limit=${limit}`);

/**
 * Gets recent sensor readings from MongoDB.
 * @param {number} limit - Number of readings to return
 * @param {string} deviceId - Optional device filter
 * @returns {Promise} { readings, count }
 */
export const getReadings = (limit = 100, deviceId = null) => {
  const params = deviceId ? `?limit=${limit}&device_id=${deviceId}` : `?limit=${limit}`;
  return api.get(`/api/readings${params}`);
};

/**
 * Stores a new sensor reading from ESP32.
 * @param {Object} reading - { device_id, current, voltage, temperature, humidity, ... }
 * @returns {Promise} { status, id, timestamp }
 */
export const storeReading = (reading) => api.post("/api/readings", reading);

/**
 * Gets recent anomaly detections. Also triggers a fresh scan.
 * @param {number} limit - Number of anomalies to return
 * @returns {Promise} { anomalies, count, scanned_at }
 */
export const getAnomalies = (limit = 50) => api.get(`/api/anomalies?limit=${limit}`);

/**
 * Gets model training status (trained/not-trained, metrics, timestamp).
 * @returns {Promise} { lstm_trained, nilm_trained, trained_at, ... }
 */
export const getModelStatus = () => api.get("/api/status");

/**
 * Health check — verifies Flask backend is running.
 * @returns {Promise} { status: "ok" }
 */
export const healthCheck = () => api.get("/api/health");

export default api;