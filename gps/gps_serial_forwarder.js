/**
 * GPS Serial Forwarder Utility
 * 
 * Purpose:
 * Reads NMEA GPS sentences from a NEO-6M GPS module connected via USB-TTL / Arduino
 * and forwards parsed coordinates directly to the Express backend API (/api/truck).
 * 
 * Also includes an automated simulation loop when no physical COM port is connected.
 */

const http = require('http');

const CONFIG = {
  apiHost: 'localhost',
  apiPort: 3000,
  apiPath: '/api/truck',
  defaultBaud: 9600
};

/**
 * Send parsed truck telemetry to backend
 */
function sendToBackend(telemetry) {
  const postData = JSON.stringify(telemetry);

  const options = {
    hostname: CONFIG.apiHost,
    port: CONFIG.apiPort,
    path: CONFIG.apiPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    // Silent success
  });

  req.on('error', (e) => {
    console.warn(`[GPS Forwarder] Cannot connect to backend server at http://${CONFIG.apiHost}:${CONFIG.apiPort}`);
  });

  req.write(postData);
  req.end();
}

/**
 * Parse standard NMEA $GPRMC or $GPGGA sentences
 */
function parseNMEA(sentence) {
  if (!sentence.startsWith('$GPRMC') && !sentence.startsWith('$GPGGA')) {
    return null;
  }

  const parts = sentence.trim().split(',');

  // Example GPRMC: $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
  if (parts[0] === '$GPRMC' && parts[2] === 'A') {
    const rawLat = parseFloat(parts[3]);
    const latDir = parts[4];
    const rawLon = parseFloat(parts[5]);
    const lonDir = parts[6];
    const speedKnots = parseFloat(parts[7]) || 0;

    const latDeg = Math.floor(rawLat / 100);
    const latMin = rawLat % 100;
    let lat = latDeg + (latMin / 60);
    if (latDir === 'S') lat = -lat;

    const lonDeg = Math.floor(rawLon / 100);
    const lonMin = rawLon % 100;
    let lon = lonDeg + (lonMin / 60);
    if (lonDir === 'W') lon = -lon;

    const speedKmh = speedKnots * 1.852;

    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      speed_kmh: Number(speedKmh.toFixed(1)),
      satellites: 6,
      isLiveGps: true,
      status: 'Garbage Truck in Transit (NEO-6M Live NMEA)'
    };
  }

  return null;
}

console.log('====================================================');
console.log('  NEO-6M GPS SERIAL FORWARDER & EMULATOR');
console.log('====================================================');
console.log('Target API: http://' + CONFIG.apiHost + ':' + CONFIG.apiPort + CONFIG.apiPath);

// Check if serialport package is installed; if not, run built-in demonstration emitter
try {
  const { SerialPort } = require('serialport');
  const { ReadlineParser } = require('@serialport/parser-readline');

  const comPort = process.argv[2] || 'COM3';
  console.log(`Attempting to open physical serial port ${comPort}...`);

  const port = new SerialPort({ path: comPort, baudRate: CONFIG.defaultBaud });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  parser.on('data', (line) => {
    const parsed = parseNMEA(line);
    if (parsed) {
      console.log(`[GPS LIVE] Fix: Lat ${parsed.lat}, Lon ${parsed.lon}, Speed: ${parsed.speed_kmh} km/h`);
      sendToBackend(parsed);
    }
  });

  port.on('error', (err) => {
    console.log(`[Notice] Serial port ${comPort} not available (${err.message}).`);
    startSoftwareEmulation();
  });
} catch (err) {
  console.log('[Notice] Physical serialport driver not present. Starting Standalone GPS Emulator mode.');
  startSoftwareEmulation();
}

/**
 * Fallback software simulation when no USB-TTL module is plugged into PC
 */
function startSoftwareEmulation() {
  console.log('[GPS Emulator] Generating periodic truck telemetry for demonstration...');
  const baseLat = 12.97160;
  const baseLon = 77.59460;
  let angle = 0;

  setInterval(() => {
    angle += 0.15;
    // Circular patrol path around depot
    const simulatedLat = baseLat + (Math.sin(angle) * 0.002);
    const simulatedLon = baseLon + (Math.cos(angle) * 0.0025);

    const telemetry = {
      lat: Number(simulatedLat.toFixed(6)),
      lon: Number(simulatedLon.toFixed(6)),
      speed_kmh: 22.5,
      satellites: 8,
      isLiveGps: false, // Flagged as simulation
      status: 'Simulated Truck Patrol (NEO-6M Forwarder)'
    };

    sendToBackend(telemetry);
  }, 3000);
}
