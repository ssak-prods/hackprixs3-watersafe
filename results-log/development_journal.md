# WaterSafe V2: Development Journal

### January 25, 2026
**Changes Done**:
Got ESP32 and ADS1115 connected. Booted the raw Autoencoder model locally, raw MSE numbers are showing and tripping absolute alert thresholds. Results need improvement. 
**Performance Changes**:
False positives occuring. The MSE changes wildly between 10.0 and 45.0 even when the water looks relatively clean visually. Every time it hits >30, it panics and fires a 100% confidence alert. Need to rebuild the rule engine so it stops screaming at standard noise.
**Raw Terminal Data**: 
`d:\watersafeV2\docs\25-1-26.txt`

---

### February 28, 2026
**Changes Done**:
Pushed v0.4 of the Context layer. Added hardcoded tracking so that single-sensor variance gets evaluated before a full `ALERT` is thrown.
**Performance Changes**:
Much better stability. Managed to suppress the false alarms completely on pure noise. Tested it with dropping temperature (slow drift from 25.5C to 24.5C). The newly implemented bounds caught the temperature tracking perfectly; instead of triggering the alarm bell, it correctly tagged it as `CAUTION !` at just 55% confidence for a "Temperature deviation". It understands context now.
**Raw Terminal Data**:
`d:\watersafeV2\docs\28-2-26.txt`

---

### March 15, 2026
**Changes Done**:
Trying to hook the offline hardware logic into the newly built Web Dashboard using Express handling. Wrote `pushToDashboard()` using `HTTPClient`. Setup test runs on the Wi-Fi.
**Performance Changes**:
The machine learning is holding a perfect flat 0% confidence `[NORMAL]` state when the water is perfectly clear. I artificially induced some random turbidity spikes above 1000 NTU; it caught every single one and flagged them as `WARNING !!` at exactly 65% since the TDS remained nominal. 
However, I'm noting serious latency bottlenecks. Getting recurring `-11` error codes from the ESP32 `pushToDashboard()` function. The Edge AI catches the issue immediately, but the cloud misses the packet if Wi-Fi drops momentarily. Have to consider local packet caching.
**Raw Terminal Data**:
`d:\watersafeV2\docs\15-3-26.txt`

---

### April 9, 2026
**Changes Done**:
Complete overhaul finished. The Edge AI is fully operational with multi-variate analysis. Fleshed out the categorization to include "Contamination detected", "Possible sensor artifact", and general deviations. Validated the dashboard tracking.
**Performance Changes**:
Virtually perfect stabilization baseline (MSE ~0.40). When a combined anomaly was triggered (Turbidity at 317 + MSE spike to 34), it leaped from 0% straight to 100% `ALERT !!!` accurately. It is now properly capable of distinguishing between minor, single-sensor drifts and massive combined chemical deviations without relying strictly on static "IF" thresholds.
**Raw Terminal Data**:
`d:\watersafeV2\docs\9-4-26.txt`

---

### Conclusion
Over the past four months, the system has successfully evolved from a highly reactive, false-positive prone Autoencoder script into a mathematically stable Edge AI appliance. The integration of the physics-based Context Layer effectively translates raw Machine Learning error states into reliable, human-readable diagnoses (e.g. distinguishing a mud-caked sensor from toxic pollution). While network packet-drop remains an intermittent hurdle, the core local-reasoning algorithm consistently achieves a 0% false-positive rate during stable environments while maintaining 100% detection rate on multi-variate contamination signatures.

### Developer Reflection
web dashboard working mostly, feature addition gives downtime. quality monitors are up and fine. mostly tds and turbidity spikes
