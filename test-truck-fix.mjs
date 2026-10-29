// Comprehensive Automated Test for Truck Animation Fix
import { parseArduinoDataLine, parseArduinoDistanceLine, validateFiveBinReadings } from './src/utils/validation.js';
import { simulationService } from './src/services/simulationService.js';
import { calculateHaversineDistance } from './src/utils/distance.js';

console.log('====================================================');
console.log('TEST 1: Arduino Serial Parser Validation (Req 6)');
console.log('====================================================');

const testCases = [
  { input: 'DATA:15.0,25.0,85.0,45.0,92.0', expectValid: true, expected: [15.0, 25.0, 85.0, 45.0, 92.0] },
  { input: 'DATA:15.0,25.0,85.0,45.0', expectValid: false }, // Only 4 values
  { input: 'DATA:15.0,25.0,85.0,45.0,92.0,10.0', expectValid: false }, // 6 values
  { input: 'DATA:15.0,abc,85.0,45.0,92.0', expectValid: false }, // Unparseable
  { input: 'DATA:15.0,25.0,85.0,-1.0,92.0', expectValid: true, expected: [15.0, 25.0, 85.0, null, 92.0] }, // Sentinel -1.0
  { input: 'DATA:15.0,25.0,150.0,45.0,92.0', expectValid: false }, // > 100%
  { input: 'DIST:8.5,8.0,3.5,-1.0,7.5', expectDist: true, expectedDist: [8.5, 8.0, 3.5, null, 7.5] },
];

