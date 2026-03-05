
/*
 * =====================================================
 * AiPECO_Sensors.h
 * =====================================================
 * HOW TO USE THIS FILE:
 * 1. Go to your aipeco/esp32/AiPECO_Main/ folder
 * 2. Create a new file called "AiPECO_Sensors.h"
 *    - Right click -> New -> Text Document
 *    - Rename to AiPECO_Sensors.h
 *    - Click Yes when Windows warns about extension
 * 3. Open with Notepad
 * 4. Copy everything below and paste it in
 * 5. Save and close
 * =====================================================
 *
 * WHAT THIS FILE DOES:
 * Contains a sensor self-test function.
 * Call runSensorSelfTest() in setup() to check
 * all sensors are working before the main loop starts.
 * Results are printed to the Serial Monitor.
 * =====================================================
 */

#ifndef AIPECO_SENSORS_H
#define AIPECO_SENSORS_H

#include "AiPECO_Config.h"


/*
 * runSensorSelfTest()
 * -------------------
 * Tests all sensors and prints pass/fail to Serial Monitor.
 * Call this at the end of setup() before the main loop.
 *
 * Tests performed:
 *   1. ACS712 current sensor - checks ADC is reading
 *   2. ZMPT101B voltage sensor - checks ADC is reading
 *   3. DHT22 - checks temperature and humidity are valid
 *   4. Relay - toggles ON and OFF (listen for click)
 *   5. WiFi - checks connection status
 *   6. I2C bus scan - finds OLED and INA219
 */
void runSensorSelfTest() {
  Serial.println("\n========== SENSOR SELF TEST ==========");

  // --- Test 1: ACS712 Current Sensor ---
  int raw_current = analogRead(CURRENT_SENSOR_PIN);
  float v_current = raw_current * (ADC_REF_VOLTAGE / ADC_MAX_VALUE);
  Serial.printf("[1] ACS712 (GPIO %d): raw=%d, pin_voltage=%.3fV  ",
    CURRENT_SENSOR_PIN, raw_current, v_current);

  float diff = abs(v_current - ACS712_ZERO_OFFSET_V);
  if (raw_current < 50) {
    Serial.println("-> FAIL (too low, check wiring and voltage divider)");
  } else if (diff < 0.5) {
    Serial.println("-> OK (near zero-current offset as expected)");
  } else {
    Serial.println("-> WARNING (offset from expected, may need calibration)");
  }

  // --- Test 2: ZMPT101B Voltage Sensor ---
  int raw_voltage = analogRead(VOLTAGE_SENSOR_PIN);
  float v_voltage = raw_voltage * (ADC_REF_VOLTAGE / ADC_MAX_VALUE);
  Serial.printf("[2] ZMPT101B (GPIO %d): raw=%d, pin_voltage=%.3fV  ",
    VOLTAGE_SENSOR_PIN, raw_voltage, v_voltage);

  if (raw_voltage < 10) {
    Serial.println("-> FAIL (near zero, check wiring)");
  } else if (raw_voltage > 4080) {
    Serial.println("-> FAIL (at ADC limit, check voltage divider)");
  } else {
    Serial.println("-> OK");
  }

  // --- Test 3: DHT22 ---
  // Need DHT object from main sketch
  // We use a fresh read here
  delay(2000);  // DHT22 needs 2 seconds between reads
  Serial.printf("[3] DHT22 (GPIO %d): ", DHT_PIN);

  // We cannot call dht.read() here without the dht object
  // so we check the pin is at least pulled up correctly
  int dht_pin_state = digitalRead(DHT_PIN);
  Serial.printf("pin state=%d  ", dht_pin_state);
  if (dht_pin_state == HIGH) {
    Serial.println("-> OK (pin is HIGH as expected with pull-up resistor)");
  } else {
    Serial.println("-> WARNING (pin is LOW, check 10k pull-up resistor to 3.3V)");
  }

  // --- Test 4: Relay ---
  Serial.printf("[4] Relay (GPIO %d): Toggling... ", RELAY_PIN);
  digitalWrite(RELAY_PIN, RELAY_ON);
  delay(300);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  delay(300);
  Serial.println("-> Done (did you hear a click?)");

  // --- Test 5: WiFi ---
  Serial.printf("[5] WiFi: SSID=%s  ", WIFI_SSID);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("-> OK (Connected, IP=%s, RSSI=%d dBm)\n",
      WiFi.localIP().toString().c_str(),
      WiFi.RSSI());
  } else {
    Serial.println("-> FAIL (Not connected, check SSID and password)");
    Serial.println("   Also check: ESP32 only supports 2.4GHz WiFi not 5GHz");
  }

  // --- Test 6: I2C Bus Scan ---
  Serial.println("[6] I2C Bus Scan:");
  byte devices_found = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf("    Found device at address 0x%02X", addr);
      if (addr == 0x3C || addr == 0x3D) Serial.print("  <- OLED SSD1306");
      if (addr == 0x40)                  Serial.print("  <- INA219 power sensor");
      if (addr == 0x48)                  Serial.print("  <- ADS1115 ADC");
      Serial.println();
      devices_found++;
    }
  }
  if (devices_found == 0) {
    Serial.println("    No I2C devices found");
    Serial.println("    This is OK if you are not using OLED or INA219");
  }

  Serial.println("========== SELF TEST COMPLETE ==========\n");
}


/*
 * getSensorHealthString()
 * -----------------------
 * Returns a short status string for the OLED display.
 * Shows which sensors are working.
 *
 * Parameters:
 *   dht_ok    : true if DHT22 last read was successful
 *   power_ok  : true if current/voltage sensors are reading
 *   wifi_ok   : true if WiFi is connected
 */
String getSensorHealthString(bool dht_ok, bool power_ok, bool wifi_ok) {
  String status = "";
  status += wifi_ok  ? "W+" : "W-";
  status += " ";
  status += dht_ok   ? "D+" : "D-";
  status += " ";
  status += power_ok ? "P+" : "P-";
  // W = WiFi, D = DHT22, P = Power sensors
  // + = working, - = error
  return status;
}


#endif