/*
 * =====================================================
 * AiPECO_Config.h
 * =====================================================
 * HOW TO USE THIS FILE:
 * 1. Go to your aipeco/esp32/AiPECO_Main/ folder
 * 2. Create a new file called "AiPECO_Config.h"
 *    - Right click -> New -> Text Document
 *    - Rename to AiPECO_Config.h
 *    - Click Yes when Windows warns about extension
 * 3. Open with Notepad
 * 4. Copy everything below and paste it in
 * 5. Save and close
 *
 * IMPORTANT: Edit the WiFi and server settings below!
 * =====================================================
 */

#ifndef AIPECO_CONFIG_H
#define AIPECO_CONFIG_H

// =====================================================
// 1. NETWORK SETTINGS  <-- EDIT THESE
// =====================================================

#define WIFI_SSID         "YOUR_WIFI_SSID"        // <- your WiFi name
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"     // <- your WiFi password

// Your laptop's local IP address (where Flask is running)
// Find it by running: ipconfig (Windows) or ifconfig (Linux/Mac)
// Look for IPv4 Address under your WiFi adapter
#define FLASK_SERVER_IP   "192.168.1.100"          // <- change this
#define FLASK_SERVER_PORT "5000"

#define DEVICE_ID         "ESP32_AiPECO_01"
#define FIRMWARE_VERSION  "1.0"


// =====================================================
// 2. GPIO PIN ASSIGNMENTS
// =====================================================
// IMPORTANT: Only use ADC1 pins (GPIO 32-39) for analog sensors
// ADC2 pins are DISABLED when WiFi is ON on ESP32

#define CURRENT_SENSOR_PIN  34    // ACS712 output -> GPIO 34
#define VOLTAGE_SENSOR_PIN  35    // ZMPT101B output -> GPIO 35
#define DHT_PIN             4     // DHT22 data pin -> GPIO 4
#define RELAY_PIN           26    // Relay IN pin -> GPIO 26
#define STATUS_LED_PIN      2     // Built-in LED on most ESP32 boards
#define I2C_SDA_PIN         21    // OLED SDA
#define I2C_SCL_PIN         22    // OLED SCL
#define MIC_PIN             33    // Microphone output -> GPIO 33


// =====================================================
// 3. OLED DISPLAY (SSD1306)
// =====================================================

#define OLED_WIDTH        128
#define OLED_HEIGHT       64
#define OLED_RESET_PIN    -1       // share ESP32 reset
#define OLED_I2C_ADDRESS  0x3C    // try 0x3D if display not working


// =====================================================
// 4. ADC SETTINGS
// =====================================================

#define ADC_MAX_VALUE     4095.0   // 12-bit ADC: 0 to 4095
#define ADC_REF_VOLTAGE   3.3      // ESP32 ADC max = 3.3V

// Voltage divider ratio
// REQUIRED because sensors output 5V but ESP32 ADC max is 3.3V
// Wiring: Sensor OUT -> R1(10k) -> ADC Pin -> R2(6.8k) -> GND
// Ratio = R2 / (R1 + R2) = 6800 / 16800 = 0.405
// This means 5V x 0.405 = 2.02V at ADC pin (safe)
#define VOLTAGE_DIVIDER_RATIO  0.405


// =====================================================
// 5. ACS712 CURRENT SENSOR
// =====================================================

// Sensitivity depends on which model you have:
// ACS712-5A  -> 0.185 V/A  (use this for prototype)
// ACS712-20A -> 0.100 V/A
// ACS712-30A -> 0.066 V/A
#define ACS712_SENSITIVITY    0.185   // V/A
#define ACS712_MAX_CURRENT    5.0     // Amps (max measurable)

// At 0 amps, ACS712 outputs 2.5V (on 5V supply)
// After voltage divider: 2.5 x 0.405 = 1.013V at ADC pin
// Fine-tune this if your zero reading is not accurate
#define ACS712_ZERO_OFFSET_V  1.013


// =====================================================
// 6. ZMPT101B VOLTAGE SENSOR
// =====================================================

// Calibration factor - adjust until reading matches multimeter
// How to calibrate:
//   1. Measure actual voltage with multimeter (e.g. 221V)
//   2. Note what Serial Monitor shows (e.g. 180V)
//   3. Set factor = 221 / 180 = 1.228
// Start with 1.2 and adjust from there
#define ZMPT101B_CALIBRATION  1.2

// Fallback voltage if sensor reading is out of range
// Pakistan/South Asia = 220V, Europe = 230V, USA = 120V
#define NOMINAL_VOLTAGE       220.0


// =====================================================
// 7. POWER CALCULATION
// =====================================================

// Power Factor for home appliances
// Resistive loads (heaters, bulbs) = 1.0
// Motors, AC units = 0.7 to 0.85
// Mixed household = 0.85 (good default)
#define POWER_FACTOR      0.85

// Sub-metering fractions (must add up to less than 1.0)
// These estimate how much of total power goes to each circuit
#define SUB1_FRACTION     0.30    // Kitchen appliances
#define SUB2_FRACTION     0.20    // Laundry
#define SUB3_FRACTION     0.40    // Water heater / AC


// =====================================================
// 8. RELAY POLARITY
// =====================================================

// Most relay modules are ACTIVE LOW:
//   Send LOW  -> relay coil ON  -> contacts CLOSED -> appliance ON
//   Send HIGH -> relay coil OFF -> contacts OPEN   -> appliance OFF
#define RELAY_ON    LOW
#define RELAY_OFF   HIGH


// =====================================================
// 9. TIMING
// =====================================================

// How often to read sensors and send to server (milliseconds)
// Minimum 2000ms because DHT22 needs 2 seconds between reads
#define SEND_INTERVAL_MS    2000   // 2 seconds

// Microphone trigger settings
#define MIC_THRESHOLD       2500   // ADC value (0-4095) above this = sound detected
#define MIC_SAMPLES         50     // samples to check per cycle
#define TRIGGER_COOLDOWN_MS 3000   // minimum ms between triggers


#endif