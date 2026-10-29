/*
 * =================================================================================
 * PROJECT : GPS-Based Smart House-to-House Garbage Collection Route Optimizer
 * MODULE  : Arduino Uno — 5-Bin HC-SR04 Ultrasonic Sensors + NEO-6M GPS Tracker
 * VERSION : 4.0 (Small Cardboard Dustbins Calibration & Robust Median Filter)
 * =================================================================================
 *
 * HARDWARE:
 *   1 x Arduino Uno
 *   5 x HC-SR04 Ultrasonic Distance Sensors (mounted on 5 cardboard dustbins)
 *   1 x NEO-6M GPS Module (with ceramic antenna)
 *   1 x Green LED    (pin A0 - Normal level < 50%)
 *   1 x Yellow LED   (pin A1 - Filling up 50% - 79%)
 *   1 x Red LED      (pin A2 - Collection Required >= 80%)
 *   1 x Active Buzzer (pin A3 - Brief alert chirp on >= 80%)
 *   Breadboard, 220-ohm resistors, jumper wires, USB cable to PC
 *
 * PIN ASSIGNMENTS:
 * ┌─────────────┬─────────────────────────────────────────────────────────────┐
 * │ Bin H1 (A)  │ TRIG → Pin 2   ECHO → Pin 3                                 │
 * │ Bin H2 (B)  │ TRIG → Pin 4   ECHO → Pin 5                                 │
 * │ Bin H3 (C)  │ TRIG → Pin 6   ECHO → Pin 7                                 │
 * │ Bin H4 (D)  │ TRIG → Pin 8   ECHO → Pin 9                                 │
 * │ Bin H5 (E)  │ TRIG → Pin 10  ECHO → Pin 11                                │
 * │ NEO-6M GPS  │ GPS TX → Pin 12 (SoftwareSerial RX)                         │
 * │             │ GPS RX → Pin 13 (unconnected / read-only)                   │
 * │ Green LED   │ A0  (via 220Ω resistor to GND)                              │
 * │ Yellow LED  │ A1  (via 220Ω resistor to GND)                              │
 * │ Red LED     │ A2  (via 220Ω resistor to GND)                              │
 * │ Buzzer      │ A3  (active buzzer, + to A3, - to GND)                      │
 * └─────────────┴─────────────────────────────────────────────────────────────┘
 *
 * SMALL DUSTBIN CALIBRATION GUIDE:
 *   Handmade cardboard dustbins are typically 8 cm to 15 cm tall (NOT 20 cm).
 *   Measure each cardboard bin with a ruler:
 *     1. BIN_EMPTY_CM[i]: Distance from HC-SR04 sensor face to the bottom of bin i.
 *     2. BIN_FULL_CM[i]:  Distance from sensor face to garbage when bin is FULL (typically 2.5–3.5 cm).
 *
 * FORMULA:
 *   Fill Percentage = ((BIN_EMPTY_CM[i] - Measured_Distance) / (BIN_EMPTY_CM[i] - BIN_FULL_CM[i])) * 100
 *   Clamped to [0.0, 100.0]. Invalid or timed-out readings are sent as -1.0.
 *
 * SERIAL PROTOCOL (9600 baud):
 *   DATA:p1,p2,p3,p4,p5   -> Fill percentages (e.g. DATA:15.0,22.5,85.0,-1.0,30.0)
 *   DIST:d1,d2,d3,d4,d5   -> Raw sensor distances in cm (e.g. DIST:8.5,8.0,3.5,-1.0,7.5)
 *   GPS:lat,lon,spd,sat,1 -> Live NEO-6M GPS coordinates
 *   # Lines starting with '#' are debug comments safely ignored by dashboard.
 * =================================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

// ─── PER-BIN CONFIGURABLE CALIBRATION (SMALL CARDBOARD BINS) ──────────────────
// Adjust each bin's empty and full distances in cm to match your physical bins:
// Index 0 = House 1, Index 1 = House 2, Index 2 = House 3, Index 3 = House 4, Index 4 = House 5
float BIN_EMPTY_CM[5] = { 10.0, 10.0, 10.0, 10.0, 10.0 }; // Sensor to bottom when EMPTY (cm)
float BIN_FULL_CM[5]  = {  3.0,  3.0,  3.0,  3.0,  3.0 }; // Sensor to waste surface when FULL (cm)

// Collection alert threshold (must match dashboard setting)
const int COLLECTION_THRESHOLD = 80; // percent

// Number of ultrasonic samples per measurement (median filtered)
const int SAMPLES_PER_BIN = 5;

// Plausible ultrasonic distance limits for small desktop bins (cm)
const float MIN_PLAUSIBLE_CM = 2.0;   // Closer than 2cm causes acoustic blind zone
const float MAX_PLAUSIBLE_CM = 80.0;  // Beyond 80cm is outside small bin model

// Transmission intervals
const unsigned long TELEMETRY_INTERVAL_MS = 1500; // Sensor readings every 1.5 seconds
const unsigned long GPS_INTERVAL_MS       = 2000; // GPS readings every 2.0 seconds

// ─── PIN DEFINITIONS ──────────────────────────────────────────────────────────
const int TRIG[5] = { 2, 4, 6, 8, 10 };
const int ECHO[5] = { 3, 5, 7, 9, 11 };

const int GPS_RX_PIN = 12; // Connects to NEO-6M GPS TX
const int GPS_TX_PIN = 13; // Unused, SoftwareSerial requirement

const int LED_GREEN  = A0;
const int LED_YELLOW = A1;
const int LED_RED    = A2;
const int BUZZER_PIN = A3;

// ─── OBJECTS ──────────────────────────────────────────────────────────────────
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus    gps;

// ─── SENSOR STATE ─────────────────────────────────────────────────────────────
float measuredDistCm[5] = { -1.0, -1.0, -1.0, -1.0, -1.0 };
float fillPercent[5]    = { -1.0, -1.0, -1.0, -1.0, -1.0 };
bool  sensorValid[5]    = { false, false, false, false, false };

unsigned long lastTelemetryMs = 0;
unsigned long lastGpsMs       = 0;
bool previousCriticalAlert    = false;

// ─── SETUP ────────────────────────────────────────────────────────────────────
void setup() {
  // Main USB Serial connection to laptop dashboard
  Serial.begin(9600);

  // SoftwareSerial connection to NEO-6M GPS
  gpsSerial.begin(9600);

  // Initialize HC-SR04 sensor pins
  for (int i = 0; i < 5; i++) {
    pinMode(TRIG[i], OUTPUT);
    digitalWrite(TRIG[i], LOW);
    pinMode(ECHO[i], INPUT);
  }

  // Initialize Indicator LEDs and Buzzer
  pinMode(LED_GREEN,  OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Self-test LED sequence on boot
  selfTestIndicators();

  Serial.println(F("# ========================================================"));
  Serial.println(F("# Smart City Waste Management — Arduino Uno v4.0"));
  Serial.println(F("# Calibration Model: Small Cardboard Dustbins (Per-Bin)"));
  Serial.println(F("# Filter: Multi-Sample Median Filter (5 Pulses per bin)"));
  Serial.println(F("# Baud: 9600 | Pinout: H1(2,3) H2(4,5) H3(6,7) H4(8,9) H5(10,11)"));
  for (int i = 0; i < 5; i++) {
    Serial.print(F("# Bin H"));
    Serial.print(i + 1);
    Serial.print(F(": Empty="));
    Serial.print(BIN_EMPTY_CM[i], 1);
    Serial.print(F("cm | Full="));
    Serial.print(BIN_FULL_CM[i], 1);
    Serial.println(F("cm"));
  }
  Serial.println(F("# ========================================================"));
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
void loop() {
  // Continuously feed GPS characters to TinyGPSPlus parser
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  unsigned long currentMs = millis();

  // Read sensors and transmit telemetry
  if (currentMs - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = currentMs;
    readAllUltrasonicSensors();
    updateStatusIndicators();
    handleBuzzerAlert();
    sendTelemetryPackets();
  }

  // Transmit GPS status
  if (currentMs - lastGpsMs >= GPS_INTERVAL_MS) {
    lastGpsMs = currentMs;
    sendGpsPacket();
  }
}

// ─── ROBUST ULTRASONIC MEASUREMENT WITH MEDIAN FILTER ─────────────────────────

/**
 * Reads a single HC-SR04 with multiple samples and median filtering.
 * Rejects acoustic bounce-back spikes common in small cardboard bin enclosures.
 * Returns median distance in cm, or -1.0 if all pulses fail.
 */
