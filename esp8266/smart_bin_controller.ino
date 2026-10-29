/*
 * =========================================================================================
 * PROJECT: GPS-Based Smart House-to-House Garbage Collection Route Optimizer
 * MODULE:  ESP8266 NodeMCU Smart Bin Controller (5 Houses / Bins)
 * =========================================================================================
 * 
 * HARDWARE DESCRIPTION:
 * - Microcontroller: 1 x ESP8266 NodeMCU (ESP-12E module)
 * - Sensors: 5 x HC-SR04 Ultrasonic Sensors (House A, B, C, D, E)
 * - Indicators: 3 x LEDs (Green = 0-39%, Yellow = 40-79%, Red = 80-100%)
 * - Audio Alert: 1 x Active/Passive 5V Buzzer (Pulse alert when any bin >= 80%)
 * 
 * -----------------------------------------------------------------------------------------
 * CRITICAL ESP8266 BOOT PIN SAFETY & GPIO ARCHITECTURE:
 * -----------------------------------------------------------------------------------------
 * ESP8266 has specific boot strapping pins that dictate how the chip powers up:
 *  1. GPIO0  (D3): MUST be HIGH at boot. If held LOW, ESP enters UART bootloader mode.
 *  2. GPIO2  (D4): MUST be HIGH at boot. Connected to internal pull-up and onboard LED.
 *  3. GPIO15 (D8): MUST be LOW at boot. If held HIGH, boot fails.
 *  4. GPIO16 (D0): Deep-sleep wake pin, no internal pull-up/PWM/interrupts.
 * 
 * VOLTAGE LEVEL SHIFTING (CRITICAL):
 * HC-SR04 operates at 5V and outputs 5V on ECHO. ESP8266 GPIO pins are rated for 3.3V.
 * DO NOT connect 5V ECHO directly to ESP8266 pins!
 * Connect each ECHO through a voltage divider:
 *    HC-SR04 ECHO ---> [ 1kΩ Resistor ] ---> ESP8266 GPIO ---> [ 2kΩ Resistor ] ---> GND
 *    Vout = 5V * (2k / (1k + 2k)) = 3.33V (Perfect & Safe)
 * 
 * PIN ASSIGNMENT ARCHITECTURE:
 * Connecting 5 separate Triggers + 5 Echoes requires 10 pins, leaving zero pins on NodeMCU
 * for the 3 LEDs and Buzzer.
 * SOLUTION:
 * We use a Shared Trigger line (D1 - GPIO5) connected to all 5 sensors.
 * Each sensor has its own dedicated 3.3V-divided Echo pin.
 * This frees up pins for Green, Yellow, Red LEDs and Buzzer while ensuring 100% boot safety!
 * =========================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

// =========================================================================================
// 1. CONFIGURATION & NETWORK SETTINGS
// =========================================================================================
// Replace with your local Wi-Fi credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Backend Server URL (Replace with your computer's local IP address running Node.js)
// Example: "http://192.168.1.100:3000/api/bins"
const char* BACKEND_SERVER_URL = "http://192.168.1.100:3000/api/bins";

// Ultrasonic Bin Calibration (in centimeters)
const float EMPTY_DISTANCE = 20.0; // Distance when bin is completely empty (cm)
const float FULL_DISTANCE  = 4.0;  // Distance when bin is full to the brim (cm)

// Number of ultrasonic samples to average for noise reduction
const int SAMPLES_PER_READING = 5;

// Measurement interval (milliseconds)
const unsigned long SENSE_INTERVAL_MS = 3000;

// =========================================================================================
// 2. PIN CONFIGURATION & BOOT SAFETY ARCHITECTURES
// =========================================================================================
/**
 * SELECT YOUR PIN ARCHITECTURE:
 * 
 * Set USE_SHARED_TRIGGER to:
 *   1 (RECOMMENDED): Uses D1 as Common Trigger for all 5 bins. Frees up D3, D4, D8 for 
 *       Green, Yellow, Red LEDs and RX for Buzzer, while guaranteeing 100% boot stability.
 *   0 (DISCRETE PINS): Uses separate TRIG and ECHO pins for each house:
 *       House A: TRIG=D1, ECHO=D2
 *       House B: TRIG=D3 (GPIO0), ECHO=D4 (GPIO2) -> NOTE: Must not be pulled LOW during boot!
 *       House C: TRIG=D5, ECHO=D6
 *       House D: TRIG=D7, ECHO=D8 (GPIO15) -> NOTE: Must not be pulled HIGH during boot!
 *       House E: TRIG=D0 (GPIO16), ECHO=RX (GPIO3)
 *       (In Discrete mode, physical LEDs are omitted as all pins are allocated to ultrasonic sensors).
 */
#define USE_SHARED_TRIGGER 1

#if USE_SHARED_TRIGGER
  // --- ARCHITECTURE A: SHARED TRIGGER (Recommended for Prototype) ---
  #define PIN_COMMON_TRIG   D1  // GPIO5 (Common trigger pulse to all 5 sensors)
  #define PIN_ECHO_HOUSE_A  D2  // GPIO4
  #define PIN_ECHO_HOUSE_B  D5  // GPIO14
  #define PIN_ECHO_HOUSE_C  D6  // GPIO12
  #define PIN_ECHO_HOUSE_D  D7  // GPIO13
  #define PIN_ECHO_HOUSE_E  D0  // GPIO16

  // Status Indicator LEDs (Freed up by shared trigger)
  #define PIN_LED_GREEN     D3  // GPIO0 (Safe boot with pull-up)
  #define PIN_LED_YELLOW    D4  // GPIO2 (Safe boot with pull-up)
  #define PIN_LED_RED       D8  // GPIO15 (Safe boot with pull-down to GND via LED)
  #define PIN_BUZZER        3   // RX / GPIO3 (Audio alarm pulse)
  #define HAS_PHYSICAL_LEDS 1

#else
  // --- ARCHITECTURE B: DISCRETE INDEPENDENT MAPPING ---
  #define PIN_TRIG_HOUSE_A  D1  // GPIO5
  #define PIN_ECHO_HOUSE_A  D2  // GPIO4

  #define PIN_TRIG_HOUSE_B  D3  // GPIO0 (Boot strapping: MUST be HIGH at reset)
  #define PIN_ECHO_HOUSE_B  D4  // GPIO2 (Boot strapping: MUST be HIGH at reset)

  #define PIN_TRIG_HOUSE_C  D5  // GPIO14
  #define PIN_ECHO_HOUSE_C  D6  // GPIO12

  #define PIN_TRIG_HOUSE_D  D7  // GPIO13
  #define PIN_ECHO_HOUSE_D  D8  // GPIO15 (Boot strapping: MUST be LOW at reset)

  #define PIN_TRIG_HOUSE_E  D0  // GPIO16 (Remaining GPIO)
  #define PIN_ECHO_HOUSE_E  3   // RX / GPIO3 (Remaining GPIO - Serial RX disconnected)
  
  #define HAS_PHYSICAL_LEDS 0
#endif

// =========================================================================================
// 3. DATA STRUCTURES
// =========================================================================================
struct SmartBin {
  const char* id;
  const char* name;
  uint8_t trigPin;
  uint8_t echoPin;
  float measuredDistanceCm;
  int fillPercentage;
  const char* status;
  bool collectionRequired;
};

#if USE_SHARED_TRIGGER
SmartBin bins[5] = {
  { "house_a", "House A", PIN_COMMON_TRIG, PIN_ECHO_HOUSE_A, 20.0, 0, "NORMAL", false },
  { "house_b", "House B", PIN_COMMON_TRIG, PIN_ECHO_HOUSE_B, 20.0, 0, "NORMAL", false },
  { "house_c", "House C", PIN_COMMON_TRIG, PIN_ECHO_HOUSE_C, 20.0, 0, "NORMAL", false },
  { "house_d", "House D", PIN_COMMON_TRIG, PIN_ECHO_HOUSE_D, 20.0, 0, "NORMAL", false },
  { "house_e", "House E", PIN_COMMON_TRIG, PIN_ECHO_HOUSE_E, 20.0, 0, "NORMAL", false }
};
#else
SmartBin bins[5] = {
  { "house_a", "House A", PIN_TRIG_HOUSE_A, PIN_ECHO_HOUSE_A, 20.0, 0, "NORMAL", false },
  { "house_b", "House B", PIN_TRIG_HOUSE_B, PIN_ECHO_HOUSE_B, 20.0, 0, "NORMAL", false },
  { "house_c", "House C", PIN_TRIG_HOUSE_C, PIN_ECHO_HOUSE_C, 20.0, 0, "NORMAL", false },
  { "house_d", "House D", PIN_TRIG_HOUSE_D, PIN_ECHO_HOUSE_D, 20.0, 0, "NORMAL", false },
  { "house_e", "House E", PIN_TRIG_HOUSE_E, PIN_ECHO_HOUSE_E, 20.0, 0, "NORMAL", false }
};
#endif

