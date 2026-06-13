// ╔══════════════════════════════════════════════════════════════════════╗
// ║  WaterSafe V2 — Software SMS Alert Engine                           ║
// ║  Twilio-based | 4-State Machine | Trilingual (Hindi/Telugu/English) ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// State Machine:
//   SAFE → WARN_PENDING → ALARMING → CLEAR_PENDING → SAFE
//
//   SAFE:          Normal water. No SMS.
//   WARN_PENDING:  1st anomaly seen. Wait for 2nd to confirm (filter noise).
//   ALARMING:      2 consecutive anomalies confirmed. DANGER SMS sent.
//                  Re-alerts every 30 min if still anomalous.
//   CLEAR_PENDING: 1st safe reading after alarm. Wait for 2nd to confirm.
//                  ALL CLEAR SMS sent on 2nd safe reading.

import twilio from 'twilio';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER;
const SOURCE_NAME  = process.env.SOURCE_NAME || 'Water Source #1';

// ─── RECIPIENTS ──────────────────────────────────────────────────────────────
// Primary number active. Slots 2 and 3 ready for next hackathon rounds.
const RECIPIENTS = [
  '+918125912962',  // Primary demo recipient
  // '+91XXXXXXXXXX', // Round 2 — add number here
  // '+91XXXXXXXXXX', // Round 3 — add number here
];

// ─── TWILIO CLIENT ───────────────────────────────────────────────────────────
let client = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  client = twilio(TWILIO_SID, TWILIO_TOKEN);
  console.log('[SMS] ✓ Twilio client initialized. SMS alerts active.');
} else {
  console.warn('[SMS] ⚠ Twilio credentials not found in .env — SMS alerts disabled (server still works).');
}

// ─── REASON TRANSLATOR ───────────────────────────────────────────────────────
// Converts ESP32 technical reason strings into plain human language.
// Rural user cannot understand "Dissolved ion spike" or "MSE anomaly".
function translateReason(reason = '') {
  const r = reason.toLowerCase();

  if (r.includes('ion') || r.includes('tds') || r.includes('dissolved') || r.includes('salt') || r.includes('mineral')) {
    return {
      hi: 'पानी में अत्यधिक नमक/खनिज',
      te: 'నీటిలో అధిక లవణం/ఖనిజాలు',
      en: 'High mineral/salt content detected'
    };
  }
  if (r.includes('turbid') || r.includes('cloud') || r.includes('murk') || r.includes('dirty')) {
    return {
      hi: 'पानी बहुत गंदा/मटमैला है',
      te: 'నీరు చాలా మురుగుగా/గంద్రంగా ఉంది',
      en: 'Water appears very cloudy or dirty'
    };
  }
  if (r.includes('temp') || r.includes('thermal') || r.includes('hot') || r.includes('cold')) {
    return {
      hi: 'पानी का तापमान असामान्य है',
      te: 'నీటి ఉష్ణోగ్రత అసాధారణంగా ఉంది',
      en: 'Abnormal water temperature'
    };
  }
  // Default: multi-parameter or unknown
  return {
    hi: 'कई जल मानक असामान्य हैं',
    te: 'అనేక నీటి పారామీటర్లు అసాధారణంగా ఉన్నాయి',
    en: 'Multiple water quality parameters abnormal'
  };
}

// ─── MESSAGE BUILDERS ─────────────────────────────────────────────────────────
// Unicode SMS = 70 chars/segment. Each language is a self-contained block.
// A rural user reading only Hindi or only Telugu still gets the full message.

export function buildDangerMessage(reason) {
  const r = translateReason(reason);
  return [
    `⚠️ WaterSafe चेतावनी / హెచ్చరిక`,
    ``,
    `[हिंदी] जल दूषित है! ${SOURCE_NAME} का पानी अभी उपयोग न करें।`,
    `कारण: ${r.hi}।`,
    `बोतलबंद या कुएं का पानी पीयें।`,
    ``,
    `[తెలుగు] నీరు కలుషితమైంది! ${SOURCE_NAME} నీరు వెంటనే వాడకం ఆపండి.`,
    `కారణం: ${r.te}.`,
    ``,
    `[ENG] WATER UNSAFE. ${r.en} at ${SOURCE_NAME}. STOP drinking/cooking with it.`,
    `-WaterSafe`
  ].join('\n');
}

export function buildAllClearMessage() {
  return [
    `✅ WaterSafe — पानी सुरक्षित / నీరు సురక్షితం`,
    ``,
    `[हिंदी] ${SOURCE_NAME} का पानी अब सुरक्षित है।`,
    `जाँच पूरी हुई। सामान्य उपयोग फिर से शुरू करें।`,
    `सावधान रहें।`,
    ``,
    `[తెలుగు] ${SOURCE_NAME} నీరు ఇప్పుడు సురక్షితంగా ఉంది.`,
    `మళ్ళీ వాడవచ్చు. జాగ్రత్తగా ఉండండి.`,
    ``,
    `[ENG] CLEAR: Water at ${SOURCE_NAME} is safe again. Normal use can resume.`,
    `-WaterSafe`
  ].join('\n');
}

export function buildReAlertMessage(reason) {
  const r = translateReason(reason);
  return [
    `⚠️ WaterSafe अनुस्मारक / రిమైండర్`,
    ``,
    `[हिंदी] ${SOURCE_NAME} का पानी अभी भी दूषित है। उपयोग न करें!`,
    ``,
    `[తెలుగు] ${SOURCE_NAME} నీరు ఇంకా కలుషితంగా ఉంది. వాడకండి!`,
    ``,
    `[ENG] REMINDER: Water at ${SOURCE_NAME} still unsafe. ${r.en}.`,
    `-WaterSafe`
  ].join('\n');
}

// ─── SEND TO ALL RECIPIENTS ───────────────────────────────────────────────────
async function sendSMSToAll(message) {
  if (!client) {
    // Gracefully log the message when no credentials are configured
    console.log('[SMS] (No Twilio client — printing message instead):\n' + '─'.repeat(60));
    console.log(message);
    console.log('─'.repeat(60));
    return;
  }

  for (const to of RECIPIENTS) {
    try {
      const msg = await client.messages.create({
        body: message,
        from: TWILIO_FROM,
        to
      });
      console.log(`[SMS] ✓ Sent to ${to} | SID: ${msg.sid}`);
    } catch (err) {
      console.error(`[SMS] ✗ Failed to send to ${to}: ${err.message}`);
    }
  }
}

// ─── 4-STATE SMS STATE MACHINE ────────────────────────────────────────────────
let smsState               = 'SAFE';
let consecutiveUnsafeCount = 0;
let consecutiveSafeCount   = 0;
let lastAlertSMSTime       = 0;
const REALERT_INTERVAL     = 30 * 60 * 1000; // 30 minutes

// alertLevel values from context_layer.h:
//   0 = NORMAL  | 1 = UNCERTAIN | 2 = CAUTION (30-59% conf)
//   3 = WARNING (60-79% conf)   | 4 = CRITICAL (80-100% conf)
export async function updateSMSState(alertLevel, reason) {
  const now = Date.now();

  const isUnsafe = alertLevel >= 2; // CAUTION, WARNING, CRITICAL
  const isSafe   = alertLevel <= 1; // NORMAL, UNCERTAIN

  console.log(`[SMS-FSM] Input: level=${alertLevel} (isUnsafe=${isUnsafe}, isSafe=${isSafe}), State=${smsState}, UnsafeCount=${consecutiveUnsafeCount}, SafeCount=${consecutiveSafeCount}`);

  switch (smsState) {

    // ── State 1: Normal ───────────────────────────────────────────────────────
    case 'SAFE':
      if (isUnsafe) {
        consecutiveUnsafeCount = 1;
        consecutiveSafeCount = 0;
        smsState = 'WARN_PENDING';
        console.log(`[SMS-FSM] SAFE → WARN_PENDING (1st consecutive unsafe reading)`);
      } else {
        // Already safe, reset counters
        consecutiveUnsafeCount = 0;
        consecutiveSafeCount = 0;
      }
      break;

    // ── State 2: 1 or 2 consecutive anomalies seen — waiting for 3rd to confirm ─────
    case 'WARN_PENDING':
      if (isUnsafe) {
        consecutiveUnsafeCount++;
        console.log(`[SMS-FSM] WARN_PENDING (consecutive unsafe count: ${consecutiveUnsafeCount}/3)`);
        if (consecutiveUnsafeCount >= 3) {
          smsState = 'ALARMING';
          consecutiveUnsafeCount = 0;
          consecutiveSafeCount = 0;
          lastAlertSMSTime = now;
          console.log('[SMS-FSM] WARN_PENDING → ALARMING — 3 consecutive unsafe readings! Dispatching DANGER SMS');
          await sendSMSToAll(buildDangerMessage(reason));
        }
      } else {
        // Was just temporary noise/anomaly, return to SAFE quietly
        smsState = 'SAFE';
        consecutiveUnsafeCount = 0;
        consecutiveSafeCount = 0;
        console.log('[SMS-FSM] WARN_PENDING → SAFE (anomaly did not persist, reset to SAFE)');
      }
      break;

    // ── State 3: Active alarm — re-alert every 30 min if still unsafe ───
    case 'ALARMING':
      if (isSafe) {
        consecutiveSafeCount = 1;
        consecutiveUnsafeCount = 0;
        smsState = 'CLEAR_PENDING';
        console.log('[SMS-FSM] ALARMING → CLEAR_PENDING (1st consecutive safe reading)');
      } else {
        // Still unsafe, reset safe counter
        consecutiveSafeCount = 0;
        if (now - lastAlertSMSTime >= REALERT_INTERVAL) {
          lastAlertSMSTime = now;
          console.log('[SMS-FSM] ALARMING — Still unsafe. Sending 30-min re-alert.');
          await sendSMSToAll(buildReAlertMessage(reason));
        }
      }
      break;

    // ── State 4: 1 or 2 safe readings after alarm — waiting for 3rd to confirm ───
    case 'CLEAR_PENDING':
      if (isSafe) {
        consecutiveSafeCount++;
        console.log(`[SMS-FSM] CLEAR_PENDING (consecutive safe count: ${consecutiveSafeCount}/3)`);
        if (consecutiveSafeCount >= 3) {
          smsState = 'SAFE';
          consecutiveUnsafeCount = 0;
          consecutiveSafeCount = 0;
          console.log('[SMS-FSM] CLEAR_PENDING → SAFE — 3 consecutive safe readings! Dispatching ALL CLEAR SMS');
          await sendSMSToAll(buildAllClearMessage());
        }
      } else {
        // Relapsed back into anomaly territory
        smsState = 'ALARMING';
        consecutiveUnsafeCount = 0;
        consecutiveSafeCount = 0;
        lastAlertSMSTime = now;
        console.log('[SMS-FSM] CLEAR_PENDING → ALARMING (relapse!) — Re-dispatching DANGER SMS');
        await sendSMSToAll(buildDangerMessage(reason));
      }
      break;
  }
}

// Export state for the /api/status endpoint
export function getSMSState() {
  return smsState;
}
