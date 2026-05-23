#include "context_layer.h"
#include "nn_weights.h"   // SCALER_MEAN, SCALER_SCALE, ANOMALY_THRESHOLD
#include <math.h>
#include <stdio.h>

// ─── MSE RING BUFFER (Trend Detection) ───────────────────────────────────────
#define TREND_WINDOW 5
static float  mse_history[TREND_WINDOW];
static uint8_t hist_idx   = 0;
static uint8_t hist_count = 0;

void context_setup() {
    for (int i = 0; i < TREND_WINDOW; i++) mse_history[i] = 0.0f;
    hist_idx   = 0;
    hist_count = 0;
}

// ─── SIGNAL 3: Trend Factor ───────────────────────────────────────────────────
// Compares average of most recent readings vs older readings.
// Rising MSE → amplifies confidence (getting worse = acute event).
// Falling MSE → reduces confidence (sensor clearing or artifact).
static float compute_trend_factor() {
    if (hist_count < 3) return 1.0f;

    int n    = (hist_count < TREND_WINDOW) ? hist_count : TREND_WINDOW;
    int half = n / 2;
    if (half == 0) return 1.0f;

    float recent = 0.0f, older = 0.0f;
    for (int i = 0; i < half; i++) {
        int idx = ((int)hist_idx - 1 - i + TREND_WINDOW) % TREND_WINDOW;
        recent += mse_history[idx];
    }
    for (int i = half; i < n; i++) {
        int idx = ((int)hist_idx - 1 - i + TREND_WINDOW) % TREND_WINDOW;
        older += mse_history[idx];
    }
    recent /= (float)half;
    older  /= (float)(n - half);

    float slope = recent - older;
    if (slope >  0.5f) return 1.5f;   // MSE rising  → amplify confidence
    if (slope < -0.3f) return 0.6f;   // MSE falling → reduce confidence
    return 1.0f;                        // Stable
}

