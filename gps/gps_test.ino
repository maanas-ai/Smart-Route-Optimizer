/*
 * =========================================================================================
 * PROJECT: GPS-Based Smart House-to-House Garbage Collection Route Optimizer
 * MODULE:  Garbage Truck NEO-6M GPS Module Controller & Test Sketch
 * =========================================================================================
 * 
 * HARDWARE:
 * - 1 x NEO-6M GPS Module (Mounted on the Miniature Garbage Truck)
 * - 1 x Microcontroller (ESP8266, Arduino Uno, or Nano)
 * 
 * WIRING (For ESP8266 NodeMCU on Truck):
 *   NEO-6M VCC  ---> 3.3V or 5V (Check your NEO-6M board regulator; most accept 3.3V - 5V)
 *   NEO-6M GND  ---> GND
 *   NEO-6M TX   ---> ESP8266 D5 (GPIO14 - SoftwareSerial RX)
 *   NEO-6M RX   ---> ESP8266 D6 (GPIO12 - SoftwareSerial TX, optional)
 * 
 * WIRING (For Arduino Uno / Nano on Truck):
 *   NEO-6M TX   ---> Arduino Pin 4 (SoftwareSerial RX)
 *   NEO-6M RX   ---> Arduino Pin 3 (SoftwareSerial TX)
 * 
 * DUAL MODE OPERATION (COLLEGE EXHIBITION READY):
 * 1. LIVE GPS MODE: Uses real satellite signals when outdoors or near windows.
 * 2. DEMO/SIMULATION MODE: When tested indoors inside college labs/auditoriums where
 *    concrete roofs block satellite signals, the code detects satellite fix absence
 *    and seamlessly falls back to valid demo coordinates.
 * =========================================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// If compiling on ESP8266:
#if defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #include <WiFiClient.h>
  static const int RXPin = 14; // NodeMCU D5 (GPIO14)
  static const int TXPin = 12; // NodeMCU D6 (GPIO12)
  const char* WIFI_SSID     = "YOUR_WIFI_SSID";
  const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
  const char* TRUCK_API_URL = "http://192.168.1.100:3000/api/truck";
#else
  // Standard Arduino Uno / Nano pinout:
  static const int RXPin = 4;
  static const int TXPin = 3;
#endif

static const uint32_t GPSBaud = 9600;

// The TinyGPS++ object
TinyGPSPlus gps;

// SoftwareSerial connection to the NEO-6M GPS module
SoftwareSerial ss(RXPin, TXPin);

// Fallback Demo Coordinates (Central Depot demo area)
const double DEMO_LAT = 12.97160;
const double DEMO_LON = 77.59460;

unsigned long lastReportTime = 0;
const unsigned long REPORT_INTERVAL = 2000; // Send telemetry every 2 seconds

void setup() {
  Serial.begin(115200);
  ss.begin(GPSBaud);

  Serial.println("\n========================================================");
  Serial.println(" SMART CITY GARBAGE TRUCK - NEO-6M GPS TELEMETRY NODE");
  Serial.println("========================================================");
  Serial.println("[GPS] Initializing NEO-6M Serial interface at 9600 baud...");

#if defined(ESP8266)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[Wi-Fi] Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Offline. Telemetry will print to Serial only.");
  }
#endif
}

void loop() {
  // Feed raw NMEA bytes from NEO-6M into TinyGPS++ parser
  while (ss.available() > 0) {
    gps.encode(ss.read());
  }

  unsigned long currentMillis = millis();
  if (currentMillis - lastReportTime >= REPORT_INTERVAL) {
    lastReportTime = currentMillis;
    processAndReportGps();
  }
}

void processAndReportGps() {
  double currentLat = 0.0;
  double currentLon = 0.0;
  float speedKmh = 0.0;
  int satellites = 0;
  bool isLiveFix = false;

  // Check if NEO-6M has acquired valid satellite locks
  if (gps.location.isValid() && gps.satellites.value() >= 3) {
    isLiveFix = true;
    currentLat = gps.location.lat();
    currentLon = gps.location.lng();
    speedKmh = gps.speed.kmh();
    satellites = gps.satellites.value();

    Serial.println("\n>>> [MODE: LIVE GPS FIX] <<<");
  } else {
    // Indoor exhibition fallback: use realistic demo coordinates
    isLiveFix = false;
    currentLat = DEMO_LAT;
    currentLon = DEMO_LON;
    speedKmh = 0.0;
    satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;

    Serial.println("\n>>> [MODE: DEMO GPS SIMULATION (No Indoor Satellite Fix)] <<<");
  }

  Serial.printf(" Latitude:    %.6f\n", currentLat);
  Serial.printf(" Longitude:   %.6f\n", currentLon);
  Serial.printf(" Speed:       %.2f km/h\n", speedKmh);
  Serial.printf(" Satellites:  %d\n", satellites);
  Serial.printf(" GPS Status:  %s\n", isLiveFix ? "VALID SATELLITE FIX" : "SEARCHING / DEMO FALLBACK");

#if defined(ESP8266)
  // Send telemetry payload to backend if Wi-Fi connected
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    if (http.begin(client, TRUCK_API_URL)) {
      http.addHeader("Content-Type", "application/json");

      String payload = "{";
      payload += "\"lat\":" + String(currentLat, 6) + ",";
      payload += "\"lon\":" + String(currentLon, 6) + ",";
      payload += "\"speed_kmh\":" + String(speedKmh, 1) + ",";
      payload += "\"satellites\":" + String(satellites) + ",";
      payload += "\"isLiveGps\":" + String(isLiveFix ? "true" : "false") + ",";
      payload += "\"status\":\"" + String(isLiveFix ? "Truck En Route (Live GPS)" : "Truck at Central Depot (Demo GPS)") + "\"";
      payload += "}";

      int code = http.POST(payload);
      Serial.printf("[HTTP] Truck GPS posted to backend. Response: %d\n", code);
      http.end();
    }
  }
#endif
}
