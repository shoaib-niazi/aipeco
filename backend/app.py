# =====================================================
# app.py - AiPECO Flask REST API
# =====================================================
# Main entry point. Registers all API routes and
# starts the Flask development server.
#
# Run with: python app.py
# Runs on: http://localhost:5000
#
# All routes:
#   POST /api/train           → Train both LSTM + NILM models
#   GET  /api/forecast        → Get 7-day energy forecast
#   GET  /api/nilm            → Get appliance state predictions
#   GET  /api/nilm/history    → Get NILM prediction history
#   POST /api/readings        → Store a new sensor reading
#   GET  /api/readings        → Get last N readings
#   GET  /api/anomalies       → Get recent anomalies
#   GET  /api/status          → Check model training status
#   GET  /api/health          → Health check
# =====================================================

import os
import logging
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS

import config
from utils.db import (
    readings_col, nilm_col, forecast_col, anomaly_col, model_status_col
)
from models.lstm_model import train_lstm, get_forecast, load_lstm_model
from models.nilm_model import (
    train_nilm, predict_appliance_states,
    detect_anomalies_from_history, load_nilm_model
)

# =====================================================
# App Setup
# =====================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY

# Allow React frontend at localhost:3000 to call our API
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

# Create saved_models directory if it doesn't exist
os.makedirs(config.MODELS_DIR, exist_ok=True)

# =====================================================
# API Routes
# =====================================================

@app.route("/api/health", methods=["GET"])
def health_check():
    """
    Simple health check endpoint.
    The React frontend can ping this to verify the backend is running.
    """
    return jsonify({
        "status"    : "ok",
        "service"   : "AiPECO Backend",
        "timestamp" : datetime.utcnow().isoformat()
    })


@app.route("/api/train", methods=["POST"])
def train_models():
    """
    POST /api/train
    Trains both LSTM and NILM models on the UCI dataset (first 20k rows).

    This is a blocking call — it may take a few minutes.
    After training, models are saved to disk and cached in memory.

    Returns:
        200: { status, lstm_metrics, nilm_metrics, trained_at }
        500: { error }
    """
    logger.info("📥 POST /api/train — Starting model training...")

    try:
        # --- Train LSTM first (also fits the voltage scaler) ---
        lstm_metrics = train_lstm(save=True)
        logger.info(f"✅ LSTM done: MAE={lstm_metrics['mae']} kW")

        # --- Train NILM (reuses voltage scaler from LSTM) ---
        nilm_metrics = train_nilm(save=True)
        logger.info(f"✅ NILM done: {nilm_metrics['n_appliances']} appliances")

        # --- Save training status to MongoDB ---
        status_doc = {
            "lstm_trained" : True,
            "nilm_trained" : True,
            "trained_at"   : datetime.utcnow().isoformat(),
            "lstm_metrics" : lstm_metrics,
            "nilm_metrics" : nilm_metrics
        }
        model_status_col().update_one(
            {"_id": "status"},
            {"$set": status_doc},
            upsert=True
        )

        return jsonify({
            "status"       : "success",
            "lstm_metrics" : lstm_metrics,
            "nilm_metrics" : nilm_metrics,
            "trained_at"   : datetime.utcnow().isoformat()
        }), 200

    except FileNotFoundError as e:
        # UCI dataset not found
        return jsonify({
            "error"       : str(e),
            "hint"        : "Download UCI dataset and place at backend/data/household_power_consumption.txt"
        }), 404

    except Exception as e:
        logger.error(f"❌ Training failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/forecast", methods=["GET"])
def forecast():
    """
    GET /api/forecast?days=7
    Returns LSTM energy consumption forecast for the next N days.

    Query params:
        days (int): Number of days to forecast (default: 7, max: 30)

    Returns:
        200: { forecast: [...], dates: [...], unit, generated_at }
        500: { error }
    """
    n_days = min(int(request.args.get("days", config.LSTM_FORECAST_DAYS)), 30)
    logger.info(f"📥 GET /api/forecast?days={n_days}")

    try:
        result = get_forecast(n_days=n_days)

        # Cache forecast in MongoDB for history
        forecast_col().insert_one({**result, "cached_at": datetime.utcnow().isoformat()})

        return jsonify(result), 200

    except RuntimeError as e:
        return jsonify({"error": str(e), "hint": "Train models first via POST /api/train"}), 400
    except Exception as e:
        logger.error(f"❌ Forecast failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/nilm", methods=["GET"])
def nilm_predict():
    """
    GET /api/nilm
    Runs NILM on the latest sensor reading in MongoDB.

    Returns:
        200: {
            appliances: [{name, status, confidence, power_w, load_factor, anomaly}],
            summary: { total, on, off, detected_power_w },
            timestamp
        }
        400: { error } — model not trained or no readings
    """
    logger.info("📥 GET /api/nilm")

    try:
        result = predict_appliance_states()

        # Save NILM prediction to MongoDB for history
        nilm_col().insert_one({**result, "saved_at": datetime.utcnow().isoformat()})

        return jsonify(result), 200

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"❌ NILM prediction failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/nilm/history", methods=["GET"])
def nilm_history():
    """
    GET /api/nilm/history?limit=20
    Returns the last N NILM prediction results from MongoDB.

    Useful for the frontend to show appliance usage trends over time.
    """
    limit = int(request.args.get("limit", 20))
    docs  = list(nilm_col().find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit))

    return jsonify({"history": docs, "count": len(docs)}), 200


@app.route("/api/readings", methods=["POST"])
def store_reading():
    """
    POST /api/readings
    Stores a new sensor reading from the ESP32 device into MongoDB.

    Expected JSON body:
    {
        "device_id"   : "ESP32_001",
        "current"     : 2.5,        ← Amps (from ACS712/INA219)
        "voltage"     : 220.3,      ← Volts (from ZMPT101B)
        "temperature" : 28.1,       ← Celsius (from DHT22)
        "humidity"    : 65.0,       ← Percent (from DHT22)
        "active_power": 0.55,       ← kW (computed on ESP32 or here)
        "sub1"        : 5.0,        ← Wh (sub-metering 1, optional)
        "sub2"        : 0.0,        ← Wh (sub-metering 2, optional)
        "sub3"        : 18.0        ← Wh (sub-metering 3, optional)
    }

    NOTE: The 0-5V scaling happens on the ESP32 side for the ADC readings.
    The Flask backend receives already-scaled or raw values depending on setup.

    Returns:
        201: { status, id, timestamp }
        400: { error }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    # --- Validate required fields ---
    required = ["device_id"]
    missing  = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    # --- Add server-side timestamp ---
    data["timestamp"]  = datetime.utcnow().isoformat()
    data["received_at"] = datetime.utcnow().isoformat()

    # --- Compute active_power if current and voltage are provided but power is not ---
    if "active_power" not in data and "current" in data and "voltage" in data:
        # Simple apparent power: P = V * I / 1000 (kW)
        # For real active power, a power factor is needed (default 0.9)
        pf = data.get("power_factor", 0.9)
        data["active_power"] = round(data["voltage"] * data["current"] * pf / 1000, 6)

    # --- Store in MongoDB ---
    result = readings_col().insert_one(data)
    doc_id = str(result.inserted_id)

    logger.info(f"📡 New reading stored from {data.get('device_id')}: {doc_id}")

    return jsonify({
        "status"    : "stored",
        "id"        : doc_id,
        "timestamp" : data["timestamp"]
    }), 201


@app.route("/api/readings", methods=["GET"])
def get_readings():
    """
    GET /api/readings?limit=100&device_id=ESP32_001
    Returns recent sensor readings from MongoDB.

    Query params:
        limit     (int):  Number of readings to return (default: 100)
        device_id (str):  Filter by specific device (optional)

    Returns:
        200: { readings: [...], count: N }
    """
    limit     = int(request.args.get("limit", 100))
    device_id = request.args.get("device_id")

    query = {}
    if device_id:
        query["device_id"] = device_id

    # Fetch, exclude MongoDB _id, sort newest first
    readings = list(readings_col().find(
        query, {"_id": 0}
    ).sort("timestamp", -1).limit(limit))

    return jsonify({"readings": readings, "count": len(readings)}), 200


@app.route("/api/anomalies", methods=["GET"])
def get_anomalies():
    """
    GET /api/anomalies?limit=50
    Returns recent anomalies detected in energy consumption.

    Also triggers a fresh anomaly detection scan on the last 200 readings.

    Returns:
        200: { anomalies: [...], count: N, scanned_at }
    """
    limit = int(request.args.get("limit", 50))
    logger.info("📥 GET /api/anomalies — running fresh detection scan")

    # Run anomaly detection on latest readings
    try:
        new_anomalies = detect_anomalies_from_history()
    except Exception as e:
        logger.warning(f"⚠️  Anomaly detection scan error: {e}")

    # Return stored anomalies from DB
    anomalies = list(anomaly_col().find(
        {}, {"_id": 0}
    ).sort("detected_at", -1).limit(limit))

    return jsonify({
        "anomalies"  : anomalies,
        "count"      : len(anomalies),
        "scanned_at" : datetime.utcnow().isoformat()
    }), 200


@app.route("/api/status", methods=["GET"])
def model_status():
    """
    GET /api/status
    Returns the current status of trained models.

    The React frontend uses this to show whether models are ready,
    when they were last trained, and their performance metrics.

    Returns:
        200: { lstm_trained, nilm_trained, trained_at, metrics }
    """
    status = model_status_col().find_one({"_id": "status"}, {"_id": 0})
    if not status:
        status = {
            "lstm_trained" : False,
            "nilm_trained" : False,
            "trained_at"   : None,
            "message"      : "Models not trained yet. Call POST /api/train"
        }

    return jsonify(status), 200


# =====================================================
# App Startup
# =====================================================

def startup():
    """
    Runs on app startup:
    1. Try to load pre-trained models from disk
    2. Start the background job scheduler
    """
    logger.info("🚀 AiPECO Backend starting...")

    # Load existing models from disk (if already trained)
    load_lstm_model()
    load_nilm_model()

    # Start background scheduler (NILM, anomaly detection, retraining)
    from scheduler import start_scheduler
    start_scheduler()

    logger.info("✅ AiPECO Backend ready on http://localhost:5000")
# =====================================================
# voice_command_routes.py
# ADD THESE ROUTES TO backend/app.py
# =====================================================
# Handles FR-12 (voice) and FR-13 (text) commands
# from the ESP32 and React dashboard.
#
# Routes added:
#   POST /api/voice_trigger    → Receives audio trigger, returns action
#   POST /api/command_result   → Stores executed command in MongoDB
#   POST /api/text_command     → Text command from React dashboard
#   GET  /api/commands         → Get command history
# =====================================================
#
# PASTE THESE ROUTE FUNCTIONS INTO backend/app.py
# (inside the same Flask app, after the existing routes)
# =====================================================

# Simple keyword map: what words → what relay action
# Extend this list for more commands
VOICE_KEYWORD_MAP = {
    # Turn ON keywords
    "on"    : "relay_on",
    "start" : "relay_on",
    "enable": "relay_on",
    "power" : "relay_on",
    "open"  : "relay_on",

    # Turn OFF keywords
    "off"   : "relay_off",
    "stop"  : "relay_off",
    "disable":"relay_off",
    "close" : "relay_off",

    # Toggle
    "toggle": "toggle",
    "switch": "toggle",

    # Status
    "status": "status",
    "check" : "status",
    "report": "status",
}


@app.route("/api/voice_trigger", methods=["POST"])
def voice_trigger():
    """
    POST /api/voice_trigger
    Receives a voice trigger event from ESP32 microphone.

    The ESP32 sends this when it detects a loud sound.
    We return a simple action based on the last text command
    or a toggle (since we don't have actual speech-to-text here).

    For full voice recognition, integrate a local Whisper model
    or a keyword-spotting model (TensorFlow Lite on ESP32).

    Body: { device_id, audio_peak, relay_state }
    Returns: { action: "relay_on" | "relay_off" | "toggle" | "status" }
    """
    from utils.db import get_collection

    data = request.get_json() or {}
    logger.info(f"🎤 Voice trigger from {data.get('device_id')} — peak: {data.get('audio_peak')}")

    # Check if there's a pending text command in DB
    commands_col = get_collection("commands")
    pending = commands_col.find_one(
        {"status": "pending", "device_id": data.get("device_id")},
        sort=[("timestamp", -1)]
    )

    if pending:
        action = pending.get("action", "toggle")
        # Mark the command as consumed
        commands_col.update_one({"_id": pending["_id"]}, {"$set": {"status": "executed"}})
        logger.info(f"   Found pending command: {action}")
    else:
        # No pending command — default to toggle relay
        action = "toggle"
        logger.info("   No pending command — defaulting to toggle")

    # Store the voice trigger event
    get_collection("voice_triggers").insert_one({
        "device_id"   : data.get("device_id"),
        "audio_peak"  : data.get("audio_peak"),
        "relay_state" : data.get("relay_state"),
        "action"      : action,
        "timestamp"   : datetime.utcnow().isoformat()
    })

    return jsonify({"action": action}), 200


@app.route("/api/command_result", methods=["POST"])
def command_result():
    """
    POST /api/command_result
    Called by ESP32 after it executes a command.
    Stores the result in MongoDB for dashboard history.

    Body: { device_id, command_type, command_value, success, relay_state }
    """
    from utils.db import get_collection

    data = request.get_json() or {}
    data["timestamp"] = datetime.utcnow().isoformat()

    get_collection("commands").update_one(
        {"device_id": data.get("device_id"), "status": "executed"},
        {"$set": {"result": data, "completed_at": data["timestamp"]}},
        upsert=True
    )

    logger.info(f"✅ Command result stored: {data.get('command_type')} → {data.get('command_value')}")
    return jsonify({"status": "stored"}), 200


@app.route("/api/text_command", methods=["POST"])
def text_command():
    """
    POST /api/text_command
    Accepts a text command from the React dashboard.
    Parses keywords and queues the action for the ESP32.

    Body: { "command": "turn the relay on" }
    Returns: { "parsed_action": "relay_on", "queued": true }

    The ESP32 polls /api/voice_trigger to pick up queued commands,
    OR you can use MQTT for instant push (more advanced).
    """
    from utils.db import get_collection

    data = request.get_json() or {}
    raw_command = data.get("command", "").lower().strip()

    if not raw_command:
        return jsonify({"error": "Empty command"}), 400

    logger.info(f"📝 Text command: '{raw_command}'")

    # Parse keywords
    parsed_action = "unknown"
    for keyword, action in VOICE_KEYWORD_MAP.items():
        if keyword in raw_command:
            parsed_action = action
            break

    # Queue the command in MongoDB for ESP32 to pick up
    cmd_doc = {
        "device_id"   : data.get("device_id", "ESP32_AiPECO_01"),
        "raw_command" : raw_command,
        "action"      : parsed_action,
        "status"      : "pending",
        "source"      : "dashboard_text",
        "timestamp"   : datetime.utcnow().isoformat()
    }
    get_collection("commands").insert_one(cmd_doc)

    logger.info(f"   Parsed as: '{parsed_action}' → queued for ESP32")

    return jsonify({
        "raw_command"   : raw_command,
        "parsed_action" : parsed_action,
        "queued"        : parsed_action != "unknown",
        "hint"          : None if parsed_action != "unknown"
                         else "Command not understood. Try: 'relay on', 'relay off', 'status'"
    }), 200


@app.route("/api/commands", methods=["GET"])
def get_commands():
    """
    GET /api/commands?limit=20
    Returns command history from MongoDB.
    """
    from utils.db import get_collection

    limit  = int(request.args.get("limit", 20))
    cmds   = list(get_collection("commands").find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit))

    return jsonify({"commands": cmds, "count": len(cmds)}), 200


if __name__ == "__main__":
    startup()
    app.run(
        host="0.0.0.0",
        port=config.PORT,
        debug=config.DEBUG,
        use_reloader=False  # IMPORTANT: Disable reloader to avoid starting scheduler twice
    )