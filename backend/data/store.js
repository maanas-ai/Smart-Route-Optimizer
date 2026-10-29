/**
 * In-Memory Data Store with JSON State Management
 * Holds live status for Bins A-E, Truck GPS telemetry, and Demo simulation triggers.
 */

const LOCATIONS = require('../../config/locations');

// Default initial state for the 5 houses
const INITIAL_BINS = [
  {
    id: 'house_a',
    name: 'House A',
    fill_percentage: 25,
    measured_distance_cm: 16.0,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_b',
    name: 'House B',
    fill_percentage: 30,
    measured_distance_cm: 15.2,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_c',
    name: 'House C',
    fill_percentage: 85,
    measured_distance_cm: 6.4,
    status: 'COLLECTION REQUIRED',
    collection_required: true,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_d',
    name: 'House D',
    fill_percentage: 45,
    measured_distance_cm: 12.8,
    status: 'MEDIUM',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_e',
    name: 'House E',
    fill_percentage: 90,
    measured_distance_cm: 5.6,
    status: 'COLLECTION REQUIRED',
    collection_required: true,
    last_updated: new Date().toISOString()
  }
];

// Clean baseline state where all bins are in NORMAL status (<80%)
const CLEAN_BINS = [
  {
    id: 'house_a',
    name: 'House A',
    fill_percentage: 20,
    measured_distance_cm: 16.8,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_b',
    name: 'House B',
    fill_percentage: 25,
    measured_distance_cm: 16.0,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_c',
    name: 'House C',
    fill_percentage: 30,
    measured_distance_cm: 15.2,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_d',
    name: 'House D',
    fill_percentage: 22,
    measured_distance_cm: 16.5,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  },
  {
    id: 'house_e',
    name: 'House E',
    fill_percentage: 18,
    measured_distance_cm: 17.1,
    status: 'NORMAL',
    collection_required: false,
    last_updated: new Date().toISOString()
  }
];

const INITIAL_TRUCK = {
  lat: LOCATIONS.depot.lat,
  lon: LOCATIONS.depot.lon,
  speed_kmh: 0,
  satellites: 0,
  isLiveGps: false,
  gpsMode: 'DEMO GPS', // 'LIVE GPS' or 'DEMO GPS'
  status: 'Stationary at Central Depot',
  last_updated: new Date().toISOString()
};

class Store {
  constructor() {
    // Start with clean baseline data so all bins are in NORMAL status (<80%)
    this.bins = JSON.parse(JSON.stringify(CLEAN_BINS));
    this.truck = JSON.parse(JSON.stringify(INITIAL_TRUCK));
  }

  reset(toClean = true) {
    // Reset to clean baseline (<80%) or initial sample
    const source = toClean ? CLEAN_BINS : INITIAL_BINS;
    this.bins = JSON.parse(JSON.stringify(source));
    this.truck = JSON.parse(JSON.stringify(INITIAL_TRUCK));
  }

  getBins() {
    return this.bins;
  }

  getBin(id) {
    return this.bins.find(b => b.id.toLowerCase() === id.toLowerCase());
  }

  classifyStatus(fillPercentage) {
    if (fillPercentage >= 80) return 'COLLECTION REQUIRED';
    if (fillPercentage >= 40) return 'MEDIUM';
    return 'NORMAL';
  }

  updateBin(id, fillPercentage, distanceCm) {
    const bin = this.getBin(id);
    if (!bin) return null;

    const clamped = Math.min(100, Math.max(0, Number(fillPercentage)));
    bin.fill_percentage = Math.round(clamped);
    if (distanceCm !== undefined && distanceCm !== null) {
      bin.measured_distance_cm = Number(distanceCm);
    }
    bin.status = this.classifyStatus(bin.fill_percentage);
    bin.collection_required = bin.fill_percentage >= 80;
    bin.last_updated = new Date().toISOString();
    return bin;
  }

  updateAllBins(binsArray) {
    binsArray.forEach(incoming => {
      if (incoming.id) {
        this.updateBin(incoming.id, incoming.fill_percentage, incoming.measured_distance_cm);
      }
    });
    return this.bins;
  }

  getTruck() {
    return this.truck;
  }

  updateTruck({ lat, lon, speed_kmh, satellites, isLiveGps, status }) {
    if (lat !== undefined && lon !== undefined) {
      this.truck.lat = Number(lat);
      this.truck.lon = Number(lon);
    }
    if (speed_kmh !== undefined) this.truck.speed_kmh = Number(speed_kmh);
    if (satellites !== undefined) this.truck.satellites = Number(satellites);
    
    if (isLiveGps !== undefined) {
      this.truck.isLiveGps = Boolean(isLiveGps);
      this.truck.gpsMode = this.truck.isLiveGps ? 'LIVE GPS' : 'DEMO GPS';
    }

    if (status) {
      this.truck.status = status;
    }

    this.truck.last_updated = new Date().toISOString();
    return this.truck;
  }
}

// Export singleton instance
module.exports = new Store();
