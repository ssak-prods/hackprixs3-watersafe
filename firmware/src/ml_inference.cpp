#include "ml_inference.h"
#include "nn_weights.h"
#include <cmath>

// ─── INPUT DIM ───────────────────────────────────────────────────────────────
// Model retrained with 3 real hardware sensors: TDS, Turbidity, Temperature.
// pH was removed both from hardware AND model — no more dummy 0.0f injection!
#define NN_INPUT_DIM  3
#define NN_H1_DIM     8
#define NN_BOTTLE_DIM 2
// ─────────────────────────────────────────────────────────────────────────────

float last_reconstruction_error = 0.0f;
int consecutive_anomalies = 0;
int clean_streak = 0;  // consecutive clean readings counter
const int ANOMALY_PERSISTENCE = 3; // Must flag 3 readings in a row before alarming

bool ml_setup() {
    consecutive_anomalies = 0;
    clean_streak = 0;
    last_reconstruction_error = 0.0f;
    return true;
}

// Raw Matrix Multiplication: out[i] = bias[i] + sum_j(in[j] * W[i*in_dim + j])
static void linear(const float* in, const float* W, const float* b,
                   float* out, int in_dim, int out_dim) {
    for (int i = 0; i < out_dim; i++) {
        float sum = b[i];
        for (int j = 0; j < in_dim; j++) {
            sum += in[j] * W[i * in_dim + j];
        }
        out[i] = sum;
    }
}

// In-place ReLU
static void relu(float* v, int len) {
    for (int i = 0; i < len; i++) {
        if (v[i] < 0.0f) v[i] = 0.0f;
    }
}

bool ml_check_anomaly(float temp, float tds, float turb) {
    // ── 1. Z-Score Normalize against fitted scaler ──────────────────────────
    // Input order matches training: [TDS, Turbidity, Temp]
    float input[NN_INPUT_DIM];
    input[0] = (tds  - SCALER_MEAN[0]) / SCALER_SCALE[0];
    input[1] = (turb - SCALER_MEAN[1]) / SCALER_SCALE[1];
    input[2] = (temp - SCALER_MEAN[2]) / SCALER_SCALE[2];

    // ── 2. Encoder [3 → 8 → 2] ──────────────────────────────────────────────
    float h1[NN_H1_DIM];
    linear(input, ENC_L1_W, ENC_L1_B, h1, NN_INPUT_DIM, NN_H1_DIM);
    relu(h1, NN_H1_DIM);

    float bottle[NN_BOTTLE_DIM];
    linear(h1, ENC_L2_W, ENC_L2_B, bottle, NN_H1_DIM, NN_BOTTLE_DIM);

    // ── 3. Decoder [2 → 8 → 3] ──────────────────────────────────────────────
    float h2[NN_H1_DIM];
    linear(bottle, DEC_L1_W, DEC_L1_B, h2, NN_BOTTLE_DIM, NN_H1_DIM);
    relu(h2, NN_H1_DIM);

    float output[NN_INPUT_DIM];
    linear(h2, DEC_L2_W, DEC_L2_B, output, NN_H1_DIM, NN_INPUT_DIM);

    // ── 4. Reconstruction MSE ────────────────────────────────────────────────
    float mse = 0.0f;
    for (int i = 0; i < NN_INPUT_DIM; i++) {
        float diff = input[i] - output[i];
        mse += diff * diff;
    }
    mse /= (float)NN_INPUT_DIM;
    last_reconstruction_error = mse;

    // ── 5. Persistence Filter ────────────────────────────────────────────────
    // Anomaly: requires 3 consecutive HIGH readings before triggering alarm.
    // Clear:   requires only 2 consecutive LOW readings to immediately reset.
    // This prevents both hair-trigger false positives AND sticky latch behavior.
    if (mse > ANOMALY_THRESHOLD) {
        clean_streak = 0;
        consecutive_anomalies++;
    } else {
        clean_streak++;
        if (clean_streak >= 2) {
            // 2 clean readings in a row → immediate full reset
            consecutive_anomalies = 0;
            clean_streak = 0;
        }
    }

    return (consecutive_anomalies >= ANOMALY_PERSISTENCE);
}

float ml_get_last_error() {
    return last_reconstruction_error;
}

int ml_get_anomaly_count() {
    return consecutive_anomalies;
}