float readDistanceMedianCm(int trigPin, int echoPin) {
  float samples[SAMPLES_PER_BIN];
  int validCount = 0;

  for (int s = 0; s < SAMPLES_PER_BIN; s++) {
    // Generate clean 10-microsecond trigger pulse
    digitalWrite(trigPin, LOW);
    delayMicroseconds(4);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);

    // Timeout: 25,000 microseconds (~4.3m max). Avoids long blocking if unplugged.
    unsigned long duration = pulseIn(echoPin, HIGH, 25000UL);

    if (duration > 0) {
      // Speed of sound: 343 m/s = 0.0343 cm/µs. Round trip divide by 2 = 0.01715
      float distCm = (float)duration * 0.01715f;

      // Check against plausible cardboard bin limits
      if (distCm >= MIN_PLAUSIBLE_CM && distCm <= MAX_PLAUSIBLE_CM) {
        samples[validCount++] = distCm;
      }
    }

    // Short 12ms pause between pulses to allow acoustic echoes to dissipate inside bin
    delay(12);
  }

  // If no echoes returned or sensor disconnected
  if (validCount == 0) {
    return -1.0f;
  }

  // Insertion sort valid samples to extract the exact median
  for (int i = 1; i < validCount; i++) {
    float key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  // Median value ignores outlier acoustic spikes
  return samples[validCount / 2];
}

/**
 * Reads all 5 bins and calculates fill percentages with per-bin calibration.
 */
