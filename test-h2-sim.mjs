import { DEFAULT_LOCATIONS } from './src/config/locations.js';
import { PRECACHED_ROAD_DATA } from './src/services/routeCache.js';
import { calculateHaversineDistance } from './src/utils/distance.js';

const depot = DEFAULT_LOCATIONS.depot;
const house2 = DEFAULT_LOCATIONS.houses.find(h => h.id === 'house_2');
const stops = [depot, house2, depot];

const routeData = PRECACHED_ROAD_DATA['depot_house_2_depot'];

function resampleRoadPath(roadCoords) {
  const path = [];
  const targetStepKm = 0.008;
  for (let i = 0; i < roadCoords.length - 1; i++) {
    const p1 = roadCoords[i];
    const p2 = roadCoords[i + 1];
    const dist = calculateHaversineDistance(p1[0], p1[1], p2[0], p2[1]);
    const subSteps = Math.max(1, Math.round(dist / targetStepKm));
    for (let s = 0; s < subSteps; s++) {
      const t = s / subSteps;
      path.push({
        lat: Number((p1[0] + (p2[0] - p1[0]) * t).toFixed(6)),
        lon: Number((p1[1] + (p2[1] - p1[1]) * t).toFixed(6)),
        schematic: null
      });
    }
  }
  const lastCoord = roadCoords[roadCoords.length - 1];
  path.push({
    lat: Number(lastCoord[0].toFixed(6)),
    lon: Number(lastCoord[1].toFixed(6)),
    schematic: null
  });
  return path;
}

function computeStopArrivalWaypoints(path, stopsList) {
  const arrivalWaypoints = [];
  let searchStartIdx = 0;
  arrivalWaypoints.push({ stop: stopsList[0], stopIndex: 0, pathIndex: 0, isDepot: true });

  for (let s = 1; s < stopsList.length; s++) {
    const targetStop = stopsList[s];
    if (s === stopsList.length - 1) {
      arrivalWaypoints.push({ stop: targetStop, stopIndex: s, pathIndex: path.length - 1, isDepot: true });
      continue;
    }
    let bestIdx = searchStartIdx;
    let minDistance = Infinity;
    for (let i = searchStartIdx; i < path.length; i++) {
      const pt = path[i];
      const dist = calculateHaversineDistance(pt.lat, pt.lon, targetStop.lat, targetStop.lon);
      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = i;
      }
    }
    arrivalWaypoints.push({
      stop: targetStop,
      stopIndex: s,
      pathIndex: bestIdx,
      distanceMeters: Math.round(minDistance * 1000),
      isDepot: false
    });
    searchStartIdx = Math.min(path.length - 1, bestIdx + 1);
  }
  return arrivalWaypoints;
}

const path = resampleRoadPath(routeData.coordinates);
const waypoints = computeStopArrivalWaypoints(path, stops);
console.log('Waypoints:', waypoints);

const visited = new Set([stops[0].id]);
let h2TriggerStep = -1;

for (let step = 0; step < path.length; step++) {
  // Check arrival waypoints
  for (const wp of waypoints) {
    if (!wp.isDepot && !visited.has(wp.stop.id)) {
      if (step >= wp.pathIndex) {
        visited.add(wp.stop.id);
        if (wp.stop.id === 'house_2') {
          h2TriggerStep = step;
          console.log(`[COLLECTED] ${wp.stop.name} triggered at step ${step}/${path.length} (target waypoint was ${wp.pathIndex})`);
        }
      }
    }
  }
}

console.log('Was H2 collected?', visited.has('house_2'), 'at step', h2TriggerStep);
console.log('Final visited:', Array.from(visited));