unsigned long lastSenseTime = 0;
bool previousAlertState = false;

// =========================================================================================
// 4. SETUP
// =========================================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n==================================================");
  Serial.println(" SMART CITY GARBAGE COLLECTION ROUTE OPTIMIZER");
  Serial.println(" NodeMCU 5-House Bin Controller Initializing...");
  #if USE_SHARED_TRIGGER
  Serial.println(" [Mode] Architecture A: Boot-Safe Shared Trigger (All LEDs Active)");
  #else
  Serial.println(" [Mode] Architecture B: Discrete Pin Mapping (10 Pin Assignment)");
  #endif
  Serial.println("==================================================");

  // Configure Ultrasonic Pins
  for (int i = 0; i < 5; i++) {
    pinMode(bins[i].trigPin, OUTPUT);
    digitalWrite(bins[i].trigPin, LOW);
    pinMode(bins[i].echoPin, INPUT);
  }

#if HAS_PHYSICAL_LEDS
  // Configure LED and Buzzer Pins
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  // Power-on LED test sequence
  testLedsAndBuzzer();
#endif

  // Initialize Wi-Fi Connection (Non-blocking retry)
  connectWiFi();
}

// =========================================================================================
// 5. MAIN LOOP
// =========================================================================================
void loop() {
  unsigned long currentMillis = millis();

  // Check Wi-Fi connection health periodically; reconnect if disconnected
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWifiRetry = 0;
    if (currentMillis - lastWifiRetry > 10000) {
      lastWifiRetry = currentMillis;
      Serial.println("[Wi-Fi] Connection lost. Attempting safe reconnection...");
      WiFi.reconnect();
    }
  }

  // Sensor sampling routine
  if (currentMillis - lastSenseTime >= SENSE_INTERVAL_MS) {
    lastSenseTime = currentMillis;

    readAllSensors();
    updateLedIndicators();
    handleBuzzerAlert();
    printDebugTable();
    sendTelemetryToBackend();
  }
}

// =========================================================================================
// 6. SENSOR MEASUREMENT & FILTERING
// =========================================================================================
/**
 * Reads distance from an HC-SR04 sensor with 5-sample averaging & noise rejection
 */
float readUltrasonicDistance(uint8_t trigPin, uint8_t echoPin) {
  float validSum = 0;
  int validCount = 0;

  for (int s = 0; s < SAMPLES_PER_READING; s++) {
    // Send 10µs pulse to Trigger pin
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);

    // Read echo pulse duration with 25ms timeout (~4.3 meters max)
    unsigned long duration = pulseIn(echoPin, HIGH, 25000);

    // Calculate distance in cm: Speed of sound = 343 m/s = 0.0343 cm/µs. Round trip = duration / 2
    float distanceCm = (duration * 0.0343) / 2.0;

    // Filter out invalid readings (0 = timeout or out of range > 200cm)
    if (distanceCm >= 2.0 && distanceCm <= 100.0) {
      validSum += distanceCm;
      validCount++;
    }
    delay(15); // Short delay between acoustic bursts
  }

  if (validCount > 0) {
    return (validSum / validCount);
  } else {
    // If all pulses timed out, assume empty distance for safety
    return EMPTY_DISTANCE;
  }
}

/**
 * Reads all 5 bins and calculates fill percentage
 */
void readAllSensors() {
  for (int i = 0; i < 5; i++) {
    float dist = readUltrasonicDistance(bins[i].trigPin, bins[i].echoPin);
    bins[i].measuredDistanceCm = dist;

    // Calculate fill percentage:
    // fill_percentage = ((EMPTY_DISTANCE - measured_distance) / (EMPTY_DISTANCE - FULL_DISTANCE)) * 100
    float rawPercentage = ((EMPTY_DISTANCE - dist) / (EMPTY_DISTANCE - FULL_DISTANCE)) * 100.0;

    // Clamp between 0% and 100%
    if (rawPercentage < 0.0) rawPercentage = 0.0;
    if (rawPercentage > 100.0) rawPercentage = 100.0;

    bins[i].fillPercentage = (int)(rawPercentage + 0.5); // Rounding

    // Status classification:
    // 0-39%   = EMPTY / NORMAL
    // 40-79%  = MEDIUM
    // 80-100% = COLLECTION REQUIRED
    if (bins[i].fillPercentage >= 80) {
      bins[i].status = "COLLECTION REQUIRED";
      bins[i].collectionRequired = true;
    } else if (bins[i].fillPercentage >= 40) {
      bins[i].status = "MEDIUM";
      bins[i].collectionRequired = false;
    } else {
      bins[i].status = "NORMAL";
      bins[i].collectionRequired = false;
    }
  }
}