let parserPassed = true;
for (const tc of testCases) {
  if (tc.expectDist) {
    const res = parseArduinoDistanceLine(tc.input);
    const pass = JSON.stringify(res) === JSON.stringify(tc.expectedDist);
    console.log(`[DIST PARSER] "${tc.input}" -> ${JSON.stringify(res)} | ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) parserPassed = false;
  } else {
    const res = parseArduinoDataLine(tc.input);
    if (tc.expectValid) {
      const pass = res !== null && JSON.stringify(res) === JSON.stringify(tc.expected);
      console.log(`[DATA PARSER] "${tc.input}" -> ${JSON.stringify(res)} | ${pass ? 'PASS' : 'FAIL'}`);
      if (!pass) parserPassed = false;
    } else {
      const pass = res === null;
      console.log(`[DATA PARSER] Malformed "${tc.input}" -> ${res} | ${pass ? 'PASS (Correctly rejected)' : 'FAIL'}`);
      if (!pass) parserPassed = false;
    }
  }
}

if (!parserPassed) {
  console.error('Parser validation failed!');
  process.exit(1);
}
console.log('Parser tests passed cleanly.\n');

console.log('====================================================');
console.log('TEST 2: Truck Simulation Animation & Mid-Trip Recalculation');
console.log('====================================================');

// Mock route coordinates for Depot -> H3 -> H5 -> Depot
const depot = { id: 'depot', name: 'Central Depot', lat: 12.9716, lon: 77.5946 };
const house3 = { id: 'house_3', name: 'House 3', lat: 12.9740, lon: 77.5980 };
const house5 = { id: 'house_5', name: 'House 5', lat: 12.9770, lon: 77.5990 };
const house1 = { id: 'house_1', name: 'House 1', lat: 12.9730, lon: 77.5960 };

const stopsA = [depot, house3, house5, depot];
const coordsA = [
  [12.9716, 77.5946],
  [12.9725, 77.5960],
  [12.9740, 77.5980], // House 3
  [12.9755, 77.5985],
  [12.9770, 77.5990], // House 5
  [12.9740, 77.5960],
  [12.9716, 77.5946]  // Depot
];

// Start simulation
simulationService.start(stopsA, coordsA);
let state = simulationService.getState();
console.log(`Initial Status: ${state.status}, Step: ${simulationService.stepIndex}, Progress: ${state.progressPercent}%, Pos: ${state.currentPosition.lat},${state.currentPosition.lon}`);

if (state.status !== 'running' || simulationService.stepIndex !== 0) {
  console.error('FAIL: Simulation failed to start at step 0');
  process.exit(1);
}

// Advance simulation partially (simulate truck moving halfway through)
const initialPathLen = simulationService.interpolatedPath.length;
const midPointIndex = Math.floor(initialPathLen * 0.45);
simulationService.stepIndex = midPointIndex;
const midPoint = simulationService.interpolatedPath[midPointIndex];
simulationService.currentPosition = { lat: midPoint.lat, lon: midPoint.lon, schematic: null };
simulationService.visitedStopIds.add('house_3'); // Marked House 3 visited
const midProgress = Math.round((midPointIndex / (initialPathLen - 1)) * 100);
simulationService.progressPercent = midProgress;

console.log(`Truck is mid-trip at step ${midPointIndex}/${initialPathLen} (~${midProgress}%), Visited:`, Array.from(simulationService.visitedStopIds));

// TEST 2A: Repeated incoming serial packet with NO stops change (Req 2, 3, 4)
// In App.jsx, repeated DATA packets do NOT call handleRouteRecalculation because critical stops have not changed.
// Even if handleRouteRecalculation WERE called with identical stops:
const stepBefore = simulationService.stepIndex;
const posBefore = { ...simulationService.currentPosition };
// Should NOT reset step index to 0
simulationService.handleRouteRecalculation(stopsA, coordsA);
console.log(`After no-change recalculation: step=${simulationService.stepIndex} (was ${stepBefore}), pos=${simulationService.currentPosition.lat},${simulationService.currentPosition.lon}`);
if (simulationService.stepIndex === 0) {
  console.error('FAIL: Truck jumped back to Depot (step 0)!');
  process.exit(1);
}
console.log('PASS: Truck retained position and did not jump to depot.\n');

// TEST 2B: Dynamic route change mid-trip (House 1 fills to 85% -> Req 5, 12)
console.log('Simulating House 1 filling to 85% mid-trip...');
const stopsB = [depot, house3, house5, house1, depot];
const coordsB = [
  [12.9716, 77.5946],
  [12.9725, 77.5960],
  [12.9740, 77.5980], // House 3
  [12.9755, 77.5985],
  [12.9770, 77.5990], // House 5
  [12.9750, 77.5975],
  [12.9730, 77.5960], // House 1
  [12.9716, 77.5946]  // Depot
];

const posBeforeReroute = { ...simulationService.currentPosition };
const visitedBeforeReroute = new Set(simulationService.visitedStopIds);

simulationService.handleRouteRecalculation(stopsB, coordsB);

const stateAfterReroute = simulationService.getState();
console.log(`After dynamic reroute:`);
console.log(` - Status: ${stateAfterReroute.status}`);
console.log(` - Step: ${simulationService.stepIndex} / ${simulationService.interpolatedPath.length}`);
console.log(` - Progress: ${stateAfterReroute.progressPercent}%`);
console.log(` - Position: ${stateAfterReroute.currentPosition.lat}, ${stateAfterReroute.currentPosition.lon}`);
console.log(` - Visited stops retained:`, stateAfterReroute.visitedStopIds);

// Verify truck did not jump to depot
const distFromMid = calculateHaversineDistance(
  posBeforeReroute.lat, posBeforeReroute.lon,
  stateAfterReroute.currentPosition.lat, stateAfterReroute.currentPosition.lon
);
console.log(`Distance from pre-reroute position: ${(distFromMid * 1000).toFixed(2)} meters`);

if (distFromMid > 0.05) { // more than 50 meters jump
  console.error(`FAIL: Truck jumped position! Distance was ${(distFromMid * 1000).toFixed(2)}m`);
  process.exit(1);
}

if (!stateAfterReroute.visitedStopIds.includes('house_3')) {
  console.error('FAIL: Visited stop House 3 was lost during recalculation!');
  process.exit(1);
}

if (simulationService.stepIndex === 0) {
  console.error('FAIL: Step index reset to 0!');
  process.exit(1);
}

console.log('PASS: Dynamic reroute seamlessly snags current road coordinate without jumping to Depot.');

// TEST 2C: Advance truck to 100% completion (Req 8, 11)
console.log('\nAdvancing truck to completion along full road geometry...');
simulationService.setSpeed(10.0); // max speed for fast test

// Simulate run loop completion
simulationService.stepIndex = simulationService.interpolatedPath.length - 2;
// Trigger 2 ticks
setTimeout(() => {
  // Check completion
  const finalState = simulationService.getState();
  console.log(`Final Status: ${finalState.status}, Progress: ${finalState.progressPercent}%, Visited:`, finalState.visitedStopIds);
  simulationService.stop();
  if (finalState.progressPercent === 100 || finalState.status === 'completed') {
    console.log('PASS: Truck smoothly reached 100% and completed trip at depot!\n');
    console.log('====================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! Ready for college demo.');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error('FAIL: Truck did not reach completed state.');
    process.exit(1);
  }
}, 200);
