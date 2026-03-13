/*
 * =====================================================
 * AiPECO ESP32 WROOM - Lightweight Version
 * =====================================================
 * ESP32 only does:
 *   1. Read raw ADC values from sensors
 *   2. Read DHT22
 *   3. Send raw values to Flask every 3 seconds
 *   4. Listen for relay commands from Flask
 *   5. Control relay
 *
 * Flask does ALL heavy work:
 *   - RMS calculation
 *   - Power computation
 *   - 0-5V scaling
 *   - ML predictions
 *   - Anomaly detection
 * =====================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// =====================================================
// SETTINGS — EDIT THESE
// =====================================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* FLASK_IP      = "192.168.1.100";   // your laptop IP
const char* DEVICE_ID     = "ESP32_AiPECO_01";

// Pins
#define CURRENT_PIN    34   // SCT013 or ACS712 → GPIO 34
#define DHT_PIN        4    // DHT22 → GPIO 4
#define RELAY_PIN      26   // Relay → GPIO 26
#define LED_PIN        2    // Built in LED

// Relay polarity
#define RELAY_ON       LOW
#define RELAY_OFF      HIGH

// Send interval — 3 seconds is safe for WROOM
#define SEND_INTERVAL  3000

// =====================================================
// GLOBALS
// =====================================================
DHT dht(DHT_PIN, DHT22);
unsigned long lastSendTime    = 0;
unsigned long lastRelayCheck  = 0;
bool relayState               = false;
bool wifiOk                   = false;


// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("AiPECO ESP32 WROOM Starting...");

  // Setup pins
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ADC setup
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // DHT22
  dht.begin();
  delay(2000);  // DHT22 warm up
  Serial.println("DHT22 ready");

  // WiFi
  connectWiFi();
}


// =====================================================
// MAIN LOOP — kept very simple
// =====================================================
void loop() {
  unsigned long now = millis();

  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    wifiOk = false;
    connectWiFi();
  }

  // Send sensor data every 3 seconds
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;
    sendSensorData();
  }

  // Check for relay command every 5 seconds
  if (now - lastRelayCheck >= 5000) {
    lastRelayCheck = now;
    checkRelayCommand();
  }

  // Small delay to prevent watchdog reset
  delay(50);
}


// =====================================================
// READ SENSORS — raw values only, no heavy math
// =====================================================
void sendSensorData() {

  // --- Read current sensor (raw ADC, let Flask compute RMS) ---
  // Take only 10 samples — enough for Flask to work with
  int raw_samples[10];
  for (int i = 0; i < 10; i++) {
    raw_samples[i] = analogRead(CURRENT_PIN);
    delay(2);
  }

  // Send average raw ADC value — Flask will compute RMS
  long sum = 0;
  for (int i = 0; i < 10; i++) sum += raw_samples[i];
  float avg_raw = sum / 10.0;

  // Convert to pin voltage (0 to 3.3V)
  float pin_voltage = avg_raw * (3.3 / 4095.0);

  // --- Read DHT22 ---
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  // Use last known values if read fails
  if (isnan(temp) || temp < -40 || temp > 80) {
    temp = 25.0;
    Serial.println("DHT22 read failed, using default");
  }
  if (isnan(hum) || hum < 0 || hum > 100) {
    hum = 50.0;
  }

  // --- Print to Serial ---
  Serial.println("--------------------------------");
  Serial.printf("Raw ADC:     %.1f (pin: %.3fV)\n", avg_raw, pin_voltage);
  Serial.printf("Temperature: %.1f C\n", temp);
  Serial.printf("Humidity:    %.1f %%\n", hum);
  Serial.printf("Relay:       %s\n", relayState ? "ON" : "OFF");
  Serial.printf("WiFi RSSI:   %d dBm\n", WiFi.RSSI());

  // --- Send to Flask ---
  if (!wifiOk) {
    Serial.println("WiFi not connected, skipping send");
    return;
  }

  HTTPClient http;
  String url = "http://" + String(FLASK_IP) + ":5000/api/readings";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  // Send RAW values — Flask backend will do all the math
  StaticJsonDocument<300> doc;
  doc["device_id"]    = DEVICE_ID;
  doc["raw_adc"]      = (int)avg_raw;       // raw ADC reading
  doc["pin_voltage"]  = pin_voltage;         // voltage at ADC pin (0-3.3V)
  doc["temperature"]  = temp;
  doc["humidity"]     = hum;
  doc["relay_state"]  = relayState;
  doc["wifi_rssi"]    = WiFi.RSSI();
  doc["uptime_ms"]    = millis();

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);

  if (code == 201) {
    Serial.println("Sent OK");
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
  } else {
    Serial.printf("Send failed: HTTP %d\n", code);
  }

  http.end();
}


// =====================================================
// CHECK FOR RELAY COMMAND FROM FLASK
// =====================================================
void checkRelayCommand() {
  /*
   * ESP32 asks Flask "should relay be ON or OFF?"
   * Flask decides based on ML optimization results
   * This is called polling — simpler than push notifications
   */
  if (!wifiOk) return;

  HTTPClient http;
  String url = "http://" + String(FLASK_IP) + ":5000/api/relay_command?device_id=" + String(DEVICE_ID);

  http.begin(url);
  http.setTimeout(3000);

  int code = http.GET();

  if (code == 200) {
    String response = http.getString();

    StaticJsonDocument<128> doc;
    DeserializationError err = deserializeJson(doc, response);

    if (!err) {
      bool command = doc["relay_on"];
      if (command != relayState) {
        relayState = command;
        digitalWrite(RELAY_PIN, relayState ? RELAY_ON : RELAY_OFF);
        Serial.printf("Relay changed to: %s\n", relayState ? "ON" : "OFF");
      }
    }
  }

  http.end();
}


// =====================================================
// WIFI CONNECTION
// =====================================================
void connectWiFi() {
  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiOk = true;
    Serial.println("\nWiFi connected!");
    Serial.println("IP: " + WiFi.localIP().toString());
    Serial.printf("RSSI: %d dBm\n", WiFi.RSSI());
  } else {
    wifiOk = false;
    Serial.println("\nWiFi failed! Will retry...");
  }
}