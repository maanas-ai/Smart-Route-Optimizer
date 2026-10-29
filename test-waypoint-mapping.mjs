import { DEFAULT_LOCATIONS } from './src/config/locations.js';
import { PRECACHED_ROAD_DATA } from './src/services/routeCache.js';
import { calculateHaversineDistance } from './src/utils/distance.js';
import { simulationService } from './src/services/simulationService.js';

const depot = DEFAULT_LOCATIONS.depot;
const houseMap = new Map(DEFAULT_LOCATIONS.houses.map(h => [h.id, h]));

function mapStopsToPath(path, stops) {
  // stops = [depot, stop_1, stop_2, ..., depot]
  // We want to find the exact path waypoint index where each stop is reached in order
  const stopWaypoints = [];
  let searchStartIndex = 0;

  // S_0 is depot at index 0
  stopWaypoints.push({ stop: stops[0], index: 0, distance: 0 });

  for (let s = 1; s < stops.length; s++) {
    const targetStop = stops[s];
    let bestIdx = searchStartIndex;
    let minDist = Infinity;

    // Search forward along path from searchStartIndex
    // We search the remaining path or a reasonable forward window
    for (let i = searchStartIndex; i < path.length; i++) {
      const pt = path[i];
      const d = calculateHaversineDistance(pt.lat, pt.lon, targetStop.lat, targetStop.lon);
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
      }
    }

    stopWaypoints.push({
      stop: targetStop,
      index: bestIdx,
      distanceMeters: (minDist * 1000).toFixed(1)
    });

    // Advance searchStartIndex for the next stop to ensure sequential ordering
    searchStartIndex = Math.min(path.length - 1, bestIdx + 1);
  }

  return stopWaypoints;
}

const testRoutes = [
  ['depot_house_2_depot', [depot, houseMap.get('house_2'), depot]],
  ['depot_house_c_house_e_depot', [depot, houseMap.get('house_3'), houseMap.get('house_5'), depot]],
  ['depot_house_a_house_b_house_c_house_d_house_e_depot', [
    depot,
    houseMap.get('house_1'),
    houseMap.get('house_2'),
    houseMap.get('house_3'),
    houseMap.get('house_4'),
    houseMap.get('house_5'),
    depot
  ]]
];

for (const [key, stops] of testRoutes) {
  console.log(`\n=== Testing route ${key} ===`);
  const data = PRECACHED_ROAD_DATA[key];
  if (!data) {
    console.log(`Route ${key} not in cache!`);
    continue;
  }
  const path = simulationService.resampleRoadPath(data.coordinates, stops);
  console.log(`Path length: ${path.length}`);

  const mapped = mapStopsToPath(path, stops);
  for (const m of mapped) {
    console.log(`  Stop "${m.stop.name}" (${m.stop.id}) -> path index ${m.index}/${path.length} (distance: ${m.distanceMeters || 0}m)`);
  }
}
