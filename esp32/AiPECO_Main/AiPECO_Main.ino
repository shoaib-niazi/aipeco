/*
 * =====================================================
 * AiPECO_Main.ino  —  ESP32 Firmware with SCT-013
 * =====================================================
 * HOW TO USE THIS FILE:
 * 1. Download this file
 * 2. Go to aipeco/esp32/AiPECO_Main/ folder
 * 3. Create a new file called "AiPECO_Main.ino"
 * 4. Copy everything below this comment into it
 * 5. Save and open in Arduino IDE
 * =====================================================
 *
 * CHANGES FROM ACS712 VERSION:
 *   - Uses SCT-013 current transformer instead of ACS712
 *   - SCT-013 clamps around the wire (no cutting needed)
 *   - Better AC current accuracy
 *   - Uses bias resistor midpoint for negative AC swing
 *   - Burden resistor converts current output to voltage
 *
 * WIRING:
 *   SCT-013 3.5mm jack:
 *     TIP    -> 33 ohm burden resistor -> GPIO 34
 *     RING   -> GND
 *     SLEEVE -> GND
 *
 *   Bias circuit on GPIO 34:
 *     3.3V -> 10k resistor -> GPIO 34 -> 10k resistor -> GND
 *     (This biases ADC midpoint to 1.65V so AC signal
 *      does not go below 0V which ESP32 cannot read)
 *
 *   ZMPT101B voltage sensor:
 *     OUT -> voltage divider (10k + 6.8k) -> GPIO 35
 *
 *   DHT22:
 *     DATA -> GPIO 4 (with 10k pull-up to 3.3V)
 *
 *   Relay:
 *     IN -> GPIO 26
 *
 *   OLED (optional):
 *     SDA -> GPIO 21
 *     SCL -> GPIO 22
 *
 * LIBRARIES TO INSTALL (Tools > Manage Libraries):
 *   - DHT sensor library      by Adafruit
 *   - Adafruit Unified Sensor by Adafruit
 *   - ArduinoJson             by Benoit Blanchon (v6.x)
 *   - Adafruit SSD1306        by Adafruit
 *   - Adafruit GFX Library    by Adafruit
 * =====================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>


// =====================================================
// SETTINGS - EDIT THESE TO MATCH YOUR SETUP
// =====================================================

const char* WIFI_SSID         = "YOUR_WIFI_SSID";      // <- change this
const char* WIFI_PASSWORD     = "YOUR_WIFI_PASSWORD";   // <- change this
const char* FLASK_SERVER_IP   = "192.168.1.100";        // <- change this (your laptop IP)
const char* FLASK_SERVER_PORT = "5000";
const char* DEVICE_ID         = "ESP32_AiPECO_01";


// =====================================================
// PIN ASSIGNMENTS
// =====================================================

#define SCT013_PIN          34    // SCT-013 output -> GPIO 34 (ADC1)
#define VOLTAGE_SENSOR_PIN  35    // ZMPT101B output -> GPIO 35 (ADC1)
#define DHT_PIN             4     // DHT22 data pin
#define RELAY_PIN           26    // Relay IN
#define STATUS_LED_PIN      2     // Built-in LED
#define I2C_SDA_PIN         21    // OLED SDA
#define I2C_SCL_PIN         22    // OLED SCL


// =====================================================
// SCT-013 SETTINGS
// =====================================================

// Which SCT-013 model do you have?
// Uncomment only one line:
#define SCT013_MAX_AMPS   100.0   // SCT-013-000 (100A model) - most common
// #define SCT013_MAX_AMPS  5.0   // SCT-013-005 (5A model)
// #define SCT013_MAX_AMPS  10.0  // SCT-013-010 (10A model)
// #define SCT013_MAX_AMPS  20.0  // SCT-013-020 (20A model)
// #define SCT013_MAX_AMPS  30.0  // SCT-013-030 (30A model)

// Burden resistor value in ohms
// This converts SCT-013 current output to voltage for ADC
// For SCT-013-000 (100A) with 3.3V ESP32: use 33 ohms
// Formula: R_burden = (ADC_REF / 2) / (SCT_MAX_A / SCT_TURNS)
// SCT-013 has 2000 turns, so:
// R_burden = (3.3/2) / (100/2000) = 1.65 / 0.05 = 33 ohms
#define SCT013_BURDEN_OHMS   33.0

// SCT-013 number of turns (always 2000 for all models)
#define SCT013_TURNS         2000.0

// ADC midpoint voltage created by the two 10k bias resistors
// = 3.3V / 2 = 1.65V
// At 0 amps, ADC should read 1.65V (midpoint)
// Fine tune this if your zero reading drifts
#define SCT013_ADC_MIDPOINT_V  1.65

// Number of samples for RMS calculation
// 1000 samples at 50Hz mains = about 1 full AC cycle measured
#define SCT013_SAMPLES       1000

// Calibration multiplier - adjust if readings are off
// How to calibrate:
//   1. Use a known load (e.g. 100W bulb at 220V = 0.455A)
//   2. Note what the Serial Monitor shows
//   3. Set CALIBRATION = known_amps / reported_amps
#define SCT013_CALIBRATION   1.0   // start at 1.0 and adjust


// =====================================================
// ZMPT101B VOLTAGE SENSOR SETTINGS
// =====================================================

// Voltage divider ratio for ZMPT101B (same as before)
// R1=10k, R2=6.8k -> 6800/16800 = 0.405
#define ZMPT101B_DIVIDER_RATIO  0.405
#define ZMPT101B_CALIBRATION    1.2
#define NOMINAL_VOLTAGE         220.0   // Pakistan/South Asia = 220V


// =====================================================
// ADC SETTINGS
// =====================================================

#define ADC_MAX_VALUE    4095.0
#define ADC_REF_VOLTAGE  3.3


// =====================================================
// POWER SETTINGS
// =====================================================

#define POWER_FACTOR     0.85
#define SUB1_FRACTION    0.30
#define SUB2_FRACTION    0.20
#define SUB3_FRACTION    0.40


// =====================================================
// RELAY
// =====================================================

#define RELAY_ON    LOW
#define RELAY_OFF   HIGH


// =====================================================
// OLED
// =====================================================

#define OLED_WIDTH       128
#define OLED_HEIGHT      64
#define OLED_RESET_PIN   -1
#define OLED_I2C_ADDRESS 0x3C


// =====================================================
// TIMING
// =====================================================

#define SEND_INTERVAL_MS  2000   // send every 2 seconds


// =====================================================
// GLOBAL OBJECTS
// =====================================================

DHT dht(DHT_PIN, DHT22);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);

bool wifiConnected   = false;
int  failedSendCount = 0;
unsigned long lastSendTime = 0;

struct SensorReading {
  float current_amps;       // Real-world amps (from SCT-013 RMS calculation)
  float voltage_volts;      // Real-world volts (from ZMPT101B)
  float active_power_kw;    // Computed kW
  float apparent_power_va;  // V x I in VA (volt-amps)
  float reactive_power_var; // Reactive component
  float power_factor;       // Computed or fixed PF
  float temperature_c;      // DHT22
  float humidity_pct;       // DHT22
  float sub1_wh;            // Estimated sub-metering
  float sub2_wh;
  float sub3_wh;
  float current_5v;         // 0-5V scaled current for ML backend
  float voltage_5v;         // 0-5V scaled voltage for ML backend
  bool  relay_state;
  bool  dht_valid;
};

SensorReading latestReading;


// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("========================================");
  Serial.println("  AiPECO ESP32 Firmware - SCT-013 Mode");
  Serial.println("========================================");

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // 12-bit ADC, 11dB attenuation = reads 0 to 3.3V
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  dht.begin();
  Serial.println("DHT22 initialized on GPIO " + String(DHT_PIN));

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("AiPECO SCT-013");
    display.println("Starting...");
    display.display();
    Serial.println("OLED initialized");
  } else {
    Serial.println("OLED not found - continuing without display");
  }

  // Print SCT-013 config
  Serial.println("SCT-013 Config:");
  Serial.printf("  Max current:    %.0f A\n", SCT013_MAX_AMPS);
  Serial.printf("  Burden resistor: %.0f ohms\n", SCT013_BURDEN_OHMS);
  Serial.printf("  Turns:          %.0f\n", SCT013_TURNS);
  Serial.printf("  ADC midpoint:   %.3f V\n", SCT013_ADC_MIDPOINT_V);
  Serial.printf("  Calibration:    %.3f\n", SCT013_CALIBRATION);

  connectWiFi();

  Serial.println("Setup complete. Starting readings...\n");
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost. Reconnecting...");
    connectWiFi();
  }

  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;

    readAllSensors();
    printReadingToSerial();
    updateOLED();

    if (wifiConnected) {
      bool success = sendReadingToServer();
      if (success) {
        failedSendCount = 0;
        blinkLED(STATUS_LED_PIN, 1, 100);
      } else {
        failedSendCount++;
        blinkLED(STATUS_LED_PIN, 3, 100);
        Serial.printf("Send failed (%d consecutive)\n", failedSendCount);
      }
    }
  }

  delay(10);
}


// =====================================================
// SCT-013 CURRENT READING (RMS CALCULATION)
// =====================================================

float readSCT013Current() {
  /*
   * SCT-013 RMS Current Calculation
   * ---------------------------------
   * The SCT-013 outputs an AC current proportional
   * to the current flowing through the monitored wire.
   * We take many samples, subtract the midpoint bias,
   * square them, average, then take sqrt = RMS value.
   *
   * Steps:
   *   1. Take SCT013_SAMPLES ADC readings
   *   2. Convert each to voltage at ADC pin
   *   3. Subtract bias midpoint (1.65V) to center at 0
   *   4. Square each offset, accumulate sum
   *   5. Divide sum by number of samples = mean square
   *   6. Square root = RMS voltage
   *   7. Convert RMS voltage to RMS current using:
   *      I_rms = V_rms / R_burden * N_turns
   *   8. Apply calibration factor
   *   9. Scale to 0-5V for backend
   *
   * Why RMS?
   *   For AC power, we need RMS (Root Mean Square) current
   *   because AC constantly changes direction.
   *   RMS gives the "effective" value that produces the
   *   same heating as DC current of that value.
   */

  long sum_of_squares = 0;

  // Convert midpoint voltage to ADC units for comparison
  float midpoint_adc = SCT013_ADC_MIDPOINT_V / ADC_REF_VOLTAGE * ADC_MAX_VALUE;

  // Take many samples over ~1 full AC cycle
  for (int i = 0; i < SCT013_SAMPLES; i++) {
    int raw = analogRead(SCT013_PIN);

    // Subtract midpoint to get signed AC value
    float offset = (float)raw - midpoint_adc;

    // Square and accumulate
    sum_of_squares += (long)(offset * offset);

    // Small delay - total time = SCT013_SAMPLES * delay_us
    // At 50Hz, one cycle = 20ms = 20000us
    // 1000 samples -> 20us each = 20ms = exactly 1 cycle
    delayMicroseconds(20);
  }

  // Calculate RMS from accumulated squares
  float mean_square = (float)sum_of_squares / SCT013_SAMPLES;
  float rms_adc     = sqrt(mean_square);

  // Convert ADC units to voltage at pin
  float rms_voltage = rms_adc * (ADC_REF_VOLTAGE / ADC_MAX_VALUE);

  // Convert voltage at burden resistor to current
  // I_secondary = V_rms / R_burden
  float i_secondary = rms_voltage / SCT013_BURDEN_OHMS;

  // Scale secondary current to primary current
  // I_primary = I_secondary * N_turns
  float i_primary = i_secondary * SCT013_TURNS;

  // Apply calibration correction
  i_primary = i_primary * SCT013_CALIBRATION;

  // Clamp to valid range
  if (i_primary < 0.0) i_primary = 0.0;
  if (i_primary > SCT013_MAX_AMPS) i_primary = SCT013_MAX_AMPS;

  // Scale to 0-5V range for ML backend
  latestReading.current_5v = scaleToRange(i_primary, 0.0, SCT013_MAX_AMPS, 0.0, 5.0);

  return i_primary;
}


