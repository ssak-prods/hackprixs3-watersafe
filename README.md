# 💧 WaterSafe V2: The Smart Water Quality Oracle

## 🌍 The Problem
Clean drinking water is a human right, but industrial spills and contamination often go unnoticed until it's too late. Traditional lab testing is slow and expensive, while cheap electronic water sensors can't directly detect invisible toxins like heavy metals or pesticides. How do we protect communities in real-time without spending thousands of dollars on industrial-grade probes?

## Problem Deep-Dive:
- 30M+ Indians fall sick annually from contaminated tap water
- 11 deaths in 10 days (Indore, Jan 2026) — sewage in pipeline, detected too late
- Detection delay: 2-3 days — contamination spreads faster every second
- 26 cities across 22 states reported sewage-contaminated water outbreaks (2025 – 2026)
- Existing water testing systems are expensive, or reactive and delayed
- Existing solutions are not friendly for the rural population 
- SOURCES: https://www.downtoearth.org.in/water/unsafe-water-year-round-over-5500-fell-sick-34-died-due-to-contaminated-tap-water-across-india-in-last-12-months | https://delhigreens.com/2019/03/22/an-infographic-on-the-drinking-water-challenge-in-india/ | https://www.ndtv.com/cities/11-deaths-in-10-days-in-indore-from-contaminated-water-3513211 


## 🚀 The Solution
WaterSafe V2 is an **ultra-affordable ($25) IoT early-warning system** that uses Edge AI to protect water supplies. 

Instead of trying to identify specific invisible chemicals (which is impossible with cheap sensors), WaterSafe V2 learns the exact "fingerprint" of safe, normal water. If *anything* changes the water's electrochemical signature—such as a factory illegally dumping waste upstream—the AI instantly flags the water as anomalous. It also finds out what is specifically wrong with the water quality in terms of properties and possible causes.

When contamination is detected, the system immediately:
1. **Displays visual alerts** on a local OLED screen.
2. **Updates a live React Web Dashboard** for remote monitoring.
3. **Dispatches automated SMS warnings** via Twilio in multiple local languages (English, Hindi, Telugu) to community health officers.

---

## 🧠 How It Works (Under the Hood)
WaterSafe V2 smoothly bridges the gap between low-cost hardware and high-end chemistry by shifting the complexity from physical sensors to software.

### 1. The TinyML Autoencoder
We deploy a Neural Network Autoencoder directly onto an ESP32 microcontroller. The network is trained exclusively on baseline data (`[TDS, Turbidity, Temperature]`) from safe tap water.
* **The Math:** The model compresses the sensor data into a "Latent Space of Potability" and attempts to reconstruct it. If toxic runoff enters the water supply, it alters the physical properties in subtle, nonlinear ways. The autoencoder fails to reconstruct this foreign signature, generating a high **Mean Squared Error (MSE)**.

### 2. The Context-Aware Rule Engine
Pure AI is notoriously prone to false alarms (for example, the AI might flag highly purified RO water as an "anomaly" simply because it has never seen water *that* clean). To fix this, we wrote a deterministic **C++ Context Engine** that acts as a sanity check:
* It analyzes the Neural Network's MSE alongside individual sensor Z-scores.
* It applies physics-based logic: *If TDS spikes but Turbidity is flat, it's a dissolved ion spike. If both drop below the baseline, the water is just purer than normal.*
* It calculates a final Confidence Score (0-100%) to determine the severity of the alert.

### 3. The 4-State Alert Machine
To prevent spamming users with SMS alerts due to temporary sensor bubbles, the Node.js backend manages a rigid 4-state machine (`Safe` → `Warn Pending` → `Alarming` → `Clear Pending`). It requires **3 consecutive anomalous readings** to trigger an SMS, and **3 consecutive safe readings** to send an "All Clear".

---

## 🛠️ Hardware Stack
* **Compute:** ESP32-WROOM-32
* **Sensors:** DFRobot TDS, DFRobot Turbidity, DS18B20 Temperature
* **ADC:** ADS1115 (16-bit I2C for high-resolution analog reads)
* **UI:** 0.96" OLED Display

---

## 🚀 Quick Start Guide

### 1. Flash the ESP32 Firmware
The embedded firmware is built using PlatformIO (C++).
```bash
cd firmware
pio run --target upload
```

### 2. Start the Backend & Web Dashboard
The Node.js server ingests ESP32 data, serves the React dashboard, and handles Twilio SMS.
```bash
cd web-dashboard
npm install
cp .env.example .env  # Add your Twilio credentials here
npm run dev
```

### 3. Train Your Own Baseline
If you are deploying WaterSafe V2 to a new region, you can retrain the autoencoder on the local water baseline using the provided Python scripts.
```bash
cd ml
pip install -r requirements.txt
python train_autoencoder.py
```

---
*Built to bring affordable, robust, and intelligent water safety monitoring to the communities that need it most.*
