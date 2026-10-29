/**
 * GPS-Based Smart Garbage Collection Route Optimizer
 * Demonstration Coordinates Configuration
 * 
 * NOTE: These are fictional demonstration coordinates spaced around a realistic
 * smart-city neighborhood (~200m - 600m apart).
 * You can change these coordinates to your college campus or city neighborhood.
 */

const LOCATIONS = {
  depot: {
    id: 'depot',
    name: 'Central Waste Depot',
    type: 'depot',
    lat: 12.97160,
    lon: 77.59460,
    address: 'Smart City Waste Management Central Hub'
  },
  houses: [
    {
      id: 'house_a',
      name: 'House A',
      type: 'house',
      lat: 12.97380,
      lon: 77.59580,
      address: 'Plot 101, Green Avenue'
    },
    {
      id: 'house_b',
      name: 'House B',
      type: 'house',
      lat: 12.97510,
      lon: 77.59840,
      address: 'Plot 102, Lake View Road'
    },
    {
      id: 'house_c',
      name: 'House C',
      type: 'house',
      lat: 12.97240,
      lon: 77.60010,
      address: 'Plot 103, East Boulevard'
    },
    {
      id: 'house_d',
      name: 'House D',
      type: 'house',
      lat: 12.96920,
      lon: 77.59800,
      address: 'Plot 104, Sunrise Sector'
    },
    {
      id: 'house_e',
      name: 'House E',
      type: 'house',
      lat: 12.96850,
      lon: 77.59420,
      address: 'Plot 105, South Park Ring'
    }
  ]
};

// CommonJS export for Node.js backend
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LOCATIONS;
}

// Global browser window export for Vanilla Frontend
if (typeof window !== 'undefined') {
  window.DEMO_LOCATIONS = LOCATIONS;
}
