---
title: WaterSafe V2 TinyML Hub
emoji: 💧
colorFrom: blue
colorTo: green
sdk: gradio
sdk_version: 5.16.0
python_version: 3.11

app_file: app.py
pinned: false
license: mit
---

# WaterSafe V2: Research Deployment
This Space hosts the interactive inference engine for WaterSafe V2, an IoT-ready TinyML system for research-grade water quality monitoring.

### Technical Focus
The core of WaterSafe V2 is an unsupervised anomaly detection engine. By leveraging a Symmetric Autoencoder, the system learns the multivariate normal state of local water sources. Contamination events are quantified via **Reconstruction Error (MSE)**, allowing for high-sensitivity detection of Out-of-Distribution (OOD) events even without specific chemical sensors.

**Future Roadmap**: Expansion into integrated chemical biosensing for targeted heavy-metal quantification (Arsenic/Lead) to provide specific risk scoring alongside general anomaly alerts.
