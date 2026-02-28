# =====================================================
# scheduler.py - AiPECO Background Job Scheduler
# =====================================================
# Uses APScheduler to run background tasks automatically.
#
# Scheduled jobs:
#   1. Every 5 minutes  → Run NILM detection on latest readings
#   2. Every 1 hour     → Run anomaly detection on DB readings
#   3. Every 24 hours   → Retrain LSTM with accumulated new data
#
# The scheduler runs in a background thread inside the
# same Flask process — no separate worker needed.
# =====================================================

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

import config

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler = None


# =====================================================
# Job Functions
# =====================================================

def job_nilm_detection():
    """
    JOB 1 — Runs every 5 minutes.

    Runs NILM appliance state detection on the latest
    sensor reading from MongoDB and stores the result.

    This keeps the dashboard's appliance panel up to date
    without the user needing to refresh or call the API.
    """
    logger.info(f"⏰ [Scheduler] Running NILM detection job at {datetime.utcnow().isoformat()}")
    try:
        from models.nilm_model import predict_appliance_states
        from utils.db import nilm_col

        result = predict_appliance_states()  # Uses latest reading from DB
        nilm_col().insert_one({**result, "scheduled_job": True})

        n_on = result["summary"]["appliances_on"]
        logger.info(f"   ✅ NILM job done — {n_on} appliances ON")

    except RuntimeError as e:
        # Model not trained yet or no readings in DB — skip silently
        logger.warning(f"   ⚠️  NILM job skipped: {e}")
    except Exception as e:
        logger.error(f"   ❌ NILM job error: {e}", exc_info=True)


def job_anomaly_detection():
    """
    JOB 2 — Runs every 1 hour.

    Scans the last 200 DB readings for anomalies using
    Z-score analysis and saves results to the anomalies collection.
    """
    logger.info(f"⏰ [Scheduler] Running anomaly detection job at {datetime.utcnow().isoformat()}")
    try:
        from models.nilm_model import detect_anomalies_from_history

        anomalies = detect_anomalies_from_history()
        logger.info(f"   ✅ Anomaly job done — {len(anomalies)} anomalies found")

    except Exception as e:
        logger.error(f"   ❌ Anomaly job error: {e}", exc_info=True)


def job_retrain_lstm():
    """
    JOB 3 — Runs every 24 hours.

    Retrains the LSTM forecasting model so it adapts to
    accumulated real readings stored in MongoDB.

    NOTE: This retrains on the UCI dataset (first 20k rows).
    In a production system, you would retrain on actual MongoDB
    readings accumulated over time (when enough data is available).
    """
    logger.info(f"⏰ [Scheduler] Running LSTM retraining job at {datetime.utcnow().isoformat()}")
    try:
        from models.lstm_model import train_lstm
        from utils.db import model_status_col

        metrics = train_lstm(save=True)

        # Update model status in MongoDB
        model_status_col().update_one(
            {"_id": "status"},
            {"$set": {
                "lstm_trained"    : True,
                "lstm_retrained_at": datetime.utcnow().isoformat(),
                "lstm_metrics"    : metrics
            }},
            upsert=True
        )

        logger.info(f"   ✅ LSTM retrain done — MAE: {metrics['mae']} kW")

    except FileNotFoundError:
        logger.warning("   ⚠️  UCI dataset not found. LSTM retrain skipped.")
    except Exception as e:
        logger.error(f"   ❌ LSTM retrain job error: {e}", exc_info=True)


# =====================================================
# Scheduler Startup
# =====================================================

def start_scheduler():
    """
    Initializes and starts the APScheduler BackgroundScheduler.

    Call this once from app.py startup().
    All jobs run in background threads — Flask API stays responsive.
    """
    global _scheduler

    if _scheduler is not None and _scheduler.running:
        logger.warning("⚠️  Scheduler already running — skipping start")
        return

    _scheduler = BackgroundScheduler(
        timezone="UTC",
        job_defaults={"misfire_grace_time": 60}  # Allow 60s late execution
    )

    # --- JOB 1: NILM Detection — every 5 minutes ---
    _scheduler.add_job(
        func=job_nilm_detection,
        trigger=IntervalTrigger(minutes=config.SCHEDULE_NILM_MINUTES),
        id="nilm_detection",
        name="NILM Appliance Detection",
        replace_existing=True
    )

    # --- JOB 2: Anomaly Detection — every 1 hour ---
    _scheduler.add_job(
        func=job_anomaly_detection,
        trigger=IntervalTrigger(hours=config.SCHEDULE_ANOMALY_HOURS),
        id="anomaly_detection",
        name="Anomaly Detection",
        replace_existing=True
    )

    # --- JOB 3: LSTM Retraining — every 24 hours ---
    _scheduler.add_job(
        func=job_retrain_lstm,
        trigger=IntervalTrigger(hours=config.SCHEDULE_RETRAIN_HOURS),
        id="lstm_retrain",
        name="LSTM Model Retraining",
        replace_existing=True
    )

    _scheduler.start()

    logger.info("✅ Background scheduler started with 3 jobs:")
    logger.info(f"   🔄 NILM Detection    → every {config.SCHEDULE_NILM_MINUTES} minutes")
    logger.info(f"   🔄 Anomaly Detection → every {config.SCHEDULE_ANOMALY_HOURS} hour(s)")
    logger.info(f"   🔄 LSTM Retrain      → every {config.SCHEDULE_RETRAIN_HOURS} hour(s)")


def stop_scheduler():
    """
    Gracefully shuts down the scheduler.
    Called automatically when Flask app exits (via atexit or SIGINT).
    """
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("🛑 Background scheduler stopped")