void readAllUltrasonicSensors() {
  for (int i = 0; i < 5; i++) {
    float dist = readDistanceMedianCm(TRIG[i], ECHO[i]);
    measuredDistCm[i] = dist;

    if (dist < 0.0f) {
      // Echo failed / sensor disconnected — mark invalid. NEVER convert to 0% or 100%!
      sensorValid[i] = false;
      fillPercent[i] = -1.0f;
    } else {
      sensorValid[i] = true;

      float emptyDist = BIN_EMPTY_CM[i];
      float fullDist  = BIN_FULL_CM[i];
      float span      = emptyDist - fullDist;

      if (span <= 0.5f) {
        // Calibration safety guard
        fillPercent[i] = 0.0f;
      } else {
        // Formula: Fill % = ((Empty - Measured) / (Empty - Full)) * 100
        float rawPercent = ((emptyDist - dist) / span) * 100.0f;

        // Clamp cleanly to [0.0, 100.0]
        if (rawPercent < 0.0f)   rawPercent = 0.0f;
        if (rawPercent > 100.0f) rawPercent = 100.0f;

        fillPercent[i] = rawPercent;
      }
    }
  }
}

// ─── SERIAL TELEMETRY TRANSMISSION ────────────────────────────────────────────

/**
 * Sends machine-readable DATA and DIST packets to dashboard.
 */
void sendTelemetryPackets() {
  // 1. DATA packet: Fill percentages 0–100 (-1.0 if invalid)
  Serial.print(F("DATA:"));
  for (int i = 0; i < 5; i++) {
    if (sensorValid[i]) {
      Serial.print(fillPercent[i], 1);
    } else {
      Serial.print(F("-1.0"));
    }
    if (i < 4) Serial.print(',');
  }
  Serial.println();

  // 2. DIST packet: Raw measured distance in cm (-1.0 if invalid)
  Serial.print(F("DIST:"));
  for (int i = 0; i < 5; i++) {
    if (sensorValid[i]) {
      Serial.print(measuredDistCm[i], 1);
    } else {
      Serial.print(F("-1.0"));
    }
    if (i < 4) Serial.print(',');
  }
  Serial.println();
}

/**
 * Sends NEO-6M GPS telemetry packet to dashboard.
 */
void sendGpsPacket() {
  bool hasFix = gps.location.isValid() && gps.location.age() < 3000;

  Serial.print(F("GPS:"));
  if (hasFix) {
    Serial.print(gps.location.lat(), 6);
    Serial.print(',');
    Serial.print(gps.location.lng(), 6);
    Serial.print(',');
    Serial.print(gps.speed.isValid() ? gps.speed.kmph() : 0.0, 1);
    Serial.print(',');
    Serial.print(gps.satellites.isValid() ? (int)gps.satellites.value() : 0);
    Serial.print(F(",1")); // fix = 1 (valid satellite lock)
  } else {
    // Indoor / searching state
    Serial.print(F("0.000000,0.000000,0.0,"));
    Serial.print(gps.satellites.isValid() ? (int)gps.satellites.value() : 0);
    Serial.print(F(",0")); // fix = 0 (searching)
  }
  Serial.println();
}

// ─── PHYSICAL LED AND BUZZER INDICATORS ───────────────────────────────────────

/**
 * Updates physical LEDs based only on VALID sensor readings.
 */
void updateStatusIndicators() {
  float maxValidFill = -1.0f;
  bool anyCritical = false;

  for (int i = 0; i < 5; i++) {
    if (sensorValid[i]) {
      if (fillPercent[i] > maxValidFill) {
        maxValidFill = fillPercent[i];
      }
      if (fillPercent[i] >= COLLECTION_THRESHOLD) {
        anyCritical = true;
      }
    }
  }

  // If no sensors are valid, all indicator LEDs off
  if (maxValidFill < 0.0f) {
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED,    LOW);
    return;
  }

  if (anyCritical) {
    // Red LED on (>=80%)
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED,    HIGH);
  } else if (maxValidFill >= 50.0f) {
    // Yellow LED on (50%–79%)
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, HIGH);
    digitalWrite(LED_RED,    LOW);
  } else {
    // Green LED on (<50%)
    digitalWrite(LED_GREEN,  HIGH);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED,    LOW);
  }
}

/**
 * Chirps buzzer briefly when a bin transitions into >=80% state.
 */
void handleBuzzerAlert() {
  bool currentCritical = false;
  for (int i = 0; i < 5; i++) {
    if (sensorValid[i] && fillPercent[i] >= COLLECTION_THRESHOLD) {
      currentCritical = true;
      break;
    }
  }

  // Trigger alert sound only on transition to prevent continuous buzzing
  if (currentCritical && !previousCriticalAlert) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
  }
  previousCriticalAlert = currentCritical;
}

/**
 * Diagnostic boot self-test
 */
void selfTestIndicators() {
  digitalWrite(LED_GREEN,  HIGH); delay(150); digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, HIGH); delay(150); digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    HIGH); delay(150); digitalWrite(LED_RED,    LOW);
  digitalWrite(BUZZER_PIN, HIGH); delay(80);  digitalWrite(BUZZER_PIN, LOW);
}
