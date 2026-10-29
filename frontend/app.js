/**
 * Smart City Waste Management Dashboard Application
 * Handles Leaflet GIS rendering, REST API polling, and Demo Simulation.
 */

// Global state
let map = null;
let markers = {
  depot: null,
  houses: {},
  truck: null
};
let routePolyline = null;
let isTruckSimulating = false;
let truckSimInterval = null;
let currentRouteCoordinates = [];
let truckCurrentStepIndex = 0;
let pollPaused = false; // debounce: pause auto-poll during simulation steps

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchData();
  // Poll backend every 2.5 seconds for live hardware or demo updates
  setInterval(() => {
    if (!pollPaused) fetchData();
  }, 2500);
});

/**
 * Initialize Leaflet Map
 */
function initMap() {
  const defaultCenter = [12.9716, 77.5946]; // Central Depot coords

  map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(defaultCenter, 15);

  // Add OpenStreetMap tile layer (Free, no API key required)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Add Depot Marker
  const depotIcon = L.divIcon({
    className: 'custom-pin pin-depot',
    html: '<span style="font-size: 13px;">🏢</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  markers.depot = L.marker(defaultCenter, { icon: depotIcon })
    .addTo(map)
    .bindPopup('<strong>Central Waste Depot</strong><br>Fleet Base & Starting Point');

  // Add initial placeholder for Truck Marker
  const truckIcon = L.divIcon({
    className: 'custom-pin pin-truck',
    html: '<span style="font-size: 14px;">🚚</span>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  markers.truck = L.marker(defaultCenter, { icon: truckIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup('<strong>Garbage Collection Truck</strong><br>NEO-6M GPS Tracker');
}

// Local in-memory state for standalone / offline operation (No server dependency)
let localState = {
  isBackendConnected: false,
  bins: [
    { id: 'house_a', name: 'House A', fill_percentage: 20, measured_distance_cm: 16.8, status: 'NORMAL', collection_required: false },
    { id: 'house_b', name: 'House B', fill_percentage: 25, measured_distance_cm: 16.0, status: 'NORMAL', collection_required: false },
    { id: 'house_c', name: 'House C', fill_percentage: 85, measured_distance_cm: 6.4, status: 'COLLECTION REQUIRED', collection_required: true },
    { id: 'house_d', name: 'House D', fill_percentage: 30, measured_distance_cm: 15.2, status: 'NORMAL', collection_required: false },
    { id: 'house_e', name: 'House E', fill_percentage: 90, measured_distance_cm: 5.6, status: 'COLLECTION REQUIRED', collection_required: true }
  ],
  truck: {
    lat: 12.97160,
    lon: 77.59460,
    speed_kmh: 0,
    satellites: 8,
    isLiveGps: false,
    status: 'Stationary at Central Depot'
  }
};

/**
 * Local Haversine Great-Circle Distance (km)
 */
function localHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function localCalculateRouteDistance(route) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += localHaversine(route[i].lat, route[i].lon, route[i + 1].lat, route[i + 1].lon);
  }
  return total;
}

function localNearestNeighbor(depot, targets) {
  if (!targets || targets.length === 0) return [depot];
  const unvisited = [...targets];
  const route = [depot];
  let curr = depot;

  while (unvisited.length > 0) {
    let bestIdx = 0;
    let bestDist = localHaversine(curr.lat, curr.lon, unvisited[0].lat, unvisited[0].lon);
    for (let i = 1; i < unvisited.length; i++) {
      const d = localHaversine(curr.lat, curr.lon, unvisited[i].lat, unvisited[i].lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    curr = unvisited.splice(bestIdx, 1)[0];
    route.push(curr);
  }
  route.push(depot);
  return route;
}

function localTwoOpt(route) {
  if (route.length <= 3) return route;
  let bestRoute = [...route];
  let bestDist = localCalculateRouteDistance(bestRoute);
  let improved = true;
  let iters = 0;

  while (improved && iters < 30) {
    improved = false;
    iters++;
    for (let i = 1; i < bestRoute.length - 2; i++) {
      for (let k = i + 1; k < bestRoute.length - 1; k++) {
        const candidate = [
          ...bestRoute.slice(0, i),
          ...bestRoute.slice(i, k + 1).reverse(),
          ...bestRoute.slice(k + 1)
        ];
        const d = localCalculateRouteDistance(candidate);
        if (d < bestDist - 0.0001) {
          bestRoute = candidate;
          bestDist = d;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return bestRoute;
}

function localComputeRoutePlan(bins) {
  const locs = window.DEMO_LOCATIONS || {
    depot: { id: 'depot', name: 'Central Waste Depot', lat: 12.97160, lon: 77.59460 },
    houses: [
      { id: 'house_a', name: 'House A', lat: 12.97380, lon: 77.59580 },
      { id: 'house_b', name: 'House B', lat: 12.97510, lon: 77.59840 },
      { id: 'house_c', name: 'House C', lat: 12.97240, lon: 77.60010 },
      { id: 'house_d', name: 'House D', lat: 12.96920, lon: 77.59800 },
      { id: 'house_e', name: 'House E', lat: 12.96850, lon: 77.59420 }
    ]
  };
  const depot = locs.depot;
  const houses = locs.houses;

  const staticTour = [depot, ...houses, depot];
  const normalDistanceKm = Number(localCalculateRouteDistance(staticTour).toFixed(2));

  const fullIds = new Set(bins.filter(b => b.fill_percentage >= 80).map(b => b.id));
  const targets = houses.filter(h => fullIds.has(h.id));

  if (targets.length === 0) {
    return {
      route: {
        requiresCollection: false,
        targetCount: 0,
        stops: [depot],
        routeSummary: 'All bins normal — No collection trip required (Truck at Depot)',
        optimizedDistanceKm: 0,
        normalDistanceKm: normalDistanceKm,
        algorithm: 'Standby Mode',
        coordinates: [[depot.lat, depot.lon]]
      },
      metrics: {
        normalDistanceKm: normalDistanceKm,
        optimizedDistanceKm: 0,
        distanceSavedKm: normalDistanceKm,
        percentageDistanceSaved: 100,
        fuelSavedLiters: Number((normalDistanceKm / 10).toFixed(2)),
        estimatedCostSaved: Number(((normalDistanceKm / 10) * 100).toFixed(2)),
        estimatedCo2ReductionKg: Number(((normalDistanceKm / 10) * 2.64).toFixed(2))
      }
    };
  }

  const nn = localNearestNeighbor(depot, targets);
  const opt = localTwoOpt(nn);

  // Look up pre-cached real road geometry
  const cacheKey = opt.map(s => s.id).join('_');
  let realRoadCoords = [];
  let roadDistance = Number(localCalculateRouteDistance(opt).toFixed(2));
  let isRealRoad = false;

  if (window.PRECACHED_ROAD_DATA && window.PRECACHED_ROAD_DATA[cacheKey]) {
    realRoadCoords = window.PRECACHED_ROAD_DATA[cacheKey].coordinates;
    roadDistance = window.PRECACHED_ROAD_DATA[cacheKey].roadDistanceKm;
    isRealRoad = true;
  }

  const optDist = roadDistance;
  const distSaved = Math.max(0, Number((normalDistanceKm - optDist).toFixed(2)));
  const pctSaved = Number(((distSaved / normalDistanceKm) * 100).toFixed(1));
  const fuelSaved = Number((distSaved / 10).toFixed(2));
  const costSaved = Number((fuelSaved * 100).toFixed(2));
  const co2Saved = Number((fuelSaved * 2.64).toFixed(2));

  return {
    route: {
      requiresCollection: true,
      targetCount: targets.length,
      stops: opt,
      routeSummary: opt.map(s => s.name).join(' → '),
      optimizedDistanceKm: optDist,
      normalDistanceKm: normalDistanceKm,
      algorithm: targets.length > 2 ? 'Exact Road TSP (OSRM Matrix Minimal Loop)' : 'Road-Network Nearest Neighbor',
      coordinates: realRoadCoords, // Real road vertices, never straight lines!
      isRealRoadRouting: isRealRoad
    },
    metrics: {
      normalDistanceKm: normalDistanceKm,
      optimizedDistanceKm: optDist,
      distanceSavedKm: distSaved,
      percentageDistanceSaved: pctSaved,
      fuelSavedLiters: fuelSaved,
      estimatedCostSaved: costSaved,
      estimatedCo2ReductionKg: co2Saved
    }
  };
}

/**
 * Fetch latest telemetry from Backend REST APIs (or fallback seamlessly to local engine)
 */
async function fetchData() {
  try {
    if (window.location.protocol === 'file:') {
      throw new Error('Running in standalone file:// mode');
    }

    const [binsRes, truckRes, routeRes] = await Promise.all([
      fetch('/api/bins'),
      fetch('/api/truck'),
      fetch('/api/route')
    ]);

    if (!binsRes.ok || !truckRes.ok || !routeRes.ok) {
      throw new Error('API request failed');
    }

    const binsData = await binsRes.json();
    const truckData = await truckRes.json();
    const routeData = await routeRes.json();

    localState.isBackendConnected = true;
    updateDashboard(binsData, truckData.truck, routeData);
    document.getElementById('iot-conn-text').textContent = 'Backend: Live (Connected)';
  } catch (error) {
    // Standalone fallback: execute local optimization engine in browser
    localState.isBackendConnected = false;
    const plan = localComputeRoutePlan(localState.bins);
    updateDashboard({ bins: localState.bins }, localState.truck, plan);
    document.getElementById('iot-conn-text').textContent = 'Standalone Mode (Offline Ready)';
  }
}

/**
 * Update UI Cards, Badges, and Map
 */
function updateDashboard(binsData, truck, routeData) {
  const bins = binsData.bins || [];
  const requiredCount = bins.filter(b => b.collection_required).length;

  // 1. Update KPI Row
  document.getElementById('kpi-total-houses').textContent = bins.length;
  document.getElementById('kpi-required-count').textContent = requiredCount;
  document.getElementById('kpi-required-sub').textContent = requiredCount === 0
    ? 'All bins below threshold'
    : `${requiredCount} Bin${requiredCount > 1 ? 's' : ''} in Collection Queue`;

  // 2. Update Truck Telemetry & GPS Badge (skip positional update while truck sim is running)
  document.getElementById('kpi-truck-status').textContent = truck.status || 'Active';
  document.getElementById('kpi-truck-coords').textContent =
    `Lat: ${truck.lat.toFixed(4)}, Lon: ${truck.lon.toFixed(4)} | Sats: ${truck.satellites || 0}`;

  const gpsLabel = document.getElementById('gps-mode-label');
  const gpsIndicator = document.getElementById('gps-indicator');
  if (truck.isLiveGps) {
    gpsLabel.textContent = 'LIVE GPS';
    gpsIndicator.className = 'indicator pulse-green';
  } else {
    gpsLabel.textContent = 'DEMO GPS';
    gpsIndicator.className = 'indicator pulse-blue';
  }

  // Update Truck Map Marker Position only when not simulating (avoid fighting with animation)
  if (markers.truck && !isTruckSimulating) {
    markers.truck.setLatLng([truck.lat, truck.lon]);
  }
  if (markers.truck) {
    markers.truck.setPopupContent(`
      <div style="font-family: sans-serif; font-size: 12px;">
        <strong style="color: #0284c7;">Garbage Truck #1</strong><br>
        <strong>Status:</strong> ${truck.status}<br>
        <strong>Speed:</strong> ${truck.speed_kmh || 0} km/h<br>
        <strong>Mode:</strong> ${truck.isLiveGps ? '🟢 Live NEO-6M Fix' : '🔵 Indoor Demo Mode'}<br>
        <strong>Satellites:</strong> ${truck.satellites || 0}
      </div>
    `);
  }

  // 3. Render Bin Cards
  renderBinCards(bins);

  // 4. Update House Markers on Map
  updateMapHouseMarkers(bins);

  // 5. Update Route & Sustainability Metrics
  updateRouteAndMetrics(routeData);

  // 6. Render Collection List / Queue
  renderCollectionList(bins);
}

/**
 * Render 5 Bin Status Cards in Left Column
 */
function renderBinCards(bins) {
  const container = document.getElementById('bins-container');
  if (!container) return;

  container.innerHTML = bins.map(bin => {
    const isCritical = bin.fill_percentage >= 80;
    const isMedium = bin.fill_percentage >= 40 && bin.fill_percentage < 80;

    let statusClass = 'status-green';
    let fillClass = 'fill-green';
    let statusText = 'NORMAL';

    if (isCritical) {
      statusClass = 'status-red';
      fillClass = 'fill-red';
      statusText = 'COLLECTION REQUIRED';
    } else if (isMedium) {
      statusClass = 'status-yellow';
      fillClass = 'fill-yellow';
      statusText = 'MEDIUM';
    }

    return `
      <div class="bin-card ${isCritical ? 'critical' : ''}">
        <div class="bin-card-top">
          <span class="bin-name">
            <span>🏠</span>
            <span>${bin.name}</span>
          </span>
          <span class="bin-status-tag ${statusClass}">${statusText}</span>
        </div>

        <div class="progress-bar-container">
          <div class="progress-bar-fill ${fillClass}" style="width: ${bin.fill_percentage}%;"></div>
        </div>

        <div class="bin-card-bottom">
          <span>Distance: <strong>${bin.measured_distance_cm !== undefined ? bin.measured_distance_cm.toFixed(1) : '--'} cm</strong></span>
          <span class="bin-pct-value">${bin.fill_percentage}%</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Active Collection Queue list
 */
function renderCollectionList(bins) {
  const listEl = document.getElementById('collection-list');
  if (!listEl) return;

  const criticalBins = bins.filter(b => b.collection_required);
  if (criticalBins.length === 0) {
    listEl.innerHTML = '<span class="empty-queue-msg">Empty — No bins require collection</span>';
  } else {
    listEl.innerHTML = criticalBins.map(b =>
      `<span class="collection-item-tag">🚨 ${b.name} (${b.fill_percentage}%)</span>`
    ).join('');
  }
}

/**
 * Update House Map Pins with dynamic colors & pulsing for >=80%
 */
function updateMapHouseMarkers(bins) {
  if (!window.DEMO_LOCATIONS || !window.DEMO_LOCATIONS.houses) return;

  window.DEMO_LOCATIONS.houses.forEach(houseConfig => {
    const bin = bins.find(b => b.id.toLowerCase() === houseConfig.id.toLowerCase()) || {
      fill_percentage: 20,
      status: 'NORMAL'
    };

    const isCritical = bin.fill_percentage >= 80;
    const isMedium = bin.fill_percentage >= 40 && bin.fill_percentage < 80;
    const shortLetter = houseConfig.name.replace('House ', '');

    const pinClass = isCritical ? 'pin-house-critical' : 'pin-house-normal';
    const pinColor = isCritical ? '#ef4444' : (isMedium ? '#f59e0b' : '#10b981');

    const houseIcon = L.divIcon({
      className: `custom-pin ${pinClass}`,
      html: `<span>${shortLetter}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    if (!markers.houses[houseConfig.id]) {
      markers.houses[houseConfig.id] = L.marker([houseConfig.lat, houseConfig.lon], { icon: houseIcon })
        .addTo(map);
    } else {
      markers.houses[houseConfig.id].setIcon(houseIcon);
    }

    markers.houses[houseConfig.id].bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
        <strong style="color: ${pinColor}; font-size: 13px;">${houseConfig.name}</strong><br>
        <strong>Fill Level:</strong> ${bin.fill_percentage}%<br>
        <strong>Status:</strong> ${bin.status}<br>
        <strong>Sensor Reading:</strong> ${bin.measured_distance_cm !== undefined ? bin.measured_distance_cm + ' cm' : 'N/A'}<br>
        <button onclick="simulateBin('${houseConfig.id}', 90)" style="margin-top: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #ccc;">Simulate Full</button>
      </div>
    `);
  });
}

/**
 * Update Route Polyline & Impact Statistics
 */
function updateRouteAndMetrics(routeData) {
  const route = routeData.route;
  const metrics = routeData.metrics;
  if (!route || !metrics) return;

  currentRouteCoordinates = route.coordinates || [];

  // Update Route Sequence Text
  const routeDisplay = document.getElementById('route-sequence-display');
  if (route.requiresCollection) {
    routeDisplay.textContent = route.routeSummary;
    document.getElementById('algorithm-name-tag').textContent = route.algorithm;
  } else {
    routeDisplay.textContent = 'All bins normal — No collection trip required (Truck at Depot)';
    document.getElementById('algorithm-name-tag').textContent = 'Standby Mode';
  }

  // Update Metrics Grid
  document.getElementById('metric-normal-dist').textContent = `${metrics.normalDistanceKm} km`;
  document.getElementById('metric-opt-dist').textContent = `${metrics.optimizedDistanceKm} km`;
  document.getElementById('metric-dist-saved').textContent = `${metrics.distanceSavedKm} km`;
  document.getElementById('metric-dist-saved-pct').textContent = `(${metrics.percentageDistanceSaved}% reduction)`;
  document.getElementById('metric-fuel-saved').textContent = `${metrics.fuelSavedLiters} L`;
  document.getElementById('metric-cost-saved').textContent = `Est. ₹${metrics.estimatedCostSaved} Saved`;
  document.getElementById('metric-co2-saved').textContent = `${metrics.estimatedCo2ReductionKg} kg`;

  // Top KPI Card
  document.getElementById('kpi-distance-saved').textContent = `${metrics.percentageDistanceSaved}%`;
  document.getElementById('kpi-fuel-saved').textContent = `${metrics.fuelSavedLiters} L Saved (~₹${metrics.estimatedCostSaved})`;

  // Update Map Route Line — always null routePolyline after removal to avoid stale reference
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }

  if (route.requiresCollection && route.coordinates && route.coordinates.length > 1) {
    // Real street navigation line: solid Google Maps style blue following street geometry
    routePolyline = L.polyline(route.coordinates, {
      color: '#0284c7',
      weight: 6,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  }
}

/**
 * Exhibition Demo Action: Simulate specific House Full
 * @param {string} houseId - house id e.g. 'house_a'
 * @param {number} fillPct - fill percentage to set (default 90)
 */
async function simulateBin(houseId, fillPct = 90) {
  const btn = document.getElementById('btn-simulate-' + houseId.replace('_', '-'));
  if (btn) btn.disabled = true;

  // 1. Update in-memory local state first
  const bin = localState.bins.find(b => b.id.toLowerCase() === houseId.toLowerCase());
  if (bin) {
    bin.fill_percentage = fillPct;
    bin.measured_distance_cm = Math.max(3.5, Number((20 - ((fillPct / 100) * 16)).toFixed(1)));
    bin.status = fillPct >= 80 ? 'COLLECTION REQUIRED' : (fillPct >= 40 ? 'MEDIUM' : 'NORMAL');
    bin.collection_required = fillPct >= 80;
  }

  // 2. If running via HTTP, notify the backend server
  if (window.location.protocol !== 'file:') {
    try {
      const res = await fetch('/api/demo/simulate-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: houseId, fill_percentage: fillPct })
      });
      const data = await res.json();
      if (data && data.success) {
        updateDashboard(
          { bins: data.bins },
          data.truck,
          { route: data.route, metrics: data.metrics }
        );
        if (btn) btn.disabled = false;
        return;
      }
    } catch (err) {
      console.warn('Backend simulate-bin sync error, falling back to local computation:', err.message);
    }
  }

  // 3. Fallback: Recalculate route and update UI locally (offline / standalone mode)
  const plan = localComputeRoutePlan(localState.bins);
  updateDashboard({ bins: localState.bins }, localState.truck, plan);
  if (btn) btn.disabled = false;
}

/**
 * Exhibition Demo Action: Reset All Bins to Baseline
 */
async function resetAllBins() {
  if (isTruckSimulating) {
    stopTruckSimulation();
  }

  // 1. Reset in-memory local state first
  localState.bins.forEach(b => {
    b.fill_percentage = 20;
    b.measured_distance_cm = 16.8;
    b.status = 'NORMAL';
    b.collection_required = false;
  });
  if (window.DEMO_LOCATIONS && window.DEMO_LOCATIONS.depot) {
    localState.truck.lat = window.DEMO_LOCATIONS.depot.lat;
    localState.truck.lon = window.DEMO_LOCATIONS.depot.lon;
  }
  localState.truck.status = 'Stationary at Central Depot';

  // 2. If running via HTTP, notify the backend server
  if (window.location.protocol !== 'file:') {
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        updateDashboard(
          { bins: data.bins },
          data.truck,
          { route: data.route, metrics: data.metrics }
        );
        return;
      }
    } catch (err) {
      console.warn('Backend reset sync error, falling back to local computation:', err.message);
    }
  }

  // 3. Fallback: Recalculate route and update UI locally (offline / standalone mode)
  const plan = localComputeRoutePlan(localState.bins);
  updateDashboard({ bins: localState.bins }, localState.truck, plan);
}

/**
 * Stop truck simulation helper
 */
function stopTruckSimulation() {
  if (truckSimInterval) {
    clearInterval(truckSimInterval);
    truckSimInterval = null;
  }
  isTruckSimulating = false;
  pollPaused = false;

  const btnText = document.getElementById('btn-truck-text');
  if (btnText) btnText.textContent = 'Simulate Truck Movement';
}

/**
 * Exhibition Demo Action: Animate Truck Movement along Route
 */
function toggleTruckSimulation() {
  if (isTruckSimulating) {
    stopTruckSimulation();
    return;
  }

  // If no collection route is active, use the full baseline tour coordinates from DEMO_LOCATIONS
  let routeToAnimate = currentRouteCoordinates;
  if (!routeToAnimate || routeToAnimate.length < 2) {
    if (window.DEMO_LOCATIONS) {
      const depot = window.DEMO_LOCATIONS.depot;
      const houses = window.DEMO_LOCATIONS.houses;
      // Build a fallback tour: Depot → all houses → Depot
      routeToAnimate = [
        [depot.lat, depot.lon],
        ...houses.map(h => [h.lat, h.lon]),
        [depot.lat, depot.lon]
      ];
      console.log('No active collection route — animating full baseline tour for demonstration.');
    } else {
      console.warn('No route available for truck animation.');
      return;
    }
  }

  isTruckSimulating = true;
  pollPaused = true; // pause background polling during animation
  truckCurrentStepIndex = 0;

  const btnText = document.getElementById('btn-truck-text');
  if (btnText) btnText.textContent = '⏹ Stop Truck Movement';

  // If route is already real road geometry (many coordinates), animate directly
  const isHighResRoad = routeToAnimate.length > 20;
  const interpolatedPath = isHighResRoad ? routeToAnimate : generateSmoothPath(routeToAnimate, 12);
  let stepIndex = 0;
  const intervalMs = isHighResRoad ? 80 : 400;

  truckSimInterval = setInterval(async () => {
    if (stepIndex >= interpolatedPath.length) {
      stepIndex = 0; // Loop back for continuous demo
    }

    const currentPoint = interpolatedPath[stepIndex];
    stepIndex++;

    // Move marker immediately on map
    if (markers.truck) {
      markers.truck.setLatLng(currentPoint);
    }

    // Post to backend demo truck endpoint (fire-and-forget style)
    fetch('/api/demo/simulate-truck-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: currentPoint[0],
        lon: currentPoint[1],
        speed_kmh: 30,
        status: 'Moving along Optimized Street Route'
      })
    }).catch(e => console.warn('Truck sim step failed:', e));

    // Update telemetry KPI cards
    document.getElementById('kpi-truck-status').textContent = 'Moving along Optimized Street Route';
    document.getElementById('kpi-truck-coords').textContent =
      `Lat: ${currentPoint[0].toFixed(5)}, Lon: ${currentPoint[1].toFixed(5)} | Sats: 8`;

  }, intervalMs);
}

/**
 * Helper to interpolate intermediate points between coordinates for smooth simulation
 */
function generateSmoothPath(waypoints, stepsPerSegment) {
  const fullPath = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const lat = p1[0] + (p2[0] - p1[0]) * t;
      const lon = p1[1] + (p2[1] - p1[1]) * t;
      fullPath.push([lat, lon]);
    }
  }
  fullPath.push(waypoints[waypoints.length - 1]);
  return fullPath;
}
