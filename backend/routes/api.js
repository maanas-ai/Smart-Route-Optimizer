/**
 * REST API Routes
 * Endpoints for ESP8266 IoT nodes, GPS module telemetry, and Web Dashboard.
 */

const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { optimizeGarbageRoute } = require('../services/optimizer');
const { calculateSavingsMetrics } = require('../services/metrics');
const LOCATIONS = require('../../config/locations');

// --- BIN ENDPOINTS ---

/**
 * GET /api/bins
 * Fetch current fill levels and status for all 5 houses
 */
router.get('/bins', (req, res) => {
  const bins = store.getBins();
  const collectionRequiredCount = bins.filter(b => b.collection_required).length;

  res.json({
    success: true,
    totalBins: bins.length,
    collectionRequiredCount,
    bins
  });
});

/**
 * POST /api/bins
 * Updates bin data. Can accept a single bin object or an array of bins from ESP8266.
 * Example Body (Single): { "id": "house_a", "fill_percentage": 85, "measured_distance_cm": 6.2 }
 * Example Body (Batch): [ { "id": "house_a", "fill_percentage": 85 }, ... ]
 */
router.post('/bins', (req, res) => {
  const payload = req.body;

  if (Array.isArray(payload)) {
    const updated = store.updateAllBins(payload);
    return res.json({ success: true, message: 'All bins updated', bins: updated });
  } else if (payload && payload.id) {
    const updated = store.updateBin(
      payload.id,
      payload.fill_percentage,
      payload.measured_distance_cm
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: `Bin ${payload.id} not found` });
    }
    return res.json({ success: true, message: `Bin ${payload.id} updated`, bin: updated });
  } else {
    return res.status(400).json({
      success: false,
      error: 'Invalid payload. Provide an object with "id" and "fill_percentage" or an array.'
    });
  }
});

// --- TRUCK & GPS ENDPOINTS ---

/**
 * GET /api/truck
 * Fetch garbage truck GPS status & coordinates
 */
router.get('/truck', (req, res) => {
  const truck = store.getTruck();
  res.json({
    success: true,
    truck
  });
});

/**
 * POST /api/truck
 * Receive GPS telemetry from NEO-6M module (via ESP8266 or USB-Serial forwarder)
 * Body: { lat, lon, speed_kmh, satellites, isLiveGps, status }
 */
router.post('/truck', (req, res) => {
  const { lat, lon, speed_kmh, satellites, isLiveGps, status } = req.body;

  if (lat === undefined || lon === undefined) {
    return res.status(400).json({ success: false, error: 'Latitude and Longitude are required' });
  }

  const updatedTruck = store.updateTruck({
    lat,
    lon,
    speed_kmh: speed_kmh || 0,
    satellites: satellites || 0,
    isLiveGps: isLiveGps !== undefined ? isLiveGps : true,
    status: status || 'In Service'
  });

  res.json({
    success: true,
    message: 'Truck GPS updated',
    truck: updatedTruck
  });
});

// --- ROUTE OPTIMIZATION ENDPOINTS ---

/**
 * GET /api/route
 * Dynamically computes optimal route for bins >=80% full,
 * along with baseline comparison, fuel savings, and CO2 reduction.
 */
router.get('/route', async (req, res) => {
  const bins = store.getBins();
  const routeResult = await optimizeGarbageRoute(bins);
  const metrics = calculateSavingsMetrics(
    routeResult.normalDistanceKm,
    routeResult.optimizedDistanceKm
  );

  res.json({
    success: true,
    route: routeResult,
    metrics: metrics,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/route
 * Force recalculation of collection route
 */
router.post('/route', async (req, res) => {
  const bins = store.getBins();
  const routeResult = await optimizeGarbageRoute(bins);
  const metrics = calculateSavingsMetrics(
    routeResult.normalDistanceKm,
    routeResult.optimizedDistanceKm
  );

  res.json({
    success: true,
    message: 'Route recalculated successfully',
    route: routeResult,
    metrics: metrics
  });
});

// --- FIXED LOCATIONS ENDPOINT ---

router.get('/locations', (req, res) => {
  res.json({
    success: true,
    locations: LOCATIONS
  });
});

// --- OSRM ROAD ROUTING PROXY & CACHE ---
const osrmCache = new Map();

/**
 * GET /api/osrm/route?coords=lon,lat;lon,lat...
 * Proxies OSRM driving route requests to prevent browser CORS or adblock issues.
 */
router.get('/osrm/route', async (req, res) => {
  const coords = req.query.coords;
  if (!coords) {
    return res.status(400).json({ code: 'Error', message: 'Missing coords query parameter' });
  }

  const cacheKey = `route_${coords}`;
  if (osrmCache.has(cacheKey)) {
    return res.json(osrmCache.get(cacheKey));
  }

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ code: 'Error', message: `OSRM status ${response.status}` });
    }

    const data = await response.json();
    if (data.code === 'Ok') {
      osrmCache.set(cacheKey, data);
    }
    return res.json(data);
  } catch (err) {
    return res.status(503).json({ code: 'Error', message: 'OSRM routing service unavailable or timed out: ' + err.message });
  }
});