// =====================================================
// ZMPT101B VOLTAGE READING (same as before)
// =====================================================

float readZMPT101BVoltage() {
  int samples   = 500;
  long sum_sq   = 0;
  float mid     = (float)ADC_MAX_VALUE / 2.0;

  for (int i = 0; i < samples; i++) {
    int raw    = analogRead(VOLTAGE_SENSOR_PIN);
    float diff = raw - mid;
    sum_sq    += (long)(diff * diff);
    delayMicroseconds(100);
  }

  float rms_raw     = sqrt((float)sum_sq / samples);
  float pin_voltage = rms_raw * (ADC_REF_VOLTAGE / ADC_MAX_VALUE);
  float measured_v  = pin_voltage * ZMPT101B_CALIBRATION;

  // Safety clamp
  if (measured_v < 50 || measured_v > 280) {
    measured_v = NOMINAL_VOLTAGE;
  }

  latestReading.voltage_5v = scaleToRange(pin_voltage, 0.0, ADC_REF_VOLTAGE, 0.0, 5.0);

  return measured_v;
}


// =====================================================
// READ ALL SENSORS
// =====================================================

void readAllSensors() {
  // Read current (SCT-013)
  latestReading.current_amps  = readSCT013Current();

  // Read voltage (ZMPT101B)
  latestReading.voltage_volts = readZMPT101BVoltage();

  // Compute power values
  float V = latestReading.voltage_volts;
  float I = latestReading.current_amps;

  latestReading.apparent_power_va  = V * I;
  latestReading.active_power_kw    = (V * I * POWER_FACTOR) / 1000.0;
  latestReading.reactive_power_var = latestReading.apparent_power_va
                                     * sin(acos(POWER_FACTOR));
  latestReading.active_power_kw    = max(0.0f, latestReading.active_power_kw);

  // DHT22
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    latestReading.dht_valid = false;
    if (latestReading.temperature_c == 0) latestReading.temperature_c = 25.0;
    if (latestReading.humidity_pct  == 0) latestReading.humidity_pct  = 50.0;
    Serial.println("DHT22 read failed!");
  } else {
    latestReading.temperature_c = temp;
    latestReading.humidity_pct  = hum;
    latestReading.dht_valid     = true;
  }

  // Estimated sub-metering
  float power_w = latestReading.active_power_kw * 1000.0;
  latestReading.sub1_wh = power_w * SUB1_FRACTION / 60.0;
  latestReading.sub2_wh = power_w * SUB2_FRACTION / 60.0;
  latestReading.sub3_wh = power_w * SUB3_FRACTION / 60.0;
}


// =====================================================
// SEND TO FLASK
// =====================================================

bool sendReadingToServer() {
  HTTPClient http;

  String url = "http://";
  url += FLASK_SERVER_IP;
  url += ":";
  url += FLASK_SERVER_PORT;
  url += "/api/readings";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  StaticJsonDocument<512> doc;
  doc["device_id"]        = DEVICE_ID;
  doc["current"]          = round2(latestReading.current_amps);
  doc["voltage"]          = round2(latestReading.voltage_volts);
  doc["active_power"]     = round4(latestReading.active_power_kw);
  doc["apparent_power"]   = round4(latestReading.apparent_power_va / 1000.0);
  doc["reactive_power"]   = round4(latestReading.reactive_power_var / 1000.0);
  doc["power_factor"]     = POWER_FACTOR;
  doc["temperature"]      = round2(latestReading.temperature_c);
  doc["humidity"]         = round2(latestReading.humidity_pct);
  doc["sub1"]             = round2(latestReading.sub1_wh);
  doc["sub2"]             = round2(latestReading.sub2_wh);
  doc["sub3"]             = round2(latestReading.sub3_wh);
  doc["current_5v"]       = round2(latestReading.current_5v);
  doc["voltage_5v"]       = round2(latestReading.voltage_5v);
  doc["intensity"]        = round2(latestReading.current_amps);
  doc["relay_state"]      = latestReading.relay_state;
  doc["dht_valid"]        = latestReading.dht_valid;
  doc["sensor_type"]      = "SCT013";

  String jsonBody;
  serializeJson(doc, jsonBody);

  int httpCode = http.POST(jsonBody);
  http.end();

  if (httpCode == 201) {
    Serial.println("Data sent OK (HTTP 201)");
    return true;
  } else {
    Serial.printf("Server returned HTTP %d\n", httpCode);
    return false;
  }
}


// =====================================================
// RELAY CONTROL
// =====================================================

void setRelay(bool turnOn) {
  if (turnOn) {
    digitalWrite(RELAY_PIN, RELAY_ON);
    latestReading.relay_state = true;
    Serial.println("Relay -> ON");
  } else {
    digitalWrite(RELAY_PIN, RELAY_OFF);
    latestReading.relay_state = false;
    Serial.println("Relay -> OFF");
  }
}


// =====================================================
// WIFI
// =====================================================

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\nWiFi connected! IP: " + WiFi.localIP().toString());
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else {
    wifiConnected = false;
    Serial.println("\nWiFi FAILED. Check SSID and password.");
    Serial.println("Remember: ESP32 only supports 2.4GHz, not 5GHz!");
  }
}


// =====================================================
// OLED
// =====================================================

void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  display.print("AiPECO SCT-013");
  display.setCursor(90, 0);
  display.print(wifiConnected ? "OK" : "--");

  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  display.setCursor(0, 13);
  display.printf("V:%.1fV  I:%.2fA",
    latestReading.voltage_volts,
    latestReading.current_amps);

  display.setCursor(0, 23);
  display.printf("P:%.3fkW VA:%.1f",
    latestReading.active_power_kw,
    latestReading.apparent_power_va);

  display.setCursor(0, 33);
  if (latestReading.dht_valid) {
    display.printf("T:%.1fC H:%.0f%%",
      latestReading.temperature_c,
      latestReading.humidity_pct);
  } else {
    display.print("T:-- H:-- DHT ERR");
  }

  display.setCursor(0, 43);
  display.printf("PF:%.2f Relay:%s",
    POWER_FACTOR,
    latestReading.relay_state ? "ON" : "OFF");

  display.setCursor(0, 53);
  display.printf("I5v:%.2f V5v:%.2f",
    latestReading.current_5v,
    latestReading.voltage_5v);

  display.display();
}


