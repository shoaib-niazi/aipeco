# =====================================================
# config.py - AiPECO Configuration
# =====================================================
# Edit MONGO_URI to match your MongoDB connection.
# For local MongoDB: mongodb://localhost:27017/
# For MongoDB Atlas: mongodb+srv://<user>:<pass>@cluster.mongodb.net/
# =====================================================

import os
from dotenv import load_dotenv

load_dotenv()  # Load from .env file if present

# --- MongoDB Settings ---
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME   = os.getenv("DB_NAME", "aipeco_db")

# --- Flask Settings ---
DEBUG      = os.getenv("DEBUG", "True") == "True"
PORT       = int(os.getenv("PORT", 5000))
SECRET_KEY = os.getenv("SECRET_KEY", "aipeco-secret-key-change-in-production")

# --- Model Settings ---
# Path to save/load trained model files (.h5)
MODELS_DIR       = os.path.join(os.path.dirname(__file__), "saved_models")
LSTM_MODEL_PATH  = os.path.join(MODELS_DIR, "lstm_model.h5")
NILM_MODEL_PATH  = os.path.join(MODELS_DIR, "nilm_model.h5")

# --- UCI Dataset Settings ---
# Download dataset from UCI and place it at this path
UCI_DATA_PATH    = os.path.join(os.path.dirname(__file__), "data", "household_power_consumption.txt")
UCI_ROWS_LIMIT   = 20000   # Only use first 20,000 rows for training (as required)

# --- IoT Prototype Scaling ---
# ESP32 ADC reads 0 to 5V, so we scale all features into this range
VOLTAGE_SCALE_MIN = 0.0
VOLTAGE_SCALE_MAX = 5.0

# --- LSTM Forecast Settings ---
LSTM_SEQUENCE_LENGTH = 60    # Use 60 past time steps to predict future
LSTM_FORECAST_DAYS   = 7     # Predict 7 days ahead
LSTM_EPOCHS          = 20    # Training epochs (increase for better accuracy)
LSTM_BATCH_SIZE      = 32

# --- NILM Settings ---
NILM_THRESHOLD       = 0.5   # Classification threshold for ON/OFF state
NILM_EPOCHS          = 15

# --- Anomaly Detection ---
ANOMALY_ZSCORE_THRESHOLD = 2.5  # Z-score above this = anomaly flagged

# --- Scheduler Intervals (in seconds/minutes) ---
SCHEDULE_NILM_MINUTES     = 5    # Run NILM detection every 5 minutes
SCHEDULE_ANOMALY_HOURS    = 1    # Run anomaly detection every 1 hour
SCHEDULE_RETRAIN_HOURS    = 24   # Retrain LSTM model every 24 hours