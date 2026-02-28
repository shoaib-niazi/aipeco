# =====================================================
# models/nilm_model.py - NILM Appliance Detection Model
# =====================================================
# Non-Intrusive Load Monitoring (NILM) disaggregates
# total household power into individual appliance states.
#
# What this module does:
#   1. ON/OFF State Detection  → Is each appliance currently on?
#   2. Power Estimation        → How much power is it consuming?
#   3. Anomaly Detection       → Is consumption abnormal?
#   4. Consumption Patterns    → Usage trends per appliance
#
# Architecture:
#   Input → Dense(128, relu) → Dropout
#         → Dense(64, relu)  → Dropout
#         → Dense(32, relu)
#         → Dense(n_appliances, sigmoid)  ← Multi-label classification
#         → Dense(n_appliances, linear)   ← Power estimation (regression)
#
# NOTE: The UCI dataset's sub-metering columns are used to derive
# appliance labels. We create synthetic ON/OFF labels using
# power thresholds on sub_metering columns.
#   sub1 → Kitchen (dishwasher, oven, microwave)
#   sub2 → Laundry (washing machine, dryer)
#   sub3 → Water heater + AC
# =====================================================

import numpy as np
import os
import logging
from datetime import datetime
from scipy import stats

import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model, Model
from tensorflow.keras.layers import Dense, Dropout, Input
from tensorflow.keras.callbacks import EarlyStopping
from sklearn.metrics import classification_report, mean_absolute_error

import config
from utils.data_loader import load_uci_dataset, get_feature_columns
from utils.preprocessing import prepare_training_data, normalize_features, scale_to_5v

logger = logging.getLogger(__name__)

# --- Appliance definitions ---
# Maps sub-metering columns → appliance names
# Threshold in Watts: if sub-metering > threshold, appliance is ON
APPLIANCES = [
    {"name": "Kitchen Appliances",  "sub_col": "sub1", "threshold_wh": 10.0, "rated_power_w": 800},
    {"name": "Laundry (Washer)",    "sub_col": "sub2", "threshold_wh": 10.0, "rated_power_w": 2000},
    {"name": "Water Heater / AC",   "sub_col": "sub3", "threshold_wh": 10.0, "rated_power_w": 3000},
    # Additional derived appliance from overall active power
    {"name": "Lighting / Other",    "sub_col": None,   "threshold_wh": 0.3,  "rated_power_w": 200},
]

N_APPLIANCES = len(APPLIANCES)

# --- Module-level model reference ---
_nilm_model = None


def _create_nilm_labels(df):
    """
    Creates ON/OFF binary labels and power estimates for each appliance
    from UCI sub-metering columns.

    Sub-metering values are in Wh per minute. We threshold them
    to get binary ON/OFF state.

    Returns:
        labels_onoff: [n_samples, n_appliances] binary array (0=OFF, 1=ON)
        labels_power: [n_samples, n_appliances] float array (power in W)
    """
    n = len(df)
    labels_onoff = np.zeros((n, N_APPLIANCES))
    labels_power = np.zeros((n, N_APPLIANCES))

    for idx, appl in enumerate(APPLIANCES):
        if appl["sub_col"] is not None and appl["sub_col"] in df.columns:
            # Sub-metering values (Wh per minute)
            sub_values = df[appl["sub_col"]].values
            # Convert Wh/min to W (multiply by 60)
            power_w = sub_values * 60.0
            # ON/OFF: True if power exceeds threshold
            is_on = (sub_values > appl["threshold_wh"]).astype(int)
        else:
            # Derived: use total active power minus known subs
            if all(c in df.columns for c in ["active_power", "sub1", "sub2", "sub3"]):
                # Remaining power = total - known subs (in W)
                known_subs_w = (df["sub1"].values + df["sub2"].values + df["sub3"].values) * 60.0
                total_w      = df["active_power"].values * 1000.0  # kW → W
                remaining_w  = np.maximum(total_w - known_subs_w, 0)
                power_w      = remaining_w
                is_on        = (remaining_w > appl["threshold_wh"] * 60.0).astype(int)
            else:
                power_w = np.zeros(n)
                is_on   = np.zeros(n, dtype=int)

        labels_onoff[:, idx] = is_on
        labels_power[:, idx] = power_w

    logger.info(f"✅ NILM labels created: {labels_onoff.shape}")
    on_rates = labels_onoff.mean(axis=0)
    for i, appl in enumerate(APPLIANCES):
        logger.info(f"   {appl['name']}: ON {on_rates[i]*100:.1f}% of the time")

    return labels_onoff, labels_power


def build_nilm_model(n_features: int, n_appliances: int) -> Model:
    """
    Builds a multi-output NILM model:
      - Output 1: ON/OFF classification (sigmoid, one per appliance)
      - Output 2: Power estimation in W (linear, one per appliance)

    Args:
        n_features:   Number of input features
        n_appliances: Number of appliances to detect

    Returns:
        Compiled Keras Model with two outputs
    """
    # --- Shared input and feature extraction layers ---
    inputs = Input(shape=(n_features,), name="sensor_input")

    x = Dense(128, activation="relu", name="dense_1")(inputs)
    x = Dropout(0.3, name="dropout_1")(x)
    x = Dense(64, activation="relu", name="dense_2")(x)
    x = Dropout(0.2, name="dropout_2")(x)
    x = Dense(32, activation="relu", name="dense_3")(x)

    # --- Output 1: ON/OFF State (sigmoid = 0 to 1 probability) ---
    state_output = Dense(
        n_appliances,
        activation="sigmoid",
        name="state_output"   # Binary: ON=1, OFF=0
    )(x)

    # --- Output 2: Power Estimation (linear regression) ---
    power_output = Dense(
        n_appliances,
        activation="linear",
        name="power_output"   # Continuous: watts consumed
    )(x)

    # --- Build model with two outputs ---
    model = Model(
        inputs=inputs,
        outputs=[state_output, power_output],
        name="AiPECO_NILM"
    )

    # Compile with two losses: binary crossentropy for state, MSE for power
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss={
            "state_output": "binary_crossentropy",  # Classification
            "power_output": "mean_squared_error"    # Regression
        },
        loss_weights={
            "state_output": 1.0,   # Weigh classification more
            "power_output": 0.5
        },
        metrics={
            "state_output": ["accuracy"],
            "power_output": ["mae"]
        }
    )

    model.summary(print_fn=logger.info)
    return model


def train_nilm(save: bool = True) -> dict:
    """
    Full training pipeline for the NILM appliance detection model.

    Steps:
    1. Load UCI dataset (first 20k rows)
    2. Create ON/OFF and power labels from sub-metering data
    3. Scale features to 0-5V (prototype range)
    4. Normalize and train multi-output NILM model
    5. Save model and return metrics

    Args:
        save: If True, saves model to config.NILM_MODEL_PATH

    Returns:
        Dict with per-appliance classification report and metrics
    """
    global _nilm_model
    logger.info("🚀 Starting NILM model training...")

    # --- Load dataset ---
    df = load_uci_dataset()
    feature_cols = get_feature_columns()

    # --- Create appliance labels from sub-metering ---
    labels_onoff, labels_power = _create_nilm_labels(df)

    # --- Prepare features (scale to 0-5V, then normalize) ---
    features_raw = df[feature_cols].values
    features_5v  = scale_to_5v(features_raw, fit=False)  # Already fitted in LSTM training
    features_norm = normalize_features(features_5v)

    # --- Train/test split (80/20, no shuffle for time-series!) ---
    split = int(0.8 * len(features_norm))
    X_train, X_test             = features_norm[:split], features_norm[split:]
    y_state_train, y_state_test = labels_onoff[:split],  labels_onoff[split:]
    y_power_train, y_power_test = labels_power[:split],  labels_power[split:]

    logger.info(f"📊 NILM Train: {len(X_train)}, Test: {len(X_test)}")

    # --- Build and train model ---
    model = build_nilm_model(X_train.shape[1], N_APPLIANCES)

    history = model.fit(
        X_train,
        {"state_output": y_state_train, "power_output": y_power_train},
        epochs=config.NILM_EPOCHS,
        batch_size=config.LSTM_BATCH_SIZE,
        validation_data=(
            X_test,
            {"state_output": y_state_test, "power_output": y_power_test}
        ),
        callbacks=[EarlyStopping(monitor="val_loss", patience=4, restore_best_weights=True)],
        verbose=1
    )

    # --- Evaluate: ON/OFF classification ---
    state_pred_prob, power_pred = model.predict(X_test, verbose=0)
    state_pred = (state_pred_prob > config.NILM_THRESHOLD).astype(int)

    # Generate per-appliance classification metrics
    metrics_per_appliance = {}
    for i, appl in enumerate(APPLIANCES):
        report = classification_report(
            y_state_test[:, i], state_pred[:, i],
            output_dict=True, zero_division=0
        )
        power_mae = float(mean_absolute_error(y_power_test[:, i], power_pred[:, i]))
        metrics_per_appliance[appl["name"]] = {
            "accuracy"    : round(report.get("accuracy", 0.0), 4),
            "precision"   : round(report.get("1", {}).get("precision", 0.0), 4),
            "recall"      : round(report.get("1", {}).get("recall", 0.0), 4),
            "f1"          : round(report.get("1", {}).get("f1-score", 0.0), 4),
            "power_mae_w" : round(power_mae, 2)
        }
        logger.info(f"   {appl['name']}: accuracy={metrics_per_appliance[appl['name']]['accuracy']}")

    # --- Save model ---
    if save:
        os.makedirs(config.MODELS_DIR, exist_ok=True)
        model.save(config.NILM_MODEL_PATH)
        logger.info(f"💾 NILM model saved to: {config.NILM_MODEL_PATH}")

    _nilm_model = model  # Cache in memory

    return {
        "appliance_metrics" : metrics_per_appliance,
        "n_appliances"      : N_APPLIANCES,
        "trained_at"        : datetime.utcnow().isoformat(),
        "epochs_run"        : len(history.history["loss"])
    }


def load_nilm_model():
    """
    Loads saved NILM model from disk into memory.
    Call this at app startup.
    """
    global _nilm_model
    if os.path.exists(config.NILM_MODEL_PATH):
        _nilm_model = load_model(config.NILM_MODEL_PATH)
        logger.info(f"✅ NILM model loaded from: {config.NILM_MODEL_PATH}")
    else:
        logger.warning("⚠️  No saved NILM model found. Train first via POST /api/train")


def predict_appliance_states(reading: dict = None) -> dict:
    """
    Runs NILM inference on a single sensor reading or recent DB readings.

    Returns detailed per-appliance information:
      - ON/OFF state
      - Estimated power consumption (W)
      - Confidence score (0-1)
      - Usage pattern (from recent history)
      - Anomaly flag

    Args:
        reading: Dict with sensor values (optional, uses latest DB if None)

    Returns:
        Dict with per-appliance predictions and summary
    """
    global _nilm_model

    if _nilm_model is None:
        load_nilm_model()
    if _nilm_model is None:
        raise RuntimeError("NILM model not trained. Call POST /api/train first.")

    feature_cols = get_feature_columns()

    # --- Get latest reading from DB if not provided ---
    if reading is None:
        from utils.db import readings_col
        latest = readings_col().find_one({}, {"_id": 0}, sort=[("timestamp", -1)])
        if latest is None:
            raise RuntimeError("No readings in database. Send sensor data first.")
        reading = latest

    # --- Preprocess single reading ---
    from utils.preprocessing import preprocess_live_reading
    features_norm = preprocess_live_reading(reading, feature_cols)

    # --- Run NILM model: get state probabilities and power estimates ---
    state_probs, power_preds = _nilm_model.predict(features_norm, verbose=0)
    state_probs = state_probs[0]   # Shape [N_APPLIANCES]
    power_preds = power_preds[0]   # Shape [N_APPLIANCES]
    power_preds = np.maximum(power_preds, 0)  # Power can't be negative

    # --- Build per-appliance result ---
    appliances_result = []
    total_detected_power = 0.0

    for i, appl in enumerate(APPLIANCES):
        prob     = float(state_probs[i])
        is_on    = prob > config.NILM_THRESHOLD
        power_w  = float(power_preds[i]) if is_on else 0.0
        total_detected_power += power_w

        appliances_result.append({
            "name"          : appl["name"],
            "status"        : "ON" if is_on else "OFF",
            "confidence"    : round(prob, 4),
            "power_w"       : round(power_w, 2),
            "rated_power_w" : appl["rated_power_w"],
            # Load factor: how heavily is it being used vs rated capacity
            "load_factor"   : round(power_w / appl["rated_power_w"], 3) if is_on else 0.0,
            "anomaly"       : _check_appliance_anomaly(appl, power_w, is_on)
        })

    # --- Overall summary ---
    n_on      = sum(1 for a in appliances_result if a["status"] == "ON")
    total_kw  = reading.get("active_power", total_detected_power / 1000)

    result = {
        "appliances"             : appliances_result,
        "summary": {
            "total_appliances"   : N_APPLIANCES,
            "appliances_on"      : n_on,
            "appliances_off"     : N_APPLIANCES - n_on,
            "detected_power_w"   : round(total_detected_power, 2),
            "total_power_kw"     : round(total_kw, 4),
            "undetected_power_w" : round(max(total_kw * 1000 - total_detected_power, 0), 2)
        },
        "timestamp"              : datetime.utcnow().isoformat(),
        "reading_used"           : {k: reading.get(k) for k in feature_cols if k in reading}
    }

    return result


def _check_appliance_anomaly(appl: dict, power_w: float, is_on: bool) -> dict:
    """
    Checks if an appliance's power consumption is anomalous.

    Compares current power draw to the expected rated power.
    If ON but consuming far more/less than rated → anomaly.

    Args:
        appl:    Appliance config dict
        power_w: Current estimated power in W
        is_on:   Whether appliance is ON

    Returns:
        Dict with anomaly flag and description
    """
    if not is_on or power_w == 0:
        return {"is_anomaly": False, "reason": None}

    rated = appl["rated_power_w"]
    ratio = power_w / rated

    if ratio > 1.5:
        return {
            "is_anomaly": True,
            "reason"    : f"Consuming {ratio:.1f}x rated power ({power_w:.0f}W vs {rated}W rated). Possible overload!"
        }
    elif ratio < 0.05:
        return {
            "is_anomaly": True,
            "reason"    : f"Very low consumption while ON ({power_w:.1f}W). Possible sensor fault."
        }
    else:
        return {"is_anomaly": False, "reason": None}


def detect_anomalies_from_history() -> list:
    """
    Runs anomaly detection on the last 200 readings stored in MongoDB.

    Uses Z-score method: readings more than Z standard deviations
    from the mean are flagged as anomalies.

    Returns:
        List of anomaly dicts with timestamp, value, z_score, severity
    """
    from utils.db import readings_col, anomaly_col

    # Get recent readings
    recent = list(readings_col().find(
        {}, {"_id": 0, "active_power": 1, "timestamp": 1}
    ).sort("timestamp", -1).limit(200))

    if len(recent) < 10:
        logger.warning("⚠️  Not enough readings for anomaly detection (need ≥ 10)")
        return []

    values     = np.array([r.get("active_power", 0.0) for r in recent])
    timestamps = [r.get("timestamp") for r in recent]

    # --- Z-score anomaly detection ---
    z_scores   = np.abs(stats.zscore(values))
    threshold  = config.ANOMALY_ZSCORE_THRESHOLD

    anomalies = []
    for i, (z, val, ts) in enumerate(zip(z_scores, values, timestamps)):
        if z > threshold:
            severity = "HIGH" if z > threshold * 1.5 else "MEDIUM"
            anomaly = {
                "timestamp"    : ts,
                "active_power" : round(float(val), 4),
                "z_score"      : round(float(z), 3),
                "severity"     : severity,
                "description"  : f"Power consumption {float(val):.3f} kW is {float(z):.1f} std devs from mean",
                "detected_at"  : datetime.utcnow().isoformat()
            }
            anomalies.append(anomaly)

    if anomalies:
        # Save new anomalies to MongoDB (avoid duplicates by checking timestamp)
        for a in anomalies:
            anomaly_col().update_one(
                {"timestamp": a["timestamp"]},
                {"$set": a},
                upsert=True
            )
        logger.info(f"🚨 {len(anomalies)} anomalies detected and saved to DB")
    else:
        logger.info("✅ No anomalies detected in recent readings")

    return anomalies