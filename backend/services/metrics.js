/**
 * Sustainability & Financial Metrics Service
 * Calculates estimated fuel savings, monetary savings, and CO2 emissions reduction.
 */

const CONFIG = {
  // Average fuel efficiency of light commercial collection vehicle (km per liter)
  fuelEfficiencyKmPerLiter: 10.0,
  
  // Local fuel price per liter (INR / INR ₹ or generic currency unit)
  fuelPricePerLiter: 100.0,
  
  // EPA / DEFRA standard emission factor for diesel: ~2.64 - 2.68 kg CO2 per liter consumed
  co2EmissionFactorKgPerLiter: 2.64
};

/**
 * Compute environmental and cost savings comparison between normal and optimized routes
 * @param {number} normalDistanceKm 
 * @param {number} optimizedDistanceKm 
 * @returns {object} Calculated metrics (labeled as estimates)
 */
function calculateSavingsMetrics(normalDistanceKm, optimizedDistanceKm) {
  // Ensure non-negative distances
  const normDist = Math.max(0, normalDistanceKm);
  const optDist = Math.max(0, optimizedDistanceKm);

  // Distance saved
  const distanceSavedKm = Math.max(0, normDist - optDist);
  const percentageDistanceSaved = normDist > 0 
    ? ((distanceSavedKm / normDist) * 100) 
    : 0;

  // Fuel consumed for each
  const normalFuelLiters = normDist / CONFIG.fuelEfficiencyKmPerLiter;
  const optimizedFuelLiters = optDist / CONFIG.fuelEfficiencyKmPerLiter;
  const fuelSavedLiters = Math.max(0, normalFuelLiters - optimizedFuelLiters);

  // Financial savings
  const estimatedCostSaved = fuelSavedLiters * CONFIG.fuelPricePerLiter;

  // CO2 reduction (kg)
  const estimatedCo2ReductionKg = fuelSavedLiters * CONFIG.co2EmissionFactorKgPerLiter;

  return {
    normalDistanceKm: Number(normDist.toFixed(2)),
    optimizedDistanceKm: Number(optDist.toFixed(2)),
    distanceSavedKm: Number(distanceSavedKm.toFixed(2)),
    percentageDistanceSaved: Number(percentageDistanceSaved.toFixed(1)),
    normalFuelLiters: Number(normalFuelLiters.toFixed(2)),
    optimizedFuelLiters: Number(optimizedFuelLiters.toFixed(2)),
    fuelSavedLiters: Number(fuelSavedLiters.toFixed(2)),
    estimatedCostSaved: Number(estimatedCostSaved.toFixed(2)),
    estimatedCo2ReductionKg: Number(estimatedCo2ReductionKg.toFixed(2)),
    config: { ...CONFIG },
    disclaimer: "All fuel, cost, and CO2 metrics are college simulation estimates based on standard commercial vehicle emission factors."
  };
}

module.exports = {
  calculateSavingsMetrics,
  METRICS_CONFIG: CONFIG
};
