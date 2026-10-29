// End-to-end integration test simulating exact serial stream + truck animation
import { parseArduinoDataLine, parseArduinoDistanceLine } from './src/utils/validation.js';
import { serialService } from './src/services/serialService.js';
import { simulationService } from './src/services/simulationService.js';
import { computeOptimizedRoutePlan } from './src/services/routeOptimizer.js';

console.log('====================================================');
console.log('TEST 3: End-to-End Serial Stream & Truck Route Run');
console.log('====================================================');

const locations = {
  depot: { id: 'depot', name: 'Central Depot', lat: 12.9716, lon: 77.5946, address: 'Central Municipal Depot, Main Rd' },
  houses: [
    { id: 'house_1', binNumber: 1, name: 'House 1', lat: 12.9740, lon: 77.5920, address: 'Plot 101, Green Valley' },
    { id: 'house_2', binNumber: 2, name: 'House 2', lat: 12.9760, lon: 77.5930, address: 'Plot 102, Lake View' },
    { id: 'house_3', binNumber: 3, name: 'House 3', lat: 12.9780, lon: 77.5970, address: 'Plot 103, East Boulevard' },
    { id: 'house_4', binNumber: 4, name: 'House 4', lat: 12.9750, lon: 77.5990, address: 'Plot 104, Sunrise Residency' },
    { id: 'house_5', binNumber: 5, name: 'House 5', lat: 12.9720, lon: 77.5980, address: 'Plot 105, South Park Ring' }
  ]
};

let bins = [
  { id: 'house_1', binNumber: 1, name: 'House 1', fillPercentage: 20, distanceCm: 16.0 },
  { id: 'house_2', binNumber: 2, name: 'House 2', fillPercentage: 20, distanceCm: 16.0 },
  { id: 'house_3', binNumber: 3, name: 'House 3', fillPercentage: 20, distanceCm: 16.0 },
  { id: 'house_4', binNumber: 4, name: 'House 4', fillPercentage: 20, distanceCm: 16.0 },
  { id: 'house_5', binNumber: 5, name: 'House 5', fillPercentage: 20, distanceCm: 16.0 }
];

const threshold = 80;
let routePlan = null;
let recalculateCount = 0;
let prevCriticalKey = null;

function getCriticalBinsKey(binList, th) {
  return binList
    .filter(b => !b.sensorError && b.fillPercentage !== null && b.fillPercentage !== undefined && b.fillPercentage >= th)
    .map(b => b.id)
    .sort()
    .join(',');
}

async function handleBinsUpdate(newBins) {
  bins = newBins;
  const currentKey = getCriticalBinsKey(bins, threshold);
  if (currentKey !== prevCriticalKey || routePlan === null) {
    prevCriticalKey = currentKey;
    recalculateCount++;
    console.log(`[ROUTE PLANNER] Calculating route for critical bins: [${currentKey}] (Run #${recalculateCount})`);
    routePlan = await computeOptimizedRoutePlan(bins, locations, threshold);
    if (simulationService.status === 'running' || simulationService.status === 'paused') {
      simulationService.handleRouteRecalculation(routePlan.stops, routePlan.routeCoordinates);
    }
  }
}

// 1. Setup serial service callback
serialService.onData(async (values, rawLine) => {
  const updatedBins = bins.map((b, i) => ({
    ...b,
    fillPercentage: values[i],
    sensorError: values[i] === null
  }));
  await handleBinsUpdate(updatedBins);
});

// 2. Feed initial Arduino packet: DATA:15.0,25.0,85.0,45.0,92.0
console.log('Injecting initial packet: DATA:15.0,25.0,85.0,45.0,92.0');
serialService.handleIncomingChunk('DATA:15.0,25.0,85.0,45.0,92.0\r\n');

// Wait for route plan
setTimeout(async () => {
  console.log(`Stops in plan: ${routePlan.stops.map(s => s.name).join(' -> ')}`);
  console.log(`Requires pickup: ${routePlan.requiresCollection}, Target Count: ${routePlan.targetCount}`);
  console.log(`Total Distance: ${routePlan.optimizedDistanceKm} km, Route coords: ${routePlan.routeCoordinates.length}`);

  const hasH3 = routePlan.stops.some(s => s.id === 'house_3');
  const hasH5 = routePlan.stops.some(s => s.id === 'house_5');
  if (!hasH3 || !hasH5) {
    console.error('FAIL: Stops do not include H3 and H5!');
    process.exit(1);
  }

  // 3. Start truck simulation
  console.log('\nStarting truck simulation along OSRM road coordinates...');
  simulationService.setSpeed(10.0);
  simulationService.start(routePlan.stops, routePlan.routeCoordinates);

  // 4. Repeatedly inject identical serial packets while truck is moving (simulating real Arduino)
  let packetCount = 0;
  const initialRecalcCount = recalculateCount;

  const serialInterval = setInterval(() => {
    packetCount++;
    // Arduino sending packet every tick
    serialService.handleIncomingChunk('DATA:15.0,25.0,85.0,45.0,92.0\r\n');
  }, 30);

  // Let the truck run through the route
  const checkTruck = setInterval(() => {
    const s = simulationService.getState();
    process.stdout.write(`\rTruck Progress: ${s.progressPercent}% | Step: ${simulationService.stepIndex}/${simulationService.interpolatedPath.length} | Packets received: ${packetCount} | Status: ${s.status}   `);

    if (s.status === 'completed' || s.progressPercent === 100) {
      clearInterval(serialInterval);
      clearInterval(checkTruck);
      console.log('\n\nTruck reached 100% completion at Depot!');
      console.log(`Total serial packets injected during trip: ${packetCount}`);
      console.log(`Total route recalculations: ${recalculateCount} (was ${initialRecalcCount} at start)`);

      if (recalculateCount !== initialRecalcCount) {
        console.error('FAIL: Route was re-calculated unnecessarily on repeated serial packets!');
        process.exit(1);
      }
      console.log('PASS: Route was NOT recalculated repeatedly during the trip!');
      console.log('PASS: Truck completed entire route cleanly without resetting!\n');
      process.exit(0);
    }
  }, 40);

}, 300);
