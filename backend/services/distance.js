/**
 * Distance Calculation Service
 * Uses the Haversine formula to compute great-circle distance between two GPS coordinates on Earth.
 */

const EARTH_RADIUS_KM = 6371; // Earth's mean radius in kilometers

/**
 * Convert degrees to radians
 * @param {number} deg 
 * @returns {number} radians
 */
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Calculate distance between two GPS coordinates using the Haversine formula
 * @param {number} lat1 Latitude of point 1 (in degrees)
 * @param {number} lon1 Longitude of point 1 (in degrees)
 * @param {number} lat2 Latitude of point 2 (in degrees)
 * @param {number} lon2 Longitude of point 2 (in degrees)
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;

  return distanceKm;
}

/**
 * Calculate total distance for an ordered route array of coordinate points
 * @param {Array<{lat: number, lon: number}>} points 
 * @returns {number} Total distance in kilometers
 */
function calculateTotalRouteDistance(points) {
  if (!points || points.length < 2) {
    return 0;
  }

  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalDistance += calculateDistance(
      points[i].lat,
      points[i].lon,
      points[i + 1].lat,
      points[i + 1].lon
    );
  }

  return totalDistance;
}

module.exports = {
  calculateDistance,
  calculateTotalRouteDistance,
  EARTH_RADIUS_KM
};
