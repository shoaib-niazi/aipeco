/*
 * =====================================================
 * AiPECO_Voice.ino  —  Voice and Text Command Handler
 * =====================================================
 * HOW TO USE THIS FILE:
 * 1. Create a folder called "AiPECO_Voice" inside aipeco/esp32/
 * 2. Create a new file called "AiPECO_Voice.ino" inside it
 * 3. Copy everything below this comment into that file
 * =====================================================
 *
 * WHAT THIS DOES:
 *   Implements FR-12 and FR-13 from your SRS:
 *   FR-12: Voice commands via microphone module
 *   FR-13: Text commands via Serial Monitor or dashboard
 *
 * WIRING:
 *   Microphone (MAX9814 or KY-037):
 *     VCC  -> 3.3V
 *     GND  -> GND
 *     OUT  -> GPIO 33
 *
 *   Relay:
 *     VCC  -> 5V
 *     GND  -> GND
 *     IN   -> GPIO 26
 * =====================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// =====================================================
// SETTINGS - EDIT THESE
// =====================================================

const char* WIFI_SSID         = "YOUR_WIFI_SSID";      // <- change this
const char* WIFI_PASSWORD     = "YOUR_WIFI_PASSWORD";   // <- change this
const char* FLASK_SERVER_IP   = "192.168.1.100";        // <- change this
const char* FLASK_SERVER_PORT = "5000";
const char* DEVICE_ID         = "ESP32_AiPECO_01";

// Pins
#define MIC_PIN         33    // Microphone analog output -> GPIO 33 (ADC1)
#define RELAY_PIN       26    // Relay IN pin
#define RELAY_ON        LOW   // Active LOW relay
#define RELAY_OFF       HIGH

// Microphone threshold
// 0-4095 range. Increase if triggering on background noise.
// Decrease if not detecting your voice.
#define MIC_THRESHOLD   2500

// How many samples to check mic level
#define MIC_SAMPLES     50

// Minimum milliseconds between two triggers (avoids rapid repeated firing)
#define TRIGGER_COOLDOWN_MS  3000


// =====================================================
// GLOBAL STATE
// =====================================================

bool relay_state = false;
unsigned long lastTriggerTime = 0;


// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("AiPECO Voice and Text Command Handler");
  Serial.println("Available commands (type in Serial Monitor):");
  Serial.println("  relay on   -> turns relay ON");
  Serial.println("  relay off  -> turns relay OFF");
  Serial.println("  status     -> prints current state");
  Serial.println("  ping       -> replies pong");

  // Connect WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  // Handle typed commands from Serial Monitor
  handleSerialCommands();

  // Handle microphone voice trigger
  handleVoiceTrigger();

  delay(50);
}


// =====================================================
// METHOD A: SERIAL TEXT COMMANDS
// =====================================================

void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toLowerCase();

  if (cmd.length() == 0) return;

  Serial.println("Command received: " + cmd);

  if (cmd == "relay on" || cmd == "on" || cmd == "turn on") {
    setRelay(true);
    sendCommandResult("relay", "on", true);
  }
  else if (cmd == "relay off" || cmd == "off" || cmd == "turn off") {
    setRelay(false);
    sendCommandResult("relay", "off", true);
  }
  else if (cmd == "status") {
    Serial.println("Relay: " + String(relay_state ? "ON" : "OFF"));
    Serial.println("WiFi: " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected"));
    Serial.println("RSSI: " + String(WiFi.RSSI()) + " dBm");
  }
  else if (cmd == "ping") {
    Serial.println("pong");
  }
  else {
    Serial.println("Unknown command. Try: relay on, relay off, status");
  }
}


// =====================================================
// METHOD B: MICROPHONE VOICE TRIGGER
// =====================================================

void handleVoiceTrigger() {
  unsigned long now = millis();

  // Respect cooldown between triggers
  if (now - lastTriggerTime < TRIGGER_COOLDOWN_MS) return;

  // Sample microphone and find peak level
  int peak = 0;
  for (int i = 0; i < MIC_SAMPLES; i++) {
    int sample = analogRead(MIC_PIN);
    if (sample > peak) peak = sample;
    delayMicroseconds(500);
  }

  // If loud sound detected, send trigger to Flask
  if (peak > MIC_THRESHOLD) {
    lastTriggerTime = now;
    Serial.println("Voice trigger detected! Peak level: " + String(peak));

    String response = sendVoiceTrigger(peak);

    if (response.length() > 0) {
      processServerResponse(response);
    }
  }
}


// =====================================================
// SEND VOICE TRIGGER TO FLASK
// =====================================================

String sendVoiceTrigger(int audio_level) {
  if (WiFi.status() != WL_CONNECTED) return "";

  HTTPClient http;
  String url = "http://";
  url += FLASK_SERVER_IP;
  url += ":";
  url += FLASK_SERVER_PORT;
  url += "/api/voice_trigger";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);

  StaticJsonDocument<128> doc;
  doc["device_id"]   = DEVICE_ID;
  doc["audio_peak"]  = audio_level;
  doc["relay_state"] = relay_state;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  String response = "";

  if (code == 200) {
    response = http.getString();
    Serial.println("Server response: " + response);
  } else {
    Serial.println("Voice trigger failed. HTTP: " + String(code));
  }

  http.end();
  return response;
}


// =====================================================
// SEND COMMAND RESULT TO FLASK
// =====================================================

void sendCommandResult(const char* cmd_type, const char* cmd_value, bool success) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://";
  url += FLASK_SERVER_IP;
  url += ":";
  url += FLASK_SERVER_PORT;
  url += "/api/command_result";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"]     = DEVICE_ID;
  doc["command_type"]  = cmd_type;
  doc["command_value"] = cmd_value;
  doc["success"]       = success;
  doc["relay_state"]   = relay_state;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}


// =====================================================
// PROCESS SERVER RESPONSE
// =====================================================

void processServerResponse(String json_response) {
  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, json_response);

  if (err) {
    Serial.println("JSON parse error: " + String(err.c_str()));
    return;
  }

  const char* action = doc["action"];
  Serial.println("Action from server: " + String(action));

  if (strcmp(action, "relay_on") == 0) {
    setRelay(true);
  } else if (strcmp(action, "relay_off") == 0) {
    setRelay(false);
  } else if (strcmp(action, "toggle") == 0) {
    setRelay(!relay_state);
  } else {
    Serial.println("Unknown action from server");
  }
}


// =====================================================
// RELAY CONTROL
// =====================================================

void setRelay(bool turn_on) {
  if (turn_on) {
    digitalWrite(RELAY_PIN, RELAY_ON);
    relay_state = true;
    Serial.println("Relay -> ON");
  } else {
    digitalWrite(RELAY_PIN, RELAY_OFF);
    relay_state = false;
    Serial.println("Relay -> OFF");
  }
}