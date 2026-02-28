# =====================================================
# utils/preprocessing.py - Data Scaling & Preprocessing
# =====================================================
# Handles:
#   1. Scaling data to 0-5V range (for ESP32 ADC prototype)
#   2. MinMax normalization for ML models
#   3. Sequence creation for LSTM time-series input
#   4. Inverse transforms to get real-world values back
#
# WHY 0-5V SCALING?
#   The ESP32 ADC (Analog-to-Digital Converter) reads
#   voltages between 0V and 5V. To make the prototype
#   work with real sensor data, all readings must be
#   mapped to this voltage range.
# =====================================================

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
import logging
import config

logger = logging.getLogger(__name__)

# --- Global scalers (fitted once during training, reused during inference) ---
# These are module-level so they persist across API calls within same process
_feature_scaler = MinMaxScaler(feature_range=(0, 1))   # For ML normalization
_target_scaler  = MinMaxScaler(feature_range=(0, 1))   # Separate scaler for target column
_voltage_scaler = MinMaxScaler(                         # For 0-5V prototype scaling
    feature_range=(config.VOLTAGE_SCALE_MIN, config.VOLTAGE_SCALE_MAX)
)
_scalers_fitted = False


# =====================================================
# 0-5V VOLTAGE SCALING (for IoT Prototype)
# =====================================================

def scale_to_5v(values: np.ndarray, fit: bool = False) -> np.ndarray:
    """
    Scales sensor readings to 0-5V range for ESP32 ADC compatibility.

    This simulates what the physical ESP32 sees on its ADC pins.
    Real sensor signals (current, voltage, power) are mapped to
    the 0-5V range that the microcontroller can read.

    Args:
        values: Raw sensor values as numpy array (shape: [n_samples, n_features])
        fit:    If True, fits the scaler first (call once with training data)

    Returns:
        Scaled values in range [0.0, 5.0]
    """
    if fit:
        _voltage_scaler.fit(values)
        logger.info(f"🔌 Voltage scaler fitted: input range {values.min():.3f} → {values.max():.3f} mapped to 0-5V")

    scaled = _voltage_scaler.transform(values)
    return scaled


def inverse_scale_from_5v(values: np.ndarray) -> np.ndarray:
    """
    Converts 0-5V scaled values back to original physical units.
    Use this to display human-readable values on the dashboard.

    Args:
        values: Values in 0-5V range

    Returns:
        Values in original physical units (watts, amps, etc.)
    """
    return _voltage_scaler.inverse_transform(values)


# =====================================================
# ML NORMALIZATION (for LSTM and NILM models)
# =====================================================

def fit_scalers(features: np.ndarray, targets: np.ndarray):
    """
    Fits both the feature scaler and target scaler on training data.
    Must be called ONCE before training. Scalers are reused for inference.

    Args:
        features: Training feature matrix [n_samples, n_features]
        targets:  Training target values  [n_samples, 1]
    """
    global _scalers_fitted
    _feature_scaler.fit(features)
    _target_scaler.fit(targets.reshape(-1, 1))
    _scalers_fitted = True
    logger.info("✅ Feature and target scalers fitted successfully")


def normalize_features(features: np.ndarray) -> np.ndarray:
    """
    Normalizes features to [0, 1] range for ML model input.
    Scalers must be fitted first via fit_scalers().

    Args:
        features: Raw feature matrix

    Returns:
        Normalized features in [0, 1]
    """
    if not _scalers_fitted:
        raise RuntimeError("Scalers not fitted. Call fit_scalers() during training first.")
    return _feature_scaler.transform(features)


def denormalize_target(values: np.ndarray) -> np.ndarray:
    """
    Converts normalized LSTM output predictions back to real watt values.

    Args:
        values: Normalized predictions [n_samples, 1]

    Returns:
        Real-world power consumption values (kilowatts)
    """
    if not _scalers_fitted:
        raise RuntimeError("Scalers not fitted.")
    return _target_scaler.inverse_transform(values.reshape(-1, 1)).flatten()


# =====================================================
# SEQUENCE CREATION (for LSTM time-series input)
# =====================================================

def create_sequences(data: np.ndarray, seq_length: int, target_col_idx: int = 0):
    """
    Converts a time-series array into overlapping (X, y) sequences
    for LSTM training.

    Example: seq_length=60 means use 60 past minutes to predict next minute.

    Args:
        data:           Normalized feature matrix [n_samples, n_features]
        seq_length:     Number of past time steps to use as input
        target_col_idx: Column index of the target (active_power = 0)

    Returns:
        X: Input sequences  [n_sequences, seq_length, n_features]
        y: Target values    [n_sequences]
    """
    X, y = [], []

    for i in range(seq_length, len(data)):
        # Use seq_length past rows as input features
        X.append(data[i - seq_length:i, :])
        # Predict the next value of the target column
        y.append(data[i, target_col_idx])

    X = np.array(X)  # Shape: [n, seq_length, features]
    y = np.array(y)  # Shape: [n]

    logger.info(f"✅ Sequences created: X={X.shape}, y={y.shape}")
    return X, y


def prepare_training_data(df: pd.DataFrame, feature_cols: list, target_col: str, seq_length: int):
    """
    Full pipeline: DataFrame → scaled → normalized → sequences.
    Call this during model training.

    Args:
        df:           Raw UCI DataFrame
        feature_cols: List of feature column names
        target_col:   Name of target column (e.g., "active_power")
        seq_length:   LSTM sequence window size

    Returns:
        X_train, y_train (ready for model.fit())
        Also stores voltage-scaled version for IoT prototype reference
    """
    # --- Extract raw numpy arrays ---
    features = df[feature_cols].values
    targets  = df[[target_col]].values

    # --- Scale to 0-5V (for prototype simulation) ---
    # This shows what the ESP32 ADC would actually see
    features_5v = scale_to_5v(features, fit=True)
    logger.info(f"🔌 Features scaled to 0-5V range for ESP32 prototype compatibility")

    # --- Fit ML normalization scalers ---
    fit_scalers(features_5v, targets)

    # --- Normalize 0-5V data to [0,1] for ML models ---
    features_norm = normalize_features(features_5v)

    # --- Find target column index in feature list ---
    target_idx = feature_cols.index(target_col) if target_col in feature_cols else 0

    # --- Create LSTM sequences ---
    X, y = create_sequences(features_norm, seq_length, target_col_idx=target_idx)

    return X, y


def preprocess_live_reading(reading: dict, feature_cols: list) -> np.ndarray:
    """
    Preprocesses a single live ESP32 sensor reading for model inference.

    The reading dict should contain keys matching feature_cols.
    Values are assumed to already be in raw sensor units.

    Args:
        reading:      Dict with sensor values e.g. {"active_power": 1.2, ...}
        feature_cols: List of expected feature column names

    Returns:
        Normalized numpy array ready for NILM model input [1, n_features]
    """
    # Build feature vector from the reading dict
    feature_vector = np.array([[reading.get(col, 0.0) for col in feature_cols]])

    # Scale to 0-5V first (prototype range)
    feature_5v = scale_to_5v(feature_vector, fit=False)

    # Then normalize to [0, 1] for model input
    feature_norm = normalize_features(feature_5v)

    return feature_norm