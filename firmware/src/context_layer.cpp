#include "context_layer.h"
#include "nn_weights.h"   // SCALER_MEAN, SCALER_SCALE, ANOMALY_THRESHOLD
#include <math.h>
#include <stdio.h>

// ─── MSE RING BUFFER (Trend Detection) ───────────────────────────────────────
#define TREND_WINDOW 5
static float  mse_history[TREND_WINDOW];
static uint8_t hist_idx   = 0;
static uint8_t hist_count = 0;

static int safe_streak = 3;  // Recovery persistence counter: start in safe state

void context_setup() {
    for (int i = 0; i < TREND_WINDOW; i++) mse_history[i] = 0.0f;
    hist_idx   = 0;
    hist_count = 0;
    safe_streak = 3;
}

// ─── MAIN EVALUATE ───────────────────────────────────────────────────────────
ContextResult context_evaluate(float tds, float turb, float temp,
                                float mse,  int anomaly_count,
                                bool  sensor_fault) {
    ContextResult r;

    // Push MSE into ring buffer
    mse_history[hist_idx] = mse;
    hist_idx = (hist_idx + 1) % TREND_WINDOW;
    if (hist_count < TREND_WINDOW) hist_count++;

    // ── PHYSICAL RULES & THRESHOLDS ──────────────────────────────────────────
    // Determine if the current cycle is completely clean and nominal
    bool is_current_nominal = (!sensor_fault) &&
                              (tds <= 250.0f) &&
                              (turb <= 200.0f) &&
                              (temp < 35.0f) &&
                              (mse <= ANOMALY_THRESHOLD);

    // Update safe streak counter: requires 3 consecutive nominal readings to clear
    if (is_current_nominal) {
        safe_streak++;
        if (safe_streak > 3) safe_streak = 3;
    } else {
        safe_streak = 0;
    }

    // Determine per-sensor spikes (used for classification details)
    float z_tds  = (tds  - SCALER_MEAN[0]) / SCALER_SCALE[0];
    float z_turb = (turb - SCALER_MEAN[1]) / SCALER_SCALE[1];
    float az_temp = fabsf((temp - SCALER_MEAN[2]) / SCALER_SCALE[2]);

    bool tds_f  = (z_tds  > 2.0f) || (tds > 250.0f);
    bool turb_f = (z_turb > 2.0f) || (turb > 200.0f);
    bool temp_f = (az_temp > 4.0f) || (temp >= 35.0f);
    uint8_t votes = (uint8_t)((tds_f ? 1 : 0) + (turb_f ? 1 : 0) + (temp_f ? 1 : 0));

    // Fill in basic detail fields
    r.votes = {tds_f, turb_f, temp_f, votes};
    snprintf(r.why_tds,     sizeof(r.why_tds),
             "TDS  [%s] %.0fppm",  (tds_f  ? "!!" : "OK"), tds);
    snprintf(r.why_turb,    sizeof(r.why_turb),
             "TURB [%s] %.0fNTU",  (turb_f ? "!!" : "OK"), turb);
    snprintf(r.why_temp,    sizeof(r.why_temp),
             "TEMP [%s] %.1fC",    (temp_f ? "!!" : "OK"), temp);

    if (safe_streak >= 3) {
        // ── SAFE STATE ────────────────────────────────────────────────────────
        r.confidence  = 0;
        r.alert_level = ALERT_NORMAL;
        r.is_anomaly  = false;
        snprintf(r.reason,      sizeof(r.reason),      "All parameters nominal");
        snprintf(r.why_summary, sizeof(r.why_summary), "Votes:0/3 | Conf: 0%%");
        return r;
    }

    // ── UNSAFE STATE ──────────────────────────────────────────────────────────
    r.confidence  = 100;
    r.alert_level = ALERT_CRITICAL;
    r.is_anomaly  = true;
    snprintf(r.why_summary, sizeof(r.why_summary), "Votes:%d/3 | Conf:100%%", votes);

    if (sensor_fault) {
        snprintf(r.reason, sizeof(r.reason), "Sensor hardware fault");
        // Highlight active sensor fault details
        if (tds > 1.4f || tds < 5.0f) snprintf(r.why_tds, sizeof(r.why_tds), "TDS  [ !! ] Fault");
        if (turb > 2000.0f || turb < 5.0f) snprintf(r.why_turb, sizeof(r.why_turb), "TURB [ !! ] Fault");
    } else if (tds_f && turb_f) {
        snprintf(r.reason, sizeof(r.reason), "Contamination detected");
    } else if (tds_f && !turb_f) {
        snprintf(r.reason, sizeof(r.reason), "Dissolved ion spike");
    } else if (turb_f && !tds_f) {
        snprintf(r.reason, sizeof(r.reason), "Turbidity anomaly only");
    } else if (temp_f) {
        snprintf(r.reason, sizeof(r.reason), "Temperature deviation");
    } else if (mse > ANOMALY_THRESHOLD) {
        snprintf(r.reason, sizeof(r.reason), "Anomalous signature");
    } else {
        // Current reading is nominal, but we are holding Unsafe during recovery streak
        snprintf(r.reason, sizeof(r.reason), "System stabilizing...");
    }

    return r;
}
