# GPS-Based Smart House-to-House Garbage Collection Route Optimizer
**College Engineering Project — Smart Cities**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)]() [![Hardware](https://img.shields.io/badge/hardware-Arduino%20Uno-blue)]() [![License](https://img.shields.io/badge/license-MIT-green)]()

---

## 1. Project Overview

A full-stack IoT dashboard that:
- Reads fill levels from **5 × HC-SR04 ultrasonic sensors** (one per dustbin) via **Arduino Uno**.
- Reads live GPS position from a **NEO-6M GPS module** connected to the same Arduino.
- Displays bin fill levels, statuses and alerts on a **React dashboard**.
- Calculates the **optimal Travelling Salesperson route** (Exact TSP) through full bins using road geometry from **OSRM**.
- Draws the route on a **Leaflet + OpenStreetMap** geographic map as a road-following polyline.
- Animates a simulated garbage truck along those roads, or shows a live GPS marker when the NEO-6M has a satellite lock.

---

## 2. Hardware Required

| Qty | Component | Notes |
|---|---|---|
| 1 | Arduino Uno | USB-B connection to laptop |
| 5 | HC-SR04 Ultrasonic Sensor | One per dustbin H1–H5 |
| 1 | NEO-6M GPS Module + Patch Antenna | SoftwareSerial on D12 |
| 1 | Green LED | With 220Ω resistor |
| 1 | Yellow LED | With 220Ω resistor |
| 1 | Red LED | With 220Ω resistor |
| 1 | Active Buzzer (5V) | If > 40 mA, use NPN transistor |
| — | Breadboard + Jumper Wires | Common GND rail |

---

## 3. Wiring (Arduino Uno)

```
HC-SR04 Sensor H1:  VCC→5V  GND→GND  TRIG→D2   ECHO→D3
HC-SR04 Sensor H2:  VCC→5V  GND→GND  TRIG→D4   ECHO→D5
HC-SR04 Sensor H3:  VCC→5V  GND→GND  TRIG→D6   ECHO→D7
HC-SR04 Sensor H4:  VCC→5V  GND→GND  TRIG→D8   ECHO→D9
HC-SR04 Sensor H5:  VCC→5V  GND→GND  TRIG→D10  ECHO→D11

NEO-6M GPS:  VCC→3.3V (or 5V if board has regulator)  GND→GND
             GPS TX → Arduino D12 (SoftwareSerial RX)
             GPS RX → Leave UNCONNECTED (read-only)

Green LED:   Anode → A0 → 220Ω → LED Cathode → GND
Yellow LED:  Anode → A1 → 220Ω → LED Cathode → GND
Red LED:     Anode → A2 → 220Ω → LED Cathode → GND
Buzzer:      (+) → A3    (−) → GND
             [If buzzer draws > 40 mA, use NPN transistor on A3]

D0, D1: Reserved for USB serial. DO NOT USE.
All GND pins on a common ground rail.
```

> **NEO-6M voltage**: Most breakout boards accept 3.3V–5V (check silkscreen). The GPS TX output (3.3V) is safe to connect directly to Arduino's 5V-tolerant digital input.

---

## 4. Arduino Firmware

### File location
```
arduino/Arduino_5_Bins_GPS_Uno.ino
```

### Required Libraries
Install via **Arduino IDE → Sketch → Include Library → Manage Libraries**:
- `TinyGPSPlus` by Mikal Hart (search "TinyGPSPlus")
- `SoftwareSerial` is built into the Arduino IDE — no separate install needed

### Upload Steps
1. Open `arduino/Arduino_5_Bins_GPS_Uno.ino` in Arduino IDE.
2. **Board:** Select `Arduino Uno`.
3. **Port:** Select the COM port your Uno appears on (e.g. COM3, COM4).
4. Set your bin calibration values at the top of the file (see Section 6).
5. Click **Upload**.
6. **Close Arduino Serial Monitor** before connecting the dashboard.

### Serial Protocol (9600 baud)

The firmware sends two types of machine-readable lines on USB serial:

```
DATA:fill1,fill2,fill3,fill4,fill5
```
- Five fill percentages (0.0–100.0), comma-separated, one decimal place.
- `-1.0` means that sensor timed out / is disconnected. The dashboard shows an error badge.
- Example: `DATA:25.0,40.0,85.3,62.1,-1.0`

```
GPS:lat,lon,speed_kmh,satellites,fix
```
- `fix=1` → NEO-6M has a valid satellite lock.  `fix=0` → searching.
- Example: `GPS:12.971600,77.594600,0.0,6,1`

Lines beginning with `#` are comments/debug — silently ignored by the dashboard.

---

## 5. Software Setup

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9
- Google Chrome or Microsoft Edge (Web Serial API required)

### Installation (New Laptop)

```bash
# 1. Navigate to the project directory
cd smart-garbage-router

# 2. Install all dependencies (uses package-lock.json for reproducibility)
npm install

# 3. Start the backend (optional — only needed for the /api endpoints)
npm start
# Backend runs at http://localhost:3000

# 4. Start the frontend development server
npm run dev
# Frontend runs at http://localhost:5173
```

> **Production build** (for static hosting or demo day):
> ```bash
> npm run build
> # Then serve with: npm start  (serves dist/ at http://localhost:3000)
> ```

### Publish the dashboard on GitHub Pages

The repository includes a GitHub Actions workflow that publishes the standalone dashboard as a static demo. Push to the `main` branch, then in GitHub open **Settings → Pages** and set the build and deployment source to **GitHub Actions**. The workflow deploys the site automatically; its URL will appear in the Pages settings and deployment run.

GitHub Pages does not run the Express backend, so the published dashboard uses browser-only demo data and its simulation controls. Live Arduino/GPS data and backend APIs require the local Node.js server.

### Browser URL
- **Development:** `http://localhost:5173`
- **Production:** `http://localhost:3000`

> Web Serial API requires **Google Chrome** or **Microsoft Edge** (desktop). It does not work in Firefox or Safari.

---

## 6. Bin Calibration

### What to measure
The HC-SR04 sensor sits at the top of the bin, facing down.

| Setting | Measurement | Example |
|---|---|---|
| **Empty Bin Distance** | Ruler from sensor to bin interior bottom when empty | 20.0 cm |
| **Full Bin Distance** | Ruler measurement (or sensor reading) when bin is fully packed | 3.5 cm |

### How to calibrate
1. With the bin completely empty, read the `DATA:` line in Arduino Serial Monitor at 9600 baud. Write down the distance.
2. Change **Empty Bin Distance (cm)** in the dashboard **Settings** page.
3. Pack the bin fully. Read the DATA: line again.
4. Change **Full Bin Distance (cm)** in Settings.
5. Click **Save Configuration**.
6. Refresh the page — values persist from localStorage.

### Fill formula
```
fill% = ((emptyDistance − measured) / (emptyDistance − fullDistance)) × 100
```
Clamped to [0, 100]. If the sensor returns an invalid reading, the bin is flagged with a sensor error badge instead of showing a wrong fill level.

---

## 7. Dashboard Pages

| Tab | Function |
|---|---|
| Overview | Summary of all 5 bins, current route status, quick stats |
| Live Monitoring | Real-time bin cards with sliders for manual simulation |
| Route Planner | TSP-optimized collection stops, road distance, time estimates |
| Truck Tracking | Geographic + Schematic maps, GPS/simulation mode selector |
| Analytics | Trip history, savings metrics, recharts graphs |
| Demo Mode | Preset scenarios (All Normal, One Full, Multiple Full, All Full) |
| Settings | Calibration, threshold, speed, coordinates |

---

## 8. Serial Connection Instructions

1. Connect the Arduino Uno via USB.
2. Open the dashboard in Chrome/Edge.
3. Click **"Connect Arduino"** in the top navbar.
4. A browser dialog appears — select your Arduino's COM port.
5. Confirm 9600 baud (default, matches firmware).
6. The status indicator turns green and the bin cards show "Live Uno".

> **Troubleshooting:** If the port dialog shows no devices, or connection fails:
> - Make sure Arduino Serial Monitor is **closed**.
> - Try a different USB port.
> - On Windows, check Device Manager for a COM port labeled "USB Serial Device".
> - Only one program can own a COM port at a time.

---

## 9. GPS Tracking Modes

### Mode A — Live GPS (NEO-6M)
- Requires outdoor or near-window placement for satellite signal.
- Switch to **Hardware GPS (NEO-6M)** on the Truck Tracking page.
- The truck marker updates every 2 seconds from real GPS coordinates.
- Status shows satellite count and fix quality.
- **Note:** GPS accuracy indoors is typically several metres — not suitable for tracking miniature tabletop trucks.

### Mode B — Simulated Movement
- Switch to **Simulated Mode** on the Truck Tracking page.
- Click **Start Simulation** — the truck follows the OSRM road geometry.
- Use Pause / Resume / Reset controls.
- A "SIMULATION MODE" banner is always visible so it cannot be confused with live GPS.
- Speed can be adjusted with the speed multiplier.

---

## 10. Map & Routing

- **Map tiles:** OpenStreetMap (requires internet connection)
- **Road routing:** OSRM Public API (`router.project-osrm.org`) — requires internet
- **Fallback:** If OSRM is unreachable, a warning banner appears and straight-line segments are shown (dashed). The route is **never silently presented as road geometry** when OSRM failed.
- **Route algorithm:** Exact Permutation TSP (up to 5! = 120 combinations, guaranteed optimal)
- **Coordinates:** Fictional demonstration coordinates around a Bangalore sector. Update in **Settings → Geographic Coordinates** for your actual project site.

---

## 11. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| "No serial port selected" | Port dialog dismissed or Arduino not plugged in | Reconnect USB; try different port |
| "Port already open" | Arduino Serial Monitor is open | Close Serial Monitor in Arduino IDE |
| Bin shows "Sensor Error" badge | HC-SR04 timed out | Check TRIG/ECHO wiring; ensure 5V supply |
| All bins show 0% after reset | Old 22cm setting in localStorage | Open Settings → check Empty Bin Distance is correct → Save |
| Map shows straight dashed lines | OSRM unreachable | Check internet connection; wait and click Recalculate Route |
| GPS shows "Searching for Satellites" | No satellite lock indoors | Move near a window or test outdoors |
| Dashboard shows "Simulated" but hardware is connected | Serial data callback not called | Check firmware is sending `DATA:` lines at 9600 baud |
| Vite dev server fails to start | Port 5173 in use | `npx vite --port 5174` |
| Backend fails to start | Port 3000 in use | `PORT=3001 node backend/server.js` |

---

## 12. Project Transfer to New Laptop

Only these directories/files are needed (no `node_modules`, no `dist`):

```
smart-garbage-router/
├── arduino/            ← Arduino firmware (.ino)
├── backend/            ← Express backend
├── config/             ← Location defaults
├── frontend/           ← Vanilla fallback (not primary)
├── gps/                ← Reference GPS test sketch
├── src/                ← React application source
├── esp8266/            ← Legacy ESP8266 sketch (reference only)
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.js
└── vite.config.js
```

On the new laptop:
```bash
cd smart-garbage-router
npm install   # restores node_modules from package-lock.json
npm run dev   # starts development server
```

---

## 13. File Change Summary (v3.0 Fixes)

| File | Change |
|---|---|
| `src/config/constants.js` | Fixed `emptyDistanceCm` default from 22.0 → 20.0 |
| `src/services/storageService.js` | Added migration guard: rejects stale 22.0 from localStorage |
| `src/services/serialService.js` | Now parses `GPS:` and `$GP`/`$GN` NMEA lines in addition to `DATA:` |
| `src/services/gpsService.js` | Added `parseGpsLine()` for `GPS:lat,lon,speed,sats,fix` format |
| `src/services/simulationService.js` | `start()` accepts road geometry → truck follows roads not straight lines |
| `src/utils/validation.js` | Handles `-1.0` sensor sentinel (null instead of 0% or 100%) |
| `src/components/bins/BinCard.jsx` | Shows amber "Sensor Error" badge for invalid readings |
| `src/components/map/GeographicMap.jsx` | "SIMULATION MODE" banner; routing fallback warning; sensor error markers |
| `src/pages/SettingsPage.jsx` | Full calibration guide with step-by-step instructions and formula preview |
| `src/App.jsx` | Serial handler handles null sensors; reset uses calibration formula; simulation passes road coords |
| `src/main.jsx` | Added `leaflet/dist/leaflet.css` import |
| `vite.config.js` | Added `/api` proxy to backend port 3000 |
| `.gitignore` | Created |
| `arduino/Arduino_5_Bins_GPS_Uno.ino` | **NEW** — correct Arduino Uno firmware (replaces ESP8266 sketch) |
"# Smart-Route-Optimizer" 
