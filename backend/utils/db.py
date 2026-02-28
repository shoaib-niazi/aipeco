# =====================================================
# utils/db.py - MongoDB Connection Helper
# =====================================================
# Provides a single shared MongoDB client instance.
# Collections used:
#   - readings        : Raw sensor readings from ESP32
#   - nilm_states     : NILM appliance ON/OFF predictions
#   - forecasts       : LSTM energy forecast results
#   - anomalies       : Detected anomaly events
#   - model_status    : Training status and timestamps
# =====================================================

from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import config
import logging

logger = logging.getLogger(__name__)

# --- Create single global MongoDB client ---
# This is reused across all modules (singleton pattern)
try:
    _client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
    _client.server_info()  # Will raise if cannot connect
    logger.info("✅ MongoDB connected successfully")
except ConnectionFailure as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    _client = None

# --- Get the main database ---
def get_db():
    """
    Returns the AiPECO MongoDB database object.
    All collections are accessed through this.
    """
    if _client is None:
        raise RuntimeError("MongoDB is not connected. Check MONGO_URI in config.py")
    return _client[config.DB_NAME]

# --- Helper to get specific collections ---
def get_collection(name: str):
    """
    Returns a specific collection by name.
    Example: get_collection("readings")
    """
    return get_db()[name]

# --- Convenience collection references ---
def readings_col():
    return get_collection("readings")

def nilm_col():
    return get_collection("nilm_states")

def forecast_col():
    return get_collection("forecasts")

def anomaly_col():
    return get_collection("anomalies")

def model_status_col():
    return get_collection("model_status")