// ─── MAIN EVALUATE ───────────────────────────────────────────────────────────
ContextResult context_evaluate(float tds, float turb, float temp,
                                float mse,  int anomaly_count) {
    ContextResult r;

    // Push MSE into ring buffer
    mse_history[hist_idx] = mse;
    hist_idx = (hist_idx + 1) % TREND_WINDOW;
    if (hist_count < TREND_WINDOW) hist_count++;

    // ── NORMAL SHORT-CIRCUIT ──────────────────────────────────────────────────
    if (mse <= ANOMALY_THRESHOLD) {
        r.confidence  = 0;
        r.alert_level = ALERT_NORMAL;
        r.is_anomaly  = false;
        r.votes       = {false, false, false, 0};
        snprintf(r.reason,      sizeof(r.reason),      "All parameters nominal");
        snprintf(r.why_tds,     sizeof(r.why_tds),     "TDS  [ -- ] %.0fppm",   tds);
        snprintf(r.why_turb,    sizeof(r.why_turb),    "TURB [ -- ] %.0fNTU",   turb);
        snprintf(r.why_temp,    sizeof(r.why_temp),    "TEMP [ -- ] %.1fC",     temp);
        snprintf(r.why_summary, sizeof(r.why_summary), "Votes:0/3 | Conf: 0%%");
        return r;
    }

    // ── SIGNAL 1: MSE Severity (0–1) ─────────────────────────────────────────
    float severity = (mse / ANOMALY_THRESHOLD - 1.0f) / 3.0f;
    if (severity > 1.0f) severity = 1.0f;

    // ── SIGNAL 2: Per-Sensor Z-Score Vote ────────────────────────────────────
    float az_tds  = fabsf((tds  - SCALER_MEAN[0]) / SCALER_SCALE[0]);
    float az_turb = fabsf((turb - SCALER_MEAN[1]) / SCALER_SCALE[1]);
    float az_temp = fabsf((temp - SCALER_MEAN[2]) / SCALER_SCALE[2]);

    bool tds_f  = (az_tds  > 2.0f);
    bool turb_f = (az_turb > 2.0f);
    bool temp_f = (az_temp > 2.0f);
    uint8_t votes = (uint8_t)((tds_f ? 1 : 0) + (turb_f ? 1 : 0) + (temp_f ? 1 : 0));

    r.votes = {tds_f, turb_f, temp_f, votes};
    float vote_weight = votes / 3.0f;

    // ── SIGNAL 3: MSE Trend ───────────────────────────────────────────────────
    float trend_factor = compute_trend_factor();

    // ── SIGNAL 4: Duration ───────────────────────────────────────────────────
    float duration_factor;
    if      (anomaly_count < 3)  duration_factor = 0.70f;
    else if (anomaly_count < 10) duration_factor = 1.00f;
    else                          duration_factor = 1.20f;

    // ── SIGNAL 5: Pattern Coherence ──────────────────────────────────────────
    // Physics-based rules: which combinations make contamination more/less likely
    float coherence = 0.0f;
    if      (tds_f && turb_f && temp_f) coherence = +0.20f; // All 3 = very credible
    else if (tds_f && turb_f)           coherence = +0.15f; // Classic contamination
    else if (tds_f && !turb_f)          coherence = +0.10f; // Dissolved ions (nitrates/metals)
    else if (turb_f && !tds_f)          coherence = -0.15f; // Turbidity only → sensor fouling?
    else if (temp_f && !tds_f && !turb_f) coherence = -0.10f; // Temp only → environmental

    // Location-based prior adjustments
#if DEVICE_LOCATION == LOCATION_INDUSTRIAL
    if (tds_f) coherence += 0.10f;            // Industrial → ion spikes expected/credible
#elif DEVICE_LOCATION == LOCATION_FARM
    if (tds_f && !turb_f) coherence += 0.08f; // Farm → nitrate runoff (TDS without turbidity)
#elif DEVICE_LOCATION == LOCATION_URBAN
    if (turb_f && tds_f) coherence += 0.05f;  // Urban → mixed contamination common
#endif

    // ── FINAL SCORE ───────────────────────────────────────────────────────────
    float conf = (severity * 0.40f + vote_weight * 0.35f + 0.25f)
                 * trend_factor * duration_factor;
    conf += coherence;
    if (conf < 0.0f) conf = 0.0f;
    if (conf > 1.0f) conf = 1.0f;

    r.confidence = (uint8_t)(conf * 100.0f);
    r.is_anomaly = (r.confidence >= 30) && (anomaly_count >= 3);

    // ── ALERT LEVEL ───────────────────────────────────────────────────────────
    if      (r.confidence < 30) r.alert_level = ALERT_UNCERTAIN;
    else if (r.confidence < 60) r.alert_level = ALERT_CAUTION;
    else if (r.confidence < 80) r.alert_level = ALERT_WARNING;
    else                         r.alert_level = ALERT_CRITICAL;

    // ── REASON STRING (status screen) ────────────────────────────────────────
    if (r.alert_level == ALERT_UNCERTAIN) {
        snprintf(r.reason, sizeof(r.reason), "Possible sensor artifact");
    } else if (tds_f && turb_f) {
        snprintf(r.reason, sizeof(r.reason), "Contamination detected");
    } else if (tds_f && !turb_f) {
        snprintf(r.reason, sizeof(r.reason), "Dissolved ion spike");
    } else if (turb_f && !tds_f) {
        snprintf(r.reason, sizeof(r.reason), "Turbidity anomaly only");
    } else if (temp_f) {
        snprintf(r.reason, sizeof(r.reason), "Temperature deviation");
    } else {
        snprintf(r.reason, sizeof(r.reason), "Anomalous signature");
    }

    // ── WHY DETAIL STRINGS (diagnosis screen) ────────────────────────────────
    snprintf(r.why_tds,     sizeof(r.why_tds),
             "TDS  [%s] %.0fppm",  (tds_f  ? "!!" : "OK"), tds);
    snprintf(r.why_turb,    sizeof(r.why_turb),
             "TURB [%s] %.0fNTU",  (turb_f ? "!!" : "OK"), turb);
    snprintf(r.why_temp,    sizeof(r.why_temp),
             "TEMP [%s] %.1fC",    (temp_f ? "!!" : "OK"), temp);
    snprintf(r.why_summary, sizeof(r.why_summary),
             "Votes:%d/3 | Conf:%d%%", votes, r.confidence);

    return r;
}
