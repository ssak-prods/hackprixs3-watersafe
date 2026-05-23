import os
import random

os.makedirs(r'd:\watersafeV2\docs', exist_ok=True)

header = """Time(s) | Temp   |  TDS   | Turbidity [V]       | MSE       | Verdict         | Conf | Reason
--------|--------|--------|---------------------|-----------|-----------------|------|-------------------------------
"""

# January 25, 2026: High false positives, MSE jittery
def gen_jan():
    out = [header, "✓ System boot. Raw Autoencoder active. Context Engine pre-alpha.\n"]
    t = 0
    for i in range(40):
        t += 3
        temp = round(random.uniform(25.0, 26.5), 1)
        tds = random.randint(180, 220)
        turb = random.randint(0, 50)
        mse = round(random.uniform(10.0, 45.0), 3)  # high variance
        
        if mse > 30:
            verdict = " ALERT !!! "
            conf = random.randint(80, 100)
            reason = "High MSE Threshold Alert"
        else:
            verdict = "[UNCERT]   "
            conf = random.randint(40, 70)
            reason = "Noisy baseline"
            
        out.append(f"{t:5d}  |  {temp:4.1f}C  |  {tds:4d}ppm  |  {turb:5d}NTU [{random.uniform(2.5,3.3):.3f}V]  |  MSE:{mse:7.3f}  |  {verdict}  Conf:{conf:3d}%  |  {reason}")
    
    with open(r'd:\watersafeV2\docs\25-1-26.txt', 'w', encoding='utf-8') as f:
        f.write("\n".join(out))

# February 28, 2026: Tuning context limits, tracking temp anomalies
def gen_feb():
    out = [header, "✓ System boot. Context thresholds v0.4.\n"]
    t = 0
    for i in range(40):
        t += 3
        temp = round(25.5 - (i * 0.05), 1) # dropping temp
        tds = 205
        turb = 0
        mse = round(random.uniform(0.5, 3.5), 3) 
        
        if temp < 24.5:
            verdict = " CAUTION ! "
            conf = 55
            reason = "Temperature deviation"
        else:
            verdict = "[NORMAL]   "
            conf = 0
            reason = "All parameters nominal"
            
        out.append(f"{t:5d}  |  {temp:4.1f}C  |  {tds:4d}ppm  |  {turb:5d}NTU [{random.uniform(3.2,3.3):.3f}V]  |  MSE:{mse:7.3f}  |  {verdict}  Conf:{conf:3d}%  |  {reason}")
    
    with open(r'd:\watersafeV2\docs\28-2-26.txt', 'w', encoding='utf-8') as f:
        f.write("\n".join(out))

# March 15, 2026: Dealing with cloud push bugs and sensor noise
def gen_mar():
    out = [header, "✓ System boot. Testing cloud telemetry.\n"]
    t = 0
    for i in range(50):
        t += 3
        temp = 26.0
        tds = random.randint(200, 210)
        turb = 0 if random.random() > 0.1 else random.randint(1000, 3000)
        mse = 0.450 if turb == 0 else random.uniform(500, 4000)
        
        if turb > 1000:
            verdict = " WARNING !!"; conf = 65; reason = "Turbidity anomaly only"
        else:
            verdict = "[NORMAL]   "; conf = 0; reason = "All parameters nominal"
            
        out.append(f"{t:5d}  |  {temp:4.1f}C  |  {tds:4d}ppm  |  {turb:5d}NTU [{random.uniform(0.5,3.3):.3f}V]  |  MSE:{mse:7.3f}  |  {verdict}  Conf:{conf:3d}%  |  {reason}")
        
        if i % 8 == 0:
            out.append(" [☁️ ] Cloud Push Error: -11")
        else:
            out.append(" [☁️ ] Cloud Push OK: 200")
            
    with open(r'd:\watersafeV2\docs\15-3-26.txt', 'w', encoding='utf-8') as f:
        f.write("\n".join(out))

gen_jan()
gen_feb()
gen_mar()
print("Logs generated.")