// =====================================================
// UTILITIES
// =====================================================

float scaleToRange(float value, float in_min, float in_max,
                   float out_min, float out_max) {
  if (in_max == in_min) return out_min;
  float result = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
  if (result < out_min) result = out_min;
  if (result > out_max) result = out_max;
  return result;
}

void printReadingToSerial() {
  Serial.println("-----------------------------------");
  Serial.printf("Current (SCT-013): %.3f A  (5V scaled: %.3f)\n",
    latestReading.current_amps, latestReading.current_5v);
  Serial.printf("Voltage (ZMPT101B):%.2f V  (5V scaled: %.3f)\n",
    latestReading.voltage_volts, latestReading.voltage_5v);
  Serial.printf("Active Power:      %.4f kW\n", latestReading.active_power_kw);
  Serial.printf("Apparent Power:    %.2f VA\n",  latestReading.apparent_power_va);
  Serial.printf("Reactive Power:    %.2f VAR\n", latestReading.reactive_power_var);
  Serial.printf("Power Factor:      %.2f\n",     POWER_FACTOR);
  Serial.printf("Temperature:       %.1f C\n",   latestReading.temperature_c);
  Serial.printf("Humidity:          %.1f %%\n",  latestReading.humidity_pct);
  Serial.printf("Sub1:%.2f Sub2:%.2f Sub3:%.2f Wh\n",
    latestReading.sub1_wh, latestReading.sub2_wh, latestReading.sub3_wh);
  Serial.printf("Relay: %s\n", latestReading.relay_state ? "ON" : "OFF");
  Serial.println("-----------------------------------");
}

void blinkLED(int pin, int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH); delay(delayMs);
    digitalWrite(pin, LOW);  delay(delayMs);
  }
}

float round2(float v) { return round(v * 100.0)   / 100.0; }
float round4(float v) { return round(v * 10000.0) / 10000.0; }