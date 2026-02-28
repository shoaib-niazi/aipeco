# =====================================================
# models/lstm_model.py - LSTM Energy Forecasting Model
# =====================================================
# Uses a stacked LSTM (Long Short-Term Memory) neural
# network to predict household energy consumption for
# the next 7 days using the past 60-step history.
#
# Architecture:
#   Input → LSTM(128) → Dropout → LSTM(64) → Dropout
#         → Dense(32) → Dense(1) → Output
#
# Training data: UCI dataset (first 20,000 rows)
# Target:        active_power (global active power in kW)
# =====================================================

import numpy as np
import os
import logging
import json
from datetime import datetime, timedelta
from sklearn.metrics import mean_absolute_error, mean_squared_error

import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau

import config
from utils.data_loader import load_uci_dataset, get_feature_columns, get_target_column
from utils.preprocessing import prepare_training_data, denormalize_target, normalize_features
from utils.preprocessing import create_sequences, scale_to_5v

logger = logging.getLogger(__name__)

# --- Module-level model reference ---
_lstm_model = None


def build_lstm_model(seq_length: int, n_features: int) -> tf.keras.Model:
    """
    Builds a stacked LSTM model for time-series energy forecasting.

    Args:
        seq_length: Number of past time steps (e.g., 60)
        n_features: Number of input features (e.g., 7 for UCI)

    Returns:
        Compiled Keras Sequential model
    """
    model = Sequential([
        Input(shape=(seq_length, n_features)),

        # First LSTM layer: 128 units, returns sequences for next LSTM
        LSTM(128, return_sequences=True, name="lstm_layer_1"),
        Dropout(0.2, name="dropout_1"),  # 20% dropout to prevent overfitting

        # Second LSTM layer: 64 units, returns single output
        LSTM(64, return_sequences=False, name="lstm_layer_2"),
        Dropout(0.2, name="dropout_2"),

        # Dense layers to compress to single prediction
        Dense(32, activation="relu", name="dense_1"),
        Dense(1, activation="linear", name="output"),  # Linear = regression output
    ], name="AiPECO_LSTM_Forecaster")

    # Adam optimizer with MSE loss (standard for regression)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="mean_squared_error",
        metrics=["mae"]
    )

    model.summary(print_fn=logger.info)
    return model


def train_lstm(save: bool = True) -> dict:
    """
    Full training pipeline for the LSTM forecasting model.

    Steps:
    1. Load UCI dataset (first 20k rows)
    2. Scale to 0-5V (prototype range)
    3. Normalize and create sequences
    4. Build and train LSTM
    5. Save model to disk
    6. Return performance metrics

    Args:
        save: If True, saves model to config.LSTM_MODEL_PATH

    Returns:
        Dict with training metrics {mae, rmse, epochs_run, trained_at}
    """
    global _lstm_model
    logger.info("🚀 Starting LSTM model training...")

    # --- Load dataset ---
    df = load_uci_dataset()
    feature_cols = get_feature_columns()
    target_col   = get_target_column()

    # --- Prepare sequences (scales to 0-5V internally) ---
    X, y = prepare_training_data(
        df,
        feature_cols=feature_cols,
        target_col=target_col,
        seq_length=config.LSTM_SEQUENCE_LENGTH
    )

    # --- Train/test split (80/20, no shuffle for time-series!) ---
    split = int(0.8 * len(X))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    logger.info(f"📊 Train size: {len(X_train)}, Test size: {len(X_test)}")

    # --- Build model ---
    n_features = X.shape[2]  # Number of feature columns
    model = build_lstm_model(config.LSTM_SEQUENCE_LENGTH, n_features)

    # --- Callbacks: stop early if no improvement, reduce LR on plateau ---
    callbacks = [
        EarlyStopping(
            monitor="val_loss",
            patience=5,             # Stop if no improvement for 5 epochs
            restore_best_weights=True,
            verbose=1
        ),
        ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,             # Halve learning rate on plateau
            patience=3,
            min_lr=1e-6,
            verbose=1
        )
    ]

    # --- Train ---
    history = model.fit(
        X_train, y_train,
        epochs=config.LSTM_EPOCHS,
        batch_size=config.LSTM_BATCH_SIZE,
        validation_data=(X_test, y_test),
        callbacks=callbacks,
        verbose=1
    )

    # --- Evaluate on test set ---
    y_pred_norm = model.predict(X_test, verbose=0).flatten()
    y_pred_real = denormalize_target(y_pred_norm)
    y_test_real = denormalize_target(y_test)

    mae  = float(mean_absolute_error(y_test_real, y_pred_real))
    rmse = float(np.sqrt(mean_squared_error(y_test_real, y_pred_real)))

    logger.info(f"✅ LSTM Training complete → MAE: {mae:.4f} kW, RMSE: {rmse:.4f} kW")
    logger.info(f"   Epochs run: {len(history.history['loss'])}")

    # --- Save model ---
    if save:
        os.makedirs(config.MODELS_DIR, exist_ok=True)
        model.save(config.LSTM_MODEL_PATH)
        logger.info(f"💾 LSTM model saved to: {config.LSTM_MODEL_PATH}")

    _lstm_model = model  # Cache in memory

    return {
        "mae"        : round(mae, 4),
        "rmse"       : round(rmse, 4),
        "epochs_run" : len(history.history["loss"]),
        "trained_at" : datetime.utcnow().isoformat()
    }


