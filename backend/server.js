/**
 * Main Express Backend Server
 * GPS-Based Smart House-to-House Garbage Collection Route Optimizer
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all requests so ESP8266 & external clients can communicate easily
app.use(cors());

// Parse incoming JSON and URL-encoded requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount API routes
app.use('/api', apiRoutes);

const fs = require('fs');

// Check if modern React build exists in /dist
const distPath = path.join(__dirname, '../dist');
const hasDist = fs.existsSync(distPath);
const staticPath = hasDist ? distPath : path.join(__dirname, '../frontend');

console.log(`[Static]: Serving UI from ${hasDist ? 'React production build (dist/)' : 'Vanilla frontend (frontend/)'}`);

// Serve static assets with no-cache for instant UI updates
app.use(express.static(staticPath, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Also explicitly serve the standalone vanilla frontend at /frontend and /vanilla
app.use('/frontend/config', express.static(path.join(__dirname, '../config'), {
  etag: false,
  maxAge: 0
}));
app.use('/frontend', express.static(path.join(__dirname, '../frontend'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));
app.use('/vanilla/config', express.static(path.join(__dirname, '../config'), {
  etag: false,
  maxAge: 0
}));
app.use('/vanilla', express.static(path.join(__dirname, '../frontend'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Serve configuration for frontend access
app.use('/config', express.static(path.join(__dirname, '../config'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Default catch-all route to serve the dashboard
app.get('*', (req, res) => {
  const indexPath = hasDist
    ? path.join(distPath, 'index.html')
    : path.join(__dirname, '../frontend/index.html');
  res.sendFile(indexPath);
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log('  SMART CITY GARBAGE COLLECTION ROUTE OPTIMIZER - BACKEND');
  console.log('================================================================');
  console.log(` Server running at: http://localhost:${PORT}`);
  console.log(` Bins API:         http://localhost:${PORT}/api/bins`);
  console.log(` Truck GPS API:    http://localhost:${PORT}/api/truck`);
  console.log(` Route API:        http://localhost:${PORT}/api/route`);
  console.log(` Interactive UI:   http://localhost:${PORT}`);
  console.log('================================================================');
});
