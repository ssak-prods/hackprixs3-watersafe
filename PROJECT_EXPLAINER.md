# WaterSafe V2: Technical Architecture & Deep Dive

This document serves as the master explainer for the software architecture, machine learning models, and logic rules powering WaterSafe V2. 

## 1. The Machine Learning Strategy: Anomaly Detection via Autoencoder

Low-cost sensors (like DFRobot TDS and Turbidity sensors) are excellent at tracking generalized water properties, but they cannot directly measure specific toxins like Arsenic, Lead, or complex Pesticides. 

To bridge this gap, WaterSafe V2 treats **water contamination as a statistical outlier**.

### How it Works
We train a **Bottleneck Autoencoder** exclusively on data collected from "Normal, Safe Water" (the baseline). 
1. **Input:** A 3-dimensional vector `[TDS, Turbidity, Temperature]`.
2. **Encoding:** The network compresses this vector into a smaller 2-dimensional "latent space".
3. **Decoding:** The network attempts to reconstruct the original 3D vector from the 2D latent representation.
4. **MSE Evaluation:** We calculate the Mean Squared Error (MSE) between the input and the reconstructed output.

If you feed the model normal water, it knows how to reconstruct it perfectly (Low MSE). If you introduce a contaminant—even one that shifts the TDS or Turbidity in a subtle, nonlinear way—the model fails to reconstruct it, resulting in a **High MSE**. 

When the MSE crosses a pre-calibrated threshold (`ANOMALY_THRESHOLD`), the system flags the water as anomalous.

---

## 2. The Context-Aware Rule Engine

While the Autoencoder is highly sensitive, it can be *too* sensitive. For example, if you calibrate the model on tap water, and then test it in highly purified RO (Reverse Osmosis) water, the autoencoder will flag it as a massive anomaly because it has never seen water with such a low TDS.

To prevent false alarms and add human-like reasoning, the ESP32 passes the Autoencoder's MSE to a **C++ Context Engine** (`context_layer.cpp`).

### The 5 Signals of Context
The Context Engine evaluates 5 distinct signals before issuing an alert:
1. **MSE Severity:** How badly did the autoencoder fail to reconstruct the signal? (Scale of 0.0 to 1.0).
2. **Per-Sensor Z-Score Votes:** How many individual sensors have spiked beyond normal statistical bounds? (e.g., TDS > 2.0σ).
    * *Note: The engine strictly looks for positive spikes. A massive drop in TDS (indicating cleaner water) does not trigger a vote.*
3. **Trend Factor:** Is the MSE rising rapidly over the last 5 readings, or is it stabilizing?
4. **Duration/Persistence:** Has the anomaly persisted for 3, 5, or 10 readings?
5. **Pattern Coherence (Physics Rules):** 
    - TDS + Turbidity Spike = High Confidence (Classic contamination).
    - TDS Spike only = Medium Confidence (Dissolved ions/metals).
    - Turbidity Spike only = Low Confidence (Could just be sensor fouling or a bubble).
    - Pure Water Override: If TDS and Turbidity are *lower* than the training baseline, the MSE is ignored and confidence is forced to 0% (Clearer water is safer water).

The engine mathematically combines these signals into a final **Confidence Percentage (0-100%)** and an **Alert Level (0-4)**.

---

## 3. The 4-State SMS Alerting System

Alerts are pushed from the ESP32 to a Node.js backend (`server.js` and `sms.js`), which manages notifications via Twilio.

To prevent "alarm fatigue" (spamming users with texts every 3 seconds due to sensor noise), the backend utilizes a strict **4-State State Machine**:

1. **SAFE (Green):** Normal state. No actions taken.
2. **WARN_PENDING (Yellow):** The system has received 1 or 2 anomalous payloads. It stays quiet and waits. If it was just a temporary bubble passing the sensor, it drops back to SAFE.
3. **ALARMING (Red):** The system has received **3 consecutive anomalous payloads**. It dispatches a Trilingual (English, Hindi, Telugu) Danger SMS immediately.
    * *Debounce:* If the water remains unsafe, it will only re-alert users once every 30 minutes.
4. **CLEAR_PENDING (Yellow):** The water is starting to read safe again. The system waits for **3 consecutive safe payloads** to ensure the contamination is truly flushed out before returning to SAFE and dispatching the "All Clear" SMS.

## 4. Hardware Fail-Safes
- **Voltage Rate-of-Change Guard:** If the TDS or Turbidity sensor voltage jumps by more than 40% in a single 3-second window, the ESP32 flags it as a `SENSOR_FAULT` (loose wire, sensor pulled out of water) rather than a contamination event.
- **Offline Resiliency:** If Wi-Fi goes down, the ESP32 continues evaluating water locally and updating the OLED screens with real-time verdicts.
