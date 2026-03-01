/*
 * =====================================================
 * AiPECO_Scale.h
 * =====================================================
 * HOW TO USE THIS FILE:
 * 1. Go to your aipeco/esp32/AiPECO_Main/ folder
 * 2. Create a new file called "AiPECO_Scale.h"
 *    - Right click -> New -> Text Document
 *    - Rename to AiPECO_Scale.h
 *    - Click Yes when Windows warns about extension
 * 3. Open with Notepad
 * 4. Copy everything below and paste it in
 * 5. Save and close
 * =====================================================
 *
 * WHY 0-5V SCALING?
 * The ESP32 ADC reads 0-3.3V physically.
 * But the AiPECO ML backend (Python preprocessing.py)
 * expects all sensor values in 0-5V range to match
 * the IoT prototype specification.
 *
 * So we scale everything up to 0-5V before sending
 * to the Flask backend via WiFi.
 * =====================================================
 */

#ifndef AIPECO_SCALE_H
#define AIPECO_SCALE_H

#include "AiPECO_Config.h"


/*
 * scaleToRange()
 * Maps a value from one range to another.
 * Same as Arduino map() but works with floats.
 *
 * Example:
 *   scaleToRange(2.2, 0, 3.3, 0, 5.0) = 3.33
 *   This maps 2.2V on a 0-3.3V scale to a 0-5V scale
 *
 * Parameters:
 *   value   : the number to scale
 *   in_min  : minimum of input range
 *   in_max  : maximum of input range
 *   out_min : minimum of output range
 *   out_max : maximum of output range
 */
float scaleToRange(float value, float in_min, float in_max,
                   float out_min, float out_max) {
  // Avoid divide by zero
  if (in_max == in_min) return out_min;

  float scaled = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;

  // Clamp to output range
  if (scaled < out_min) scaled = out_min;
  if (scaled > out_max) scaled = out_max;

  return scaled;
}


/*
 * adcPinVoltageToScaled5V()
 * Converts the voltage measured at the ADC pin (0-3.3V)
 * to a 0-5V scaled value for the Flask backend.
 *
 * This accounts for the voltage divider you built:
 *   Sensor(0-5V) -> divider -> ADC pin(0-2.02V) -> scaled back to 0-5V
 */
float adcPinVoltageToScaled5V(float pin_voltage) {
  // Undo the voltage divider to get original sensor voltage
  float sensor_voltage = pin_voltage / VOLTAGE_DIVIDER_RATIO;
  // Clamp to 0-5V range
  if (sensor_voltage > 5.0) sensor_voltage = 5.0;
  if (sensor_voltage < 0.0) sensor_voltage = 0.0;
  return sensor_voltage;
}


/*
 * currentAmpsToScaled5V()
 * Maps measured current (0 to ACS712_MAX_CURRENT amps)
 * to 0-5V scale for Flask backend.
 *
 * Example: 2.5A on a 0-5A sensor = 2.5V on 0-5V scale
 */
float currentAmpsToScaled5V(float current_amps) {
  return scaleToRange(current_amps, 0.0, ACS712_MAX_CURRENT, 0.0, 5.0);
}


/*
 * voltageVoltsToScaled5V()
 * Maps measured mains voltage (0-280V) to 0-5V scale.
 *
 * Example: 220V mains = 220/280 * 5 = 3.93V on 0-5V scale
 */
float voltageVoltsToScaled5V(float voltage_v) {
  return scaleToRange(voltage_v, 0.0, 280.0, 0.0, 5.0);
}


/*
 * temperatureToScaled5V()
 * Maps DHT22 temperature range (-40C to +80C) to 0-5V.
 *
 * Example: 25C = (25+40)/(80+40) * 5 = 2.71V
 */
float temperatureToScaled5V(float temp_c) {
  return scaleToRange(temp_c, -40.0, 80.0, 0.0, 5.0);
}


/*
 * humidityToScaled5V()
 * Maps humidity (0-100%) to 0-5V.
 *
 * Example: 60% humidity = 3.0V on 0-5V scale
 */
float humidityToScaled5V(float humidity_pct) {
  return scaleToRange(humidity_pct, 0.0, 100.0, 0.0, 5.0);
}


/*
 * printScalingDebug()
 * Prints a full scaling table to Serial Monitor.
 * Call this in setup() during calibration to verify
 * all your scaling calculations are correct.
 */
void printScalingDebug(float amps, float volts, float temp, float hum) {
  Serial.println("--- 0-5V Scaling Debug ---");
  Serial.printf("Current:  %.3f A  -> scaled: %.3f V\n",  amps,  currentAmpsToScaled5V(amps));
  Serial.printf("Voltage:  %.1f V  -> scaled: %.3f V\n",  volts, voltageVoltsToScaled5V(volts));
  Serial.printf("Temp:     %.1f C  -> scaled: %.3f V\n",  temp,  temperatureToScaled5V(temp));
  Serial.printf("Humidity: %.1f %% -> scaled: %.3f V\n",  hum,   humidityToScaled5V(hum));
  Serial.println("--------------------------");
}


#endif