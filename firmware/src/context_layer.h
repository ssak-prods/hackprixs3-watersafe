#ifndef CONTEXT_LAYER_H
#define CONTEXT_LAYER_H

#include <Arduino.h>

// ─── ALERT LEVELS ────────────────────────────────────────────────────────────
#define ALERT_NORMAL    0
#define ALERT_UNCERTAIN 1   // Confidence  0–29%
#define ALERT_CAUTION   2   // Confidence 30–59%
#define ALERT_WARNING   3   // Confidence 60–79%
#define ALERT_CRITICAL  4   // Confidence 80–100%

// ─── LOCATION CONTEXT (change per deployment site) ───────────────────────────
#define LOCATION_UNKNOWN    0
#define LOCATION_URBAN      1
#define LOCATION_FARM       2
#define LOCATION_INDUSTRIAL 3
#define DEVICE_LOCATION LOCATION_UNKNOWN  // <- Edit before flashing at a site

// ─── SENSOR VOTE STRUCT ───────────────────────────────────────────────────────
struct SensorVote {
    bool tds_fired;
    bool turb_fired;
    bool temp_fired;
    uint8_t total_votes;  // 0–3
};

// ─── CONTEXT RESULT ──────────────────────────────────────────────────────────
struct ContextResult {
    uint8_t  confidence;          // 0–100 (%)
    uint8_t  alert_level;         // ALERT_* define
    bool     is_anomaly;          // True if alert_level >= ALERT_CAUTION
    SensorVote votes;
    char     reason[36];          // Short reason → status screen
    char     why_tds[18];         // "TDS  [ OK ] 161ppm"
    char     why_turb[18];        // "TURB [ !! ] 1054NTU"
    char     why_temp[16];        // "TEMP [ OK ] 25.9C"
    char     why_summary[22];     // "Votes: 2/3 | Conf: 78%"
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
void          context_setup();
ContextResult context_evaluate(float tds, float turb, float temp,
                                float mse,  int   anomaly_count);

#endif // CONTEXT_LAYER_H
