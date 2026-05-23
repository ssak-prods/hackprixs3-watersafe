#ifndef ML_INFERENCE_H
#define ML_INFERENCE_H

#include <Arduino.h>

// Initialize the ML subsystem
bool ml_setup();

// Run a full forward pass and check if the current frame is an anomaly.
// We pass the raw values directly.
bool ml_check_anomaly(float temp, float tds, float turb);

// Get the latest MSE
float ml_get_last_error();

// Get the current consecutive alert counter
int ml_get_anomaly_count();

#endif
