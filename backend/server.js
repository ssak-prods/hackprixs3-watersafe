import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { updateSMSState, getSMSState } from './sms.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Allow requests from any origin (Vercel frontend, ESP32, etc.)
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'WaterSafe Backend', uptime: process.uptime() });
});

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

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌊 WaterSafe Backend running on port ${PORT}`);
});
