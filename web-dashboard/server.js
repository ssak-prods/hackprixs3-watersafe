import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { updateSMSState, getSMSState } from './sms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory data store for the Hackathon Demo
let latestData = {
  is_anomaly: false,
  alert_level: 0,
  confidence: 0,
  reason: "Awaiting hardware data...",
  tds: 0,
  turbidity: 0,
  temperature: 0,
  battery: 100,
  signal: 'Unknown',
  last_seen: Date.now()
};

let historicalData = [];
let alertsHistory = [];

/**
 * ESP32 Hardware Endpoint
 * The ESP32 will POST JSON data here every 3 seconds
 */
app.post('/api/ingest', async (req, res) => {
  const { tds, turbidity, temperature, confidence, alert_level, reason, is_anomaly } = req.body;

  if (tds === undefined || turbidity === undefined) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Respond to ESP32 immediately — don't block on SMS
  res.status(200).json({ success: true });

  // Update latest state
  const prevAlertLevel = latestData.alert_level ?? 0;

  latestData = {
    ...latestData,
    tds,
    turbidity,
    temperature,
    confidence,
    alert_level,
    reason,
    is_anomaly,
    last_seen: Date.now()
  };

  // Log history (sampled ~every 1 min to prevent mem leak in demo)
  if (Math.random() < 0.05) {
    historicalData.push({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tds,
      turbidity,
      isAnomaly: is_anomaly
    });
    if (historicalData.length > 50) historicalData.shift();
  }

  // Only log to alert history on transitions TO WARNING or CRITICAL (alert_level >= 3).
  // CAUTION and UNCERTAIN are informational — they don't create dashboard alerts.
  if (alert_level >= 3 && prevAlertLevel < 3) {
    alertsHistory.unshift({
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      severity: alert_level >= 4 ? 'high' : 'medium',
      message: reason,
      action: alert_level >= 4 ? 'Stop using immediately. Call for help.' : 'Reduce use and monitor closely.',
      acknowledged: false
    });
    if (alertsHistory.length > 20) alertsHistory.pop();
  }

  console.log(`[INGEST] TDS=${tds} Turb=${turbidity} Conf=${confidence}% Anomaly=${is_anomaly} SMSState=${getSMSState()}`);

  // ── Software SMS State Machine ──────────────────────────────────────────
  // Runs every reading. Handles 2-consecutive confirmation, 30-min re-alerts,
  // and 2-consecutive safe confirmation before sending ALL CLEAR.
  await updateSMSState(alert_level, reason);
});

/**
 * Frontend GET Endpoint
 * React App calls this to get live view
 */
app.get('/api/status', (req, res) => {
  res.json({
    current: latestData,
    alerts: alertsHistory,
    history: historicalData,
    smsState: getSMSState()  // Visible in dashboard: SAFE | WARN_PENDING | ALARMING | CLEAR_PENDING
  });
});

/**
 * Acknowledge Alert Endpoint
 */
app.post('/api/alerts/:id/ack', (req, res) => {
  const id = parseInt(req.params.id);
  const alert = alertsHistory.find(a => a.id === id);
  if (alert) {
    alert.acknowledged = true;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Serve the Vite React App in production
app.use(express.static(join(__dirname, 'dist')));

// Fallback all routes to index.html for React Router / PWA client side routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`WaterSafe V2 Server running on port ${PORT}`);
});
