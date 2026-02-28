# =====================================================
# utils/data_loader.py - UCI Dataset Loader
# =====================================================
# Loads the UCI Household Electric Power Consumption
# dataset and returns the first 20,000 rows as a
# clean pandas DataFrame.
#
# Dataset columns:
#   Date, Time, Global_active_power, Global_reactive_power,
#   Voltage, Global_intensity, Sub_metering_1,
#   Sub_metering_2, Sub_metering_3
#
# Download from:
#   https://archive.ics.uci.edu/ml/datasets/
#   Individual+household+electric+power+consumption
# =====================================================

import pandas as pd
import numpy as np
import os
import logging
import config

logger = logging.getLogger(__name__)


def load_uci_dataset(filepath: str = None, nrows: int = None) -> pd.DataFrame:
    """
    Loads UCI Household Power Consumption dataset.

    Args:
        filepath: Path to household_power_consumption.txt
                  Defaults to config.UCI_DATA_PATH
        nrows:    Number of rows to load.
                  Defaults to config.UCI_ROWS_LIMIT (20000)

    Returns:
        Clean pandas DataFrame with numeric columns and datetime index.
    """
    filepath = filepath or config.UCI_DATA_PATH
    nrows    = nrows    or config.UCI_ROWS_LIMIT

    # --- Check if file exists ---
    if not os.path.exists(filepath):
        raise FileNotFoundError(
            f"UCI dataset not found at: {filepath}\n"
            "Download from: https://archive.ics.uci.edu/ml/datasets/"
            "Individual+household+electric+power+consumption\n"
            "Place the file at: backend/data/household_power_consumption.txt"
        )

    logger.info(f"📂 Loading UCI dataset (first {nrows} rows) from: {filepath}")

    # --- Load CSV (semicolon-separated) ---
    df = pd.read_csv(
        filepath,
        sep=";",
        nrows=nrows,
        na_values=["?"],          # Dataset uses "?" for missing values
        low_memory=False
    )

    # --- Combine Date + Time into a single datetime index ---
    df["datetime"] = pd.to_datetime(
        df["Date"] + " " + df["Time"],
        format="%d/%m/%Y %H:%M:%S",
        dayfirst=True
    )
    df.set_index("datetime", inplace=True)
    df.drop(columns=["Date", "Time"], inplace=True)

    # --- Rename columns to shorter names ---
    df.rename(columns={
        "Global_active_power"   : "active_power",
        "Global_reactive_power" : "reactive_power",
        "Voltage"               : "voltage",
        "Global_intensity"      : "intensity",
        "Sub_metering_1"        : "sub1",
        "Sub_metering_2"        : "sub2",
        "Sub_metering_3"        : "sub3",
    }, inplace=True)

    # --- Convert all columns to numeric (coerce bad values to NaN) ---
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # --- Fill missing values using forward fill, then back fill ---
    # This is standard for time-series sensor data
    df.fillna(method="ffill", inplace=True)
    df.fillna(method="bfill", inplace=True)

    # --- Drop any remaining NaN rows ---
    original_len = len(df)
    df.dropna(inplace=True)
    dropped = original_len - len(df)
    if dropped > 0:
        logger.warning(f"⚠️  Dropped {dropped} rows with NaN values")

    logger.info(f"✅ UCI dataset loaded: {len(df)} rows, {len(df.columns)} features")
    logger.info(f"   Date range: {df.index.min()} → {df.index.max()}")
    logger.info(f"   Columns: {list(df.columns)}")

    return df


def get_feature_columns() -> list:
    """
    Returns the list of feature columns used for model input.
    These are used consistently across LSTM and NILM models.
    """
    return ["active_power", "reactive_power", "voltage", "intensity",
            "sub1", "sub2", "sub3"]


def get_target_column() -> str:
    """
    Returns the main target column for LSTM forecasting.
    """
    return "active_power"