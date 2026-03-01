# ⚡ AiPECO — AI-Powered Energy Consumption Optimizer

> An IoT + AI system that monitors, forecasts, and optimizes household energy consumption in real-time using ESP32 sensors, LSTM neural networks, NILM appliance detection, and a React dashboard.

**Developed by:**
- Shoaib Akhtar (BSE-F22-M03)
- M Afseh Muneer (BSE-F22-M16)
- Bilal Ahmad (BSE-F22-M32)

**University of Mianwali — Final Year Project (FYP)**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Hardware Requirements](#hardware-requirements)
- [Wiring Guide](#wiring-guide)
- [Software Requirements](#software-requirements)
- [Installation](#installation)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [ESP32 Setup](#esp32-setup)
- [Running the Project](#running-the-project)
- [API Endpoints](#api-endpoints)
- [How the ML Models Work](#how-the-ml-models-work)
- [0-5V Scaling Explained](#0-5v-scaling-explained)
- [Scheduled Jobs](#scheduled-jobs)
- [Troubleshooting](#troubleshooting)
- [Team](#team)

---

## Overview

AiPECO is a stand-alone embedded AI system that uses an **ESP32 microcontroller** to collect real-time household energy data and send it to a **Flask backend** running machine learning models. A **React dashboard** visualizes live readings, forecasts, appliance states, and anomalies.

The system runs **entirely locally** — no cloud required. All ML processing happens on your laptop.

---

## Features

| Feature | Description | SRS Requirement |
|---|---|---|
| ⚡ Real-Time Monitoring | Live current, voltage, power, temperature, humidity | FR-1, FR-2 |
| 🔌 Appliance Detection (NILM) | ON/OFF state, power draw, load factor per appliance | FR-3, FR-4 |
| 📈 Energy Forecasting | LSTM 7-day consumption prediction | FR-5, FR-6 |
| 🚨 Anomaly Detection | Z-score based spike and overload detection | FR-7, FR-8 |
| 🤖 RL Optimization | Reinforcement learning appliance schedule suggestions | FR-9, FR-10 |
| 📡 Adaptive Sampling | Dynamic sampling rate based on usage patterns | FR-11 |
| 🎤 Voice Commands | Microphone trigger + Flask NLP parser | FR-12 |
| ⌨️ Text Commands | Serial Monitor and dashboard text control | FR-13 |

---

## System Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   ESP32 + Sensors│  WiFi  │   Flask Backend       │  HTTP   │  React Frontend │
│                 │ ──────► │                       │ ◄────── │                 │
│  SCT-013        │         │  - LSTM Model         │         │  - Dashboard    │
│  ZMPT101B       │  JSON   │  - NILM Model         │  JSON   │  - Forecast     │
│  DHT22          │  POST   │  - Anomaly Detection  │  GET    │  - Appliances   │
│  Relay          │         │  - APScheduler Jobs   │         │  - Anomalies    │
│  OLED Display   │         │  - MongoDB Storage    │         │  - Train Models │
└─────────────────┘         └──────────────────────┘         └─────────────────┘
```

**Data Flow:**
```
ESP32 reads sensors every 2s
    → scales to 0-5V range
    → sends JSON to Flask via WiFi
        → Flask stores in MongoDB
        → NILM runs on latest reading
        → Anomaly detection runs
        → Dashboard auto-refreshes
```

---

## Project Structure

```
aipeco/
│
├── README.md                          ← You are here
│
├── backend/                           ← Python Flask + ML
│   ├── app.py                         ← Main Flask app + all API routes
│   ├── config.py                      ← MongoDB URI, model settings, intervals
│   ├── scheduler.py                   ← APScheduler background jobs
│   ├── voice_command_routes.py        ← Voice + text command routes (add to app.py)
│   ├── requirements.txt               ← Python dependencies
│   ├── data/
│   │   └── household_power_consumption.txt  ← UCI dataset (download separately)
│   ├── saved_models/                  ← Auto-created when you train models
│   ├── models/
│   │   ├── __init__.py
│   │   ├── lstm_model.py              ← LSTM energy forecasting
│   │   └── nilm_model.py             ← NILM appliance detection + anomaly
│   └── utils/
│       ├── __init__.py
│       ├── data_loader.py             ← Loads UCI dataset (first 20k rows)
│       ├── preprocessing.py           ← 0-5V scaling + normalization
│       └── db.py                      ← MongoDB connection helper
│
├── frontend/                          ← React Dashboard
│   ├── package.json
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.jsx                    ← Router (5 pages)
│       ├── index.jsx
│       ├── styles/
│       │   └── App.css
│       ├── services/
│       │   └── api.js                 ← All Axios calls to Flask
│       └── components/
│           ├── Navbar.jsx             ← Navigation + backend status indicator
│           ├── Dashboard.jsx          ← Live readings + real-time chart
│           ├── ForecastChart.jsx      ← LSTM 7/14/30-day forecast
│           ├── NILMPanel.jsx          ← Appliance states panel
│           ├── AnomalyAlerts.jsx      ← Anomaly detection log
│           └── TrainModels.jsx        ← Train ML models from UI
│
└── esp32/                             ← ESP32 Arduino/PlatformIO Code
    ├── WIRING_GUIDE.txt               ← Full wiring instructions
    ├── ARDUINO_SETUP.txt              ← Arduino IDE setup steps
    ├── AiPECO_Main/                   ← Main sensor firmware
    │   ├── main.cpp                   ← (PlatformIO) or AiPECO_Main.ino (Arduino)
    │   ├── AiPECO_Config.h            ← ALL settings: WiFi, pins, calibration
    │   ├── AiPECO_Scale.h             ← 0-5V scaling functions
    │   └── AiPECO_Sensors.h           ← Sensor self-test functions
    └── AiPECO_Voice/
        └── AiPECO_Voice.ino           ← Voice + text command handler
```

---

## Hardware Requirements

### Mandatory
| Component | Purpose | GPIO |
|---|---|---|
| ESP32 DevKit V1 | Main microcontroller | — |
| SCT-013-000 (100A) | AC current sensing | GPIO 34 |
| ZMPT101B | AC voltage sensing | GPIO 35 |
| DHT22 | Temperature + humidity | GPIO 4 |
| Relay Module (5V) | Appliance control | GPIO 26 |
| 33Ω resistor | SCT-013 burden resistor | — |
| 10kΩ resistors × 3 | Bias + DHT22 pull-up | — |

### Optional
| Component | Purpose |
|---|---|
| SSD1306 OLED (128×64) | Live display (I2C: GPIO 21/22) |
| MAX9814 Microphone | Voice command trigger (GPIO 33) |
| INA219 | More accurate power measurement |
| SD Card Module | Offline data logging |

---

## Wiring Guide

### SCT-013 Current Sensor
```
ESP32 3.3V ──── 10kΩ ────┐
                          ├──── GPIO 34 (ADC1)
ESP32 GND  ──── 10kΩ ────┘
                          │
SCT-013 TIP ──── 33Ω ────┘
SCT-013 RING/SLEEVE ───── ESP32 GND
```

### ZMPT101B Voltage Sensor
```
ZMPT101B OUT ──── 10kΩ ──── GPIO 35 ──── 6.8kΩ ──── GND
```
> ⚠️ Voltage divider is REQUIRED. ZMPT101B outputs 5V, ESP32 ADC max is 3.3V.

### DHT22
```
DHT22 VCC  ──── ESP32 3.3V
DHT22 DATA ──── GPIO 4 ──── 10kΩ pull-up to 3.3V
DHT22 GND  ──── ESP32 GND
```

### Relay
```
Relay VCC ──── ESP32 5V (VIN)
Relay GND ──── ESP32 GND
Relay IN  ──── GPIO 26
```

### OLED (optional)
```
OLED VCC ──── ESP32 3.3V
OLED GND ──── ESP32 GND
OLED SDA ──── GPIO 21
OLED SCL ──── GPIO 22
```

> ⚠️ **Safety:** Only connect the relay's LOW-VOLTAGE control side. Never connect relay contacts directly to 220V mains AC without a properly isolated relay module.

---

## Software Requirements

### Backend
- Python 3.9 or higher
- MongoDB Community (local)

### Frontend
- Node.js 16 or higher
- npm

### ESP32
- VS Code + PlatformIO extension
  OR
- Arduino IDE 2.x with ESP32 board package

---

## Installation

### Backend Setup

**1. Navigate to backend folder**
```bash
cd aipeco/backend
```

**2. Install Python dependencies**
```bash
pip install -r requirements.txt
```

If tensorflow fails:
```bash
pip install tensorflow-cpu
```

**3. Install and start MongoDB**

Download from [mongodb.com](https://www.mongodb.com/try/download/community) then:
```bash
# Windows
net start MongoDB

# Linux/Mac
sudo systemctl start mongod
```

**4. Download UCI Dataset**

Download from [UCI ML Repository](https://archive.ics.uci.edu/ml/datasets/Individual+household+electric+power+consumption)

Place the file at:
```
aipeco/backend/data/household_power_consumption.txt
```

**5. Edit config.py (optional)**
```python
MONGO_URI = "mongodb://localhost:27017/"   # change if using MongoDB Atlas
DB_NAME   = "aipeco_db"
```

---

### Frontend Setup

**1. Navigate to frontend folder**
```bash
cd aipeco/frontend
```

**2. Install dependencies**
```bash
npm install
```

---

### ESP32 Setup (PlatformIO)

**1. Open VS Code**

**2. Install PlatformIO extension**
```
VS Code → Extensions (Ctrl+Shift+X) → Search "PlatformIO" → Install
```

**3. Create new PlatformIO project**
```
PlatformIO icon → Open → Create New Project
Name:      AiPECO_Main
Board:     Espressif ESP32 Dev Module
Framework: Arduino
Location:  aipeco/esp32/
```

**4. Replace platformio.ini with:**
```ini
[env:esp32dev]
platform      = espressif32
board         = esp32dev
framework     = arduino
monitor_speed = 115200
upload_speed  = 921600

lib_deps =
    adafruit/DHT sensor library
    adafruit/Adafruit Unified Sensor
    adafruit/Adafruit SSD1306
    adafruit/Adafruit GFX Library
    bblanchon/ArduinoJson @ ^6.21.0
```

**5. Edit src/main.cpp**

Add `#include <Arduino.h>` as the first line, then paste all code from `AiPECO_Main.ino` below it.

**6. Add header files to include/ folder**

Copy these files into `include/`:
- `AiPECO_Config.h`
- `AiPECO_Scale.h`
- `AiPECO_Sensors.h`

**7. Edit AiPECO_Config.h — change these 3 lines:**
```cpp
#define WIFI_SSID         "YOUR_WIFI_NAME"     // your WiFi SSID
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"  // your WiFi password
#define FLASK_SERVER_IP   "192.168.1.100"       // your laptop's local IP
```

Find your laptop IP:
```bash
# Windows
ipconfig
# Look for IPv4 Address under WiFi adapter

# Linux/Mac
ifconfig
```

**8. Upload to ESP32**
```
PlatformIO → Project Tasks → AiPECO_Main → Build
PlatformIO → Project Tasks → AiPECO_Main → Upload
PlatformIO → Project Tasks → AiPECO_Main → Monitor
```

---

## Running the Project

### Step 1 — Start MongoDB
```bash
net start MongoDB
```

### Step 2 — Start Flask Backend
```bash
cd aipeco/backend
python app.py
```
You should see:
```
✅ MongoDB connected successfully
✅ AiPECO Backend ready on http://localhost:5000
```

### Step 3 — Start React Frontend
```bash
cd aipeco/frontend
npm start
```
Opens at: `http://localhost:3000`

### Step 4 — Upload ESP32 Firmware
```
PlatformIO → Upload
```
Check Serial Monitor — should show sensor readings every 2 seconds.

### Step 5 — Train ML Models
```
Open browser → http://localhost:3000
Click "Train Models" in navbar
Click "Train Both Models Now"
Wait 2-5 minutes
```

### Step 6 — View Live Data
```
Dashboard   → live sensor readings + chart
Appliances  → NILM appliance states
Forecast    → 7-day energy prediction
Anomalies   → detected consumption spikes
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/train` | Train LSTM + NILM models on UCI dataset |
| `GET` | `/api/forecast?days=7` | Get LSTM energy forecast |
| `GET` | `/api/nilm` | Get appliance state predictions |
| `GET` | `/api/nilm/history` | Get NILM prediction history |
| `POST` | `/api/readings` | Store ESP32 sensor reading |
| `GET` | `/api/readings?limit=100` | Get recent readings |
| `GET` | `/api/anomalies` | Get anomaly detections |
| `GET` | `/api/status` | Get model training status |
| `GET` | `/api/health` | Backend health check |
| `POST` | `/api/text_command` | Send text command to ESP32 |
| `POST` | `/api/voice_trigger` | Process voice trigger event |
| `GET` | `/api/commands` | Get command history |

### Example: Send a test reading
```bash
curl -X POST http://localhost:5000/api/readings \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ESP32_AiPECO_01",
    "current": 2.31,
    "voltage": 220.4,
    "active_power": 0.512,
    "temperature": 28.1,
    "humidity": 65.0,
    "sub1": 5.1,
    "sub2": 0.0,
    "sub3": 18.2
  }'
```

---

## How the ML Models Work

### LSTM Energy Forecasting
```
Training data:  UCI Household Power Consumption (first 20,000 rows)
Architecture:   LSTM(128) → Dropout → LSTM(64) → Dropout → Dense(32) → Dense(1)
Input:          60 past time steps (1 minute each)
Output:         Next 7 days energy consumption (kWh/day)
Target metric:  MAE < 0.05 kW
```

### NILM Appliance Detection
```
Training data:  UCI sub-metering columns (sub1, sub2, sub3)
Architecture:   Dense(128) → Dropout → Dense(64) → Dense(32) → [State output + Power output]
Output 1:       ON/OFF state per appliance (sigmoid, 0-1 probability)
Output 2:       Estimated power draw in Watts (linear regression)
Appliances:     Kitchen, Laundry, Water Heater/AC, Lighting/Other
Target metric:  Accuracy > 80% (FR-4 from SRS)
```

### Anomaly Detection
```
Method:     Z-score analysis on last 200 readings
Threshold:  Z-score > 2.5 = anomaly flagged
Severity:   HIGH if Z > 3.75, MEDIUM if Z > 2.5
Storage:    Saved to MongoDB anomalies collection
```

---

## 0-5V Scaling Explained

The ESP32 ADC reads **0 to 3.3V** physically. But the AiPECO ML backend expects sensor values in **0 to 5V range** to match the IoT prototype specification.

**Scaling pipeline:**
```
Real world value (e.g. 2.5A current)
    → ADC pin voltage (0-3.3V after voltage divider)
    → Scaled to 0-5V range
    → Sent to Flask as current_5v field
    → Python preprocessing.py normalizes to 0-1 for ML model
```

**Formula used:**
```
scaled_5v = (value - in_min) / (in_max - in_min) * 5.0
```

This is implemented in:
- ESP32 side: `AiPECO_Scale.h → scaleToRange()`
- Python side: `utils/preprocessing.py → scale_to_5v()`

---

## Scheduled Jobs

The Flask backend runs 3 automatic background jobs using APScheduler:

| Job | Interval | What it does |
|---|---|---|
| NILM Detection | Every 5 minutes | Runs appliance detection on latest reading |
| Anomaly Scan | Every 1 hour | Scans last 200 readings for anomalies |
| LSTM Retrain | Every 24 hours | Retrains forecast model with new data |

Jobs start automatically when `python app.py` is run.

---

## Troubleshooting

### Backend Issues

**MongoDB connection failed**
```bash
# Start MongoDB service
net start MongoDB          # Windows
sudo systemctl start mongod  # Linux
```

**Module not found error**
```bash
# Make sure you are inside the backend/ folder
cd aipeco/backend
python app.py

# Also make sure __init__.py exists in models/ and utils/
```

**TensorFlow installation fails**
```bash
pip install tensorflow-cpu
# or for Python 3.12+
pip install --upgrade tensorflow
```

**UCI dataset not found**
```
Download from UCI ML Repository and place at:
aipeco/backend/data/household_power_consumption.txt
```

---

### ESP32 Issues

**WiFi not connecting**
```
- Check WIFI_SSID and WIFI_PASSWORD in AiPECO_Config.h
- ESP32 only supports 2.4GHz WiFi, NOT 5GHz
- Make sure phone hotspot or router is 2.4GHz
```

**HTTP send failing**
```
- Check FLASK_SERVER_IP is your laptop's local IP
- Run ipconfig (Windows) to find your IPv4 address
- Make sure Flask is running on port 5000
- Laptop and ESP32 must be on same WiFi network
```

**DHT22 read failed**
```
- Add 10kΩ pull-up resistor between DATA pin and 3.3V
- Check VCC is connected to 3.3V not 5V
```

**SCT-013 always reads 0A**
```
- Check burden resistor (33Ω) is connected
- Check bias resistors (2x 10kΩ) are connected
- Verify SCT-013 is clamped around a LIVE wire (not both wires)
- Adjust SCT013_CALIBRATION in config
```

**OLED not working**
```
- Try changing OLED_I2C_ADDRESS from 0x3C to 0x3D
- Check SDA on GPIO 21 and SCL on GPIO 22
```

**Upload fails in PlatformIO**
```
- Hold BOOT button on ESP32 while clicking Upload
- Release after "Connecting..." appears
- Add upload_port = COM4 (your port) to platformio.ini
```

---

### Frontend Issues

**Cannot connect to backend**
```
- Make sure Flask is running: python app.py
- Check http://localhost:5000/api/health in browser
- Green dot in navbar = connected, red = not connected
```

**npm install fails**
```bash
# Try clearing cache
npm cache clean --force
npm install
```

---

## Testing Without Hardware

If sensors are not yet connected, simulate ESP32 data by running:

```python
# Save as: aipeco/backend/test_fake_data.py
# Run with: python test_fake_data.py

import requests
import random
import time

print("Sending fake sensor data to Flask...")
print("Press Ctrl+C to stop\n")

while True:
    data = {
        "device_id"   : "ESP32_AiPECO_01",
        "current"     : round(random.uniform(0.5, 4.0), 2),
        "voltage"     : round(random.uniform(215, 225), 1),
        "temperature" : round(random.uniform(24, 32), 1),
        "humidity"    : round(random.uniform(40, 70), 1),
        "active_power": round(random.uniform(0.1, 0.9), 4),
        "sub1"        : round(random.uniform(0, 15), 2),
        "sub2"        : round(random.uniform(0, 10), 2),
        "sub3"        : round(random.uniform(5, 25), 2),
    }
    response = requests.post("http://localhost:5000/api/readings", json=data)
    print(f"Sent: {data['active_power']} kW → HTTP {response.status_code}")
    time.sleep(2)
```

---

## Team

| Name | Roll Number | Role |
|---|---|---|
| Shoaib Akhtar | BSE-F22-M03 | ML Models + Backend |
| M Afseh Muneer | BSE-F22-M16 | ESP32 + Hardware |
| Bilal Ahmad | BSE-F22-M32 | Frontend + Dashboard |

**Supervisor:** University of Mianwali
**Submitted:** January 2026

---

## References

1. IEEE Std-830 SRS Guidelines
2. ESP32 Technical Documentation — Espressif Systems
3. UCI ML Repository — Household Electric Power Consumption Dataset
4. NILM Research Publications
5. TensorFlow Keras Documentation
6. Reinforcement Learning Literature

---

*AiPECO — University of Mianwali Final Year Project 2026*