/**
 * GET /api/osrm/table?coords=lon,lat;lon,lat...
 * Proxies OSRM distance matrix requests for road-network TSP optimization.
 */
router.get('/osrm/table', async (req, res) => {
  const coords = req.query.coords;
  if (!coords) {
    return res.status(400).json({ code: 'Error', message: 'Missing coords query parameter' });
  }

  const cacheKey = `table_${coords}`;
  if (osrmCache.has(cacheKey)) {
    return res.json(osrmCache.get(cacheKey));
  }

  const osrmUrl = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ code: 'Error', message: `OSRM status ${response.status}` });
    }

    const data = await response.json();
    if (data.code === 'Ok') {
      osrmCache.set(cacheKey, data);
    }
    return res.json(data);
  } catch (err) {
    return res.status(503).json({ code: 'Error', message: 'OSRM table service unavailable or timed out: ' + err.message });
  }
});

// --- DEMO & SIMULATION ENDPOINTS ---

/**
 * POST /api/demo/simulate-bin
 * Toggle or set a specific house bin to high fill level for exhibition demonstration
 * Body: { id: "house_a", fill_percentage: 95 }
 */
router.post('/demo/simulate-bin', async (req, res) => {
  const { id, fill_percentage } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: 'House id required' });
  }

  const fill = fill_percentage !== undefined ? Number(fill_percentage) : 90;
  // Calculate simulated distance in cm based on 20cm empty, 4cm full
  const dist = Math.max(3.5, Number((20 - ((fill / 100) * 16)).toFixed(1)));

  const updated = store.updateBin(id, fill, dist);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'House not found' });
  }

  const bins = store.getBins();
  const routeResult = await optimizeGarbageRoute(bins);
  const metrics = calculateSavingsMetrics(
    routeResult.normalDistanceKm,
    routeResult.optimizedDistanceKm
  );

  res.json({
    success: true,
    message: `Simulated ${updated.name} to ${updated.fill_percentage}%`,
    bin: updated,
    bins: bins,
    route: routeResult,
    metrics: metrics,
    truck: store.getTruck()
  });
});

/**
 * POST /api/demo/reset
 * Resets all bins and truck back to clean baseline state
 */
router.post('/demo/reset', async (req, res) => {
  store.reset(true);
  const bins = store.getBins();
  const truck = store.getTruck();
  const routeResult = await optimizeGarbageRoute(bins);
  const metrics = calculateSavingsMetrics(
    routeResult.normalDistanceKm,
    routeResult.optimizedDistanceKm
  );

  res.json({
    success: true,
    message: 'System reset to default baseline state',
    bins: bins,
    truck: truck,
    route: routeResult,
    metrics: metrics
  });
});

/**
 * POST /api/demo/simulate-truck-step
 * Moves truck towards target coordinate in route simulation
 */
router.post('/demo/simulate-truck-step', (req, res) => {
  const { lat, lon, status, speed_kmh } = req.body;
  const truck = store.updateTruck({
    lat,
    lon,
    speed_kmh: speed_kmh || 25,
    satellites: 8,
    isLiveGps: false,
    status: status || 'En Route to Next Collection House'
  });

  res.json({
    success: true,
    truck
  });
});

module.exports = router;
