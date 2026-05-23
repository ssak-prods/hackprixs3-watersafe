/**
 * Mock Data Layer for WaterSafe V2
 * Simulates a flaky internet connection and realistic ESP32 sensor bounds.
 */

const NORMAL_STATE = {
  is_anomaly: false,
  alert_level: 0,
  confidence: 0,
  reason: "All parameters nominal",
  tds: 155.0,
  turbidity: 45.0,
  temperature: 27.5,
  battery: 89,
  signal: 'Strong',
  last_seen: Date.now()
};

let currentState = { ...NORMAL_STATE };
export let alertsHistory = [];
export let historicalData = Array.from({length: 24}, (_, i) => ({
  time: new Date(Date.now() - (23 - i) * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
  tds: 150 + Math.random() * 20,
  turbidity: 40 + Math.random() * 15,
  isAnomaly: false
}));

let lastAnomalyState = false;

// Generate minor noise (± variations)
function applyNoise(base, variance) {
  return base + (Math.random() * variance * 2 - variance);
}

// Tick the simulation every 3 seconds
setInterval(() => {
  // 1% chance to drop offline (simulate 10 min delay)
  if (Math.random() < 0.01) {
    currentState.last_seen -= 10 * 60 * 1000;
  } else {
    currentState.last_seen = Date.now();
  }

  // 2% chance of a severe anomaly
  if (Math.random() < 0.02) {
    currentState.is_anomaly = true;
    currentState.alert_level = 3; // Warning
    currentState.confidence = 85;
    currentState.reason = "Turbidity anomaly only";
    currentState.turbidity = applyNoise(1500, 200); // Massive spike
    currentState.tds = applyNoise(160, 5); // Flat
    currentState.temperature = applyNoise(27.5, 0.5); // Flat
  } else if (currentState.is_anomaly && Math.random() < 0.3) {
    // 30% chance to recover from anomaly every tick
    currentState = { ...NORMAL_STATE };
  } else if (!currentState.is_anomaly) {
    // Standard noise
    currentState.tds = applyNoise(155, 10);
    currentState.turbidity = applyNoise(45, 15);
    currentState.temperature = applyNoise(27.5, 0.4);
  }

  // Record history (every tick for demo purposes, normally every hour)
  if (Math.random() < 0.1) {
    historicalData.shift();
    historicalData.push({
      time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      tds: currentState.tds,
      turbidity: currentState.turbidity,
      isAnomaly: currentState.is_anomaly
    });
  }

  // Add alert if transitioned to anomaly
  if (currentState.is_anomaly && !lastAnomalyState) {
    alertsHistory.unshift({
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      severity: 'high',
      message: currentState.reason,
      action: "Stop using immediately. Call for help.",
      acknowledged: false
    });
  }
  lastAnomalyState = currentState.is_anomaly;

}, 3000);

export async function fetchLiveStatus() {
  // Simulate 3G latency (300-800ms)
  await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

  // Simulate network failure 5% of the time
  if (Math.random() < 0.05) {
    throw new Error('Network timeout');
  }

  return { 
    current: { ...currentState },
    alerts: [...alertsHistory],
    history: [...historicalData]
  };
}