// =========================================================================================
// 7. LED INDICATORS & BUZZER ALERT
// =========================================================================================
/**
 * Updates Green, Yellow, and Red LEDs based on highest fill level among all 5 bins
 */
void updateLedIndicators() {
#if HAS_PHYSICAL_LEDS
  int maxFill = 0;
  for (int i = 0; i < 5; i++) {
    if (bins[i].fillPercentage > maxFill) {
      maxFill = bins[i].fillPercentage;
    }
  }

  if (maxFill >= 80) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, HIGH);
  } else if (maxFill >= 40) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
  } else {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, LOW);
  }
#endif
}

/**
 * Briefly beeps buzzer when any bin crosses >= 80% threshold without continuous buzzing
 */
void handleBuzzerAlert() {
#if HAS_PHYSICAL_LEDS
  bool anyCritical = false;
  for (int i = 0; i < 5; i++) {
    if (bins[i].collectionRequired) {
      anyCritical = true;
      break;
    }
  }

  // Trigger brief alert pulse only on state transition from safe to critical
  if (anyCritical && !previousAlertState) {
    Serial.println("[ALERT] Critical fill level detected (>=80%)! Triggering alert pulse...");
    for (int b = 0; b < 3; b++) {
      digitalWrite(PIN_BUZZER, HIGH);
      delay(120);
      digitalWrite(PIN_BUZZER, LOW);
      delay(100);
    }
  }
  previousAlertState = anyCritical;
#endif
}

// =========================================================================================
// 8. WI-FI & HTTP TELEMETRY
// =========================================================================================
void connectWiFi() {
  Serial.print("[Wi-Fi] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected successfully!");
    Serial.print("[Wi-Fi] NodeMCU IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[Wi-Fi] Could not connect. Operating in offline/local sensing mode.");
  }
}

/**
 * Builds JSON payload and sends to backend HTTP REST API
 */
void sendTelemetryToBackend() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Wi-Fi offline. Skipping telemetry transmission.");
    return;
  }

  WiFiClient client;
  HTTPClient http;

  if (!http.begin(client, BACKEND_SERVER_URL)) {
    Serial.println("[HTTP] Unable to connect to server endpoint.");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  // Construct JSON array payload:
  // [ {"id": "house_a", "fill_percentage": 25, "measured_distance_cm": 16.0}, ... ]
  String payload = "[";
  for (int i = 0; i < 5; i++) {
    payload += "{";
    payload += "\"id\":\"" + String(bins[i].id) + "\",";
    payload += "\"fill_percentage\":" + String(bins[i].fillPercentage) + ",";
    payload += "\"measured_distance_cm\":" + String(bins[i].measuredDistanceCm, 1);
    payload += "}";
    if (i < 4) payload += ",";
  }
  payload += "]";

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("[HTTP] Telemetry POST successful. Response code: %d\n", httpCode);
  } else {
    Serial.printf("[HTTP] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// =========================================================================================
// 9. DIAGNOSTICS & HARDWARE SELF-TEST
// =========================================================================================
void testLedsAndBuzzer() {
  Serial.println("[TEST] Verifying LEDs and Buzzer...");
  digitalWrite(PIN_LED_GREEN, HIGH);
  delay(200);
  digitalWrite(PIN_LED_GREEN, LOW);

  digitalWrite(PIN_LED_YELLOW, HIGH);
  delay(200);
  digitalWrite(PIN_LED_YELLOW, LOW);

  digitalWrite(PIN_LED_RED, HIGH);
  delay(200);
  digitalWrite(PIN_LED_RED, LOW);

  digitalWrite(PIN_BUZZER, HIGH);
  delay(100);
  digitalWrite(PIN_BUZZER, LOW);
  Serial.println("[TEST] Indicators verified.");
}

void printDebugTable() {
  Serial.println("\n------------------------------------------------------------------");
  Serial.println(" House   | Measured (cm) | Fill Level (%) | Status");
  Serial.println("------------------------------------------------------------------");
  for (int i = 0; i < 5; i++) {
    char buffer[80];
    snprintf(buffer, sizeof(buffer), " %-7s | %-13.1f | %-14d | %s",
             bins[i].name,
             bins[i].measuredDistanceCm,
             bins[i].fillPercentage,
             bins[i].status);
    Serial.println(buffer);
  }
  Serial.println("------------------------------------------------------------------");
}