def load_lstm_model():
    """
    Loads the LSTM model from disk into memory.
    Call this at app startup if a pre-trained model exists.
    """
    global _lstm_model
    if os.path.exists(config.LSTM_MODEL_PATH):
        _lstm_model = load_model(config.LSTM_MODEL_PATH)
        logger.info(f"✅ LSTM model loaded from: {config.LSTM_MODEL_PATH}")
    else:
        logger.warning("⚠️  No saved LSTM model found. Train first via POST /api/train")


def get_forecast(n_days: int = None) -> dict:
    """
    Generates energy consumption forecast for the next N days
    using the trained LSTM model.

    Uses the last SEQUENCE_LENGTH readings from MongoDB as input.
    Falls back to UCI dataset tail if no DB readings exist.

    Args:
        n_days: Number of days to forecast (default: config.LSTM_FORECAST_DAYS)

    Returns:
        Dict with forecast values and corresponding dates:
        { "forecast": [1.2, 1.4, ...], "dates": ["2026-01-06", ...],
          "unit": "kWh/day", "generated_at": "..." }
    """
    global _lstm_model
    n_days = n_days or config.LSTM_FORECAST_DAYS

    if _lstm_model is None:
        load_lstm_model()
    if _lstm_model is None:
        raise RuntimeError("LSTM model not trained. Call POST /api/train first.")

    # --- Get last seq_length readings to use as seed input ---
    from utils.db import readings_col
    from utils.preprocessing import preprocess_live_reading

    feature_cols = get_feature_columns()
    seq_length   = config.LSTM_SEQUENCE_LENGTH

    # Try to get recent readings from MongoDB
    recent = list(readings_col().find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(seq_length))

    if len(recent) >= seq_length:
        # Use real MongoDB readings as seed
        recent.reverse()  # Oldest first
        features = np.array([[r.get(col, 0.0) for col in feature_cols] for r in recent])
        features_5v   = scale_to_5v(features, fit=False)
        features_norm = normalize_features(features_5v)
        seed_sequence = features_norm  # [seq_length, n_features]
        logger.info(f"📡 Using {len(recent)} live DB readings as forecast seed")
    else:
        # Fallback: use tail of UCI dataset
        logger.warning("⚠️  Not enough DB readings. Using UCI dataset tail as seed.")
        df = load_uci_dataset()
        X_all, _ = prepare_training_data(df, feature_cols, get_target_column(), seq_length)
        seed_sequence = X_all[-1]  # Last sequence from training data

    # --- Auto-regressive multi-step forecasting ---
    # Predict one step ahead, feed it back as input, repeat for n_days steps
    # n_days * 24 * 60 = minutes per n days (dataset is 1-min resolution)
    steps = n_days * 24 * 60
    predictions = []
    current_seq = seed_sequence.copy()  # [seq_length, n_features]

    for step in range(steps):
        # Reshape to [1, seq_length, n_features] for model input
        input_seq = current_seq[np.newaxis, :, :]

        # Get next predicted value (normalized)
        pred_norm = _lstm_model.predict(input_seq, verbose=0)[0][0]
        predictions.append(pred_norm)

        # Slide the window: drop oldest, append newest prediction
        # We use the prediction as the first feature (active_power) for next step
        new_step = current_seq[-1].copy()
        new_step[0] = pred_norm  # Update active_power column with prediction
        current_seq = np.vstack([current_seq[1:], new_step])

    # --- Aggregate minute-level predictions to daily totals ---
    predictions = np.array(predictions)
    daily_preds_norm = predictions.reshape(n_days, 24 * 60).mean(axis=1)

    # --- Denormalize back to real kW values ---
    daily_preds_kw = denormalize_target(daily_preds_norm)
    # Convert kW (average) to kWh/day (multiply by 24 hours)
    daily_kwh = (daily_preds_kw * 24).tolist()

    # --- Generate date labels starting from tomorrow ---
    start_date = datetime.utcnow().date() + timedelta(days=1)
    dates = [(start_date + timedelta(days=i)).isoformat() for i in range(n_days)]

    logger.info(f"📈 Forecast generated for {n_days} days: {[round(v, 3) for v in daily_kwh]} kWh/day")

    return {
        "forecast"     : [round(v, 4) for v in daily_kwh],
        "dates"        : dates,
        "unit"         : "kWh/day",
        "generated_at" : datetime.utcnow().isoformat(),
        "n_days"       : n_days
    }