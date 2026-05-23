"""
WaterSafe V2 - Complete Retrain Pipeline
=========================================
Generates a realistic "clean water" dataset based on:
  - WHO Guideline Value: TDS < 600 mg/L (safe), ideally 50-300 for good tap water
  - EPA Standard: Turbidity < 4 NTU (potable), < 1 NTU (excellent)
  - DFRobot TDS Sensor Range: 0-1000 ppm (our sensor's actual output range)
  - DS18B20 Temp Range: tap water is typically 15-30°C
  - DFRobot Turbidity: 0 NTU (crystal clear) to ~3000 NTU (very murky)

Normal water profile (what sensor sees in clean tap/drinking water):
  - TDS:  50 - 350 ppm     (mean ~180)
  - Turb: 0  - 4   NTU     (mean ~1.5)
  - Temp: 18 - 30  °C      (mean ~24)

This correctly replaces the Kaggle potability dataset which had:
  - TDS values of 15,000-50,000 (completely wrong scale!)
  - No temperature column
  - Pre-normalized (Z-score) values stored
"""

import os
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
import joblib

# ─── CONFIG ──────────────────────────────────────────────────────────────────
N_NORMAL    = 20000   # training samples (clean water)
N_ANOMALY   = 2000    # validation samples (contaminated water)
EPOCHS      = 500
BATCH_SIZE  = 256
LR          = 1e-3
THRESHOLD_PERCENTILE = 97  # More conservative: 97th percentile to reduce false positives

MODEL_PATH  = "ml/autoencoder.pth"
SCALER_PATH = "ml/models/scaler.save"
STATS_PATH  = "ml/model_stats.txt"
NORMAL_CSV  = "ml/dataset_normal_hardware.csv"
# ─────────────────────────────────────────────────────────────────────────────

def generate_clean_water(n):
    """
    Calibrated to match ACTUAL DFRobot sensor readings on clear tap water.
    
    Observed real readings (India tap water, ~28°C):
      - TDS:  ~140-160 ppm (consistent, low variance)
      - Turb: 0-80 NTU  (after TURB_V_CLEAR=2.90 calibration fix)
      - Temp: 27-29°C   (room-temp tap water in India)
    
    We add realistic noise and drift to improve model robustness.
    """
    rng = np.random.default_rng(42)

    # Temperature: Indian tap water at room temp (~27-29°C)
    temp = rng.normal(loc=27.8, scale=0.7, size=n)
    temp = np.clip(temp, 22.0, 33.0)

    # TDS: Your tap water ~140 ppm, typical range 100-300 ppm for potable
    tds_base = rng.normal(loc=155.0, scale=30.0, size=n)
    tds = tds_base + 0.5 * (temp - 27.8)   # small temp correlation
    tds = np.clip(tds, 60.0, 350.0)

    # Turbidity: After calibration fix (TURB_V_CLEAR=2.90),
    # clear water will read 0-80 NTU. Small exponential noise (bubbles, movement).
    turb = rng.exponential(scale=15.0, size=n)
    turb = np.clip(turb, 0.0, 100.0)

    return np.column_stack([tds, turb, temp])

def generate_contaminated_water(n):
    """
    Simulate contaminated/unusual water - these are the anomalies.
    Mix of different failure modes.
    """
    rng = np.random.default_rng(123)
    samples = []

    # High TDS (salty, industrial)
    n1 = n // 4
    tds = rng.uniform(600, 1000, n1)
    turb = rng.uniform(0, 3, n1)
    temp = rng.normal(24, 3, n1)
    samples.append(np.column_stack([tds, turb, temp]))

    # High Turbidity (muddy, sediment)
    n2 = n // 4
    tds = rng.uniform(50, 300, n2)
    turb = rng.uniform(8, 3000, n2)
    temp = rng.normal(24, 3, n2)
    samples.append(np.column_stack([tds, turb, temp]))

    # Temperature extremes (industrial discharge, hot springs)
    n3 = n // 4
    tds = rng.uniform(50, 400, n3)
    turb = rng.uniform(0, 5, n3)
    temp = rng.uniform(38, 55, n3)   # way above normal tap water range
    samples.append(np.column_stack([tds, turb, temp]))

    # Combined contamination
    n4 = n - (n1 + n2 + n3)
    tds = rng.uniform(500, 900, n4)
    turb = rng.uniform(20, 500, n4)
    temp = rng.uniform(35, 45, n4)
    samples.append(np.column_stack([tds, turb, temp]))

    return np.vstack(samples)

# ─── MODEL ───────────────────────────────────────────────────────────────────
INPUT_DIM     = 3  # TDS, Turbidity, Temp (no pH!)
HIDDEN_DIM    = 8
BOTTLENECK    = 2

class WaterAutoencoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(INPUT_DIM, HIDDEN_DIM),
            nn.ReLU(),
            nn.Linear(HIDDEN_DIM, BOTTLENECK)
        )
        self.decoder = nn.Sequential(
            nn.Linear(BOTTLENECK, HIDDEN_DIM),
            nn.ReLU(),
            nn.Linear(HIDDEN_DIM, INPUT_DIM)
        )
    def forward(self, x):
        return self.decoder(self.encoder(x))
# ─────────────────────────────────────────────────────────────────────────────

def run():
    print("=" * 60)
    print("  WaterSafe V2 - Hardware-Calibrated Retrain Pipeline")
    print("=" * 60)

    # 1. Generate Data
    print("\n[1/5] Generating realistic sensor dataset...")
    X_normal    = generate_clean_water(N_NORMAL)
    X_anomaly   = generate_contaminated_water(N_ANOMALY)
    print(f"  Normal samples:     {len(X_normal):,}")
    print(f"  Anomaly samples:    {len(X_anomaly):,}")
    print(f"  Normal TDS range:   {X_normal[:,0].min():.1f} - {X_normal[:,0].max():.1f} ppm")
    print(f"  Normal Turb range:  {X_normal[:,1].min():.3f} - {X_normal[:,1].max():.3f} NTU")
    print(f"  Normal Temp range:  {X_normal[:,2].min():.1f} - {X_normal[:,2].max():.1f} °C")

    # 2. Fit Scaler on NORMAL data only
    print("\n[2/5] Fitting StandardScaler on normal water ranges...")
    scaler = StandardScaler()
    X_normal_scaled = scaler.fit_transform(X_normal)
    X_anomaly_scaled = scaler.transform(X_anomaly)

    print(f"  Fitted means  (TDS, Turb, Temp): {scaler.mean_}")
    print(f"  Fitted scales (TDS, Turb, Temp): {scaler.scale_}")

    os.makedirs("ml/models", exist_ok=True)
    joblib.dump(scaler, SCALER_PATH)
    print(f"  Scaler saved -> {SCALER_PATH}")

    # Save normal CSV (raw values, not scaled - for reference)
    df_normal = pd.DataFrame(X_normal, columns=["tds", "turbidity", "temp"])
    df_normal.to_csv(NORMAL_CSV, index=False)
    print(f"  Normal dataset saved -> {NORMAL_CSV}")

    # 3. Train
    print("\n[3/5] Training Autoencoder...")
    tensor_data = torch.tensor(X_normal_scaled, dtype=torch.float32)
    loader = DataLoader(TensorDataset(tensor_data), batch_size=BATCH_SIZE, shuffle=True)

    model = WaterAutoencoder()
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=LR)

    model.train()
    for epoch in range(EPOCHS):
        total_loss = 0
        for (batch,) in loader:
            optimizer.zero_grad()
            out = model(batch)
            loss = criterion(out, batch)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        if (epoch + 1) % 50 == 0:
            print(f"  Epoch [{epoch+1:4d}/{EPOCHS}]  Loss: {total_loss/len(loader):.6f}")

    # 4. Calculate Threshold
    print("\n[4/5] Calculating anomaly threshold...")
    model.eval()
    with torch.no_grad():
        recon_normal = model(tensor_data)
        mse_normal = torch.mean((tensor_data - recon_normal) ** 2, dim=1).numpy()

        tensor_anomaly = torch.tensor(X_anomaly_scaled, dtype=torch.float32)
        recon_anomaly = model(tensor_anomaly)
        mse_anomaly = torch.mean((tensor_anomaly - recon_anomaly) ** 2, dim=1).numpy()

    threshold = float(np.percentile(mse_normal, THRESHOLD_PERCENTILE))
    print(f"  MSE normal  - mean: {mse_normal.mean():.4f}, 97th pct: {threshold:.4f}")
    print(f"  MSE anomaly - mean: {mse_anomaly.mean():.4f}")

    # Sanity check: anomaly detection rate
    detected = (mse_anomaly > threshold).mean() * 100
    false_pos = (mse_normal > threshold).mean() * 100
    print(f"  Anomaly Detection Rate: {detected:.1f}%")
    print(f"  False Positive Rate:    {false_pos:.1f}%")

    # Save model
    torch.save(model.state_dict(), MODEL_PATH)
    print(f"\n  Model saved  -> {MODEL_PATH}")

    with open(STATS_PATH, "w") as f:
        f.write(f"THRESHOLD_MSE={threshold}\n")
        f.write(f"INPUT_DIM=3\n")  # Critical: 3 sensors, not 4!
        f.write(f"SCALER_MEANS={','.join(str(v) for v in scaler.mean_)}\n")
        f.write(f"SCALER_SCALES={','.join(str(v) for v in scaler.scale_)}\n")
    print(f"  Stats saved  -> {STATS_PATH}")

    # 5. Export weights
    print("\n[5/5] Generating C++ header file...")
    state = model.state_dict()
    header_path = "firmware/src/nn_weights.h"

    with open(header_path, "w") as f:
        f.write("#ifndef NN_WEIGHTS_H\n")
        f.write("#define NN_WEIGHTS_H\n\n")
        f.write("// AUTO-GENERATED by retrain_from_real_ranges.py\n")
        f.write("// Trained on realistic DFRobot sensor ranges (3 inputs: TDS, Turbidity, Temp)\n\n")

        f.write("// StandardScaler constants fitted on real hardware ranges\n")
        means = scaler.mean_
        scales = scaler.scale_
        f.write(f"const float SCALER_MEAN[3] = {{{means[0]:.6f}f, {means[1]:.6f}f, {means[2]:.6f}f}};\n")
        f.write(f"const float SCALER_SCALE[3] = {{{scales[0]:.6f}f, {scales[1]:.6f}f, {scales[2]:.6f}f}};\n\n")

        f.write(f"const float ANOMALY_THRESHOLD = {threshold:.6f}f;\n\n")

        def write_tensor(name, t):
            flat = t.flatten().numpy()
            vals = ", ".join(f"{v:.6f}f" for v in flat)
            f.write(f"const float {name}[{len(flat)}] = {{{vals}}};\n")

        # Encoder: 3->8, 8->2
        write_tensor("ENC_L1_W", state["encoder.0.weight"])  # [8,3]
        write_tensor("ENC_L1_B", state["encoder.0.bias"])    # [8]
        f.write("\n")
        write_tensor("ENC_L2_W", state["encoder.2.weight"])  # [2,8]
        write_tensor("ENC_L2_B", state["encoder.2.bias"])    # [2]
        f.write("\n")
        # Decoder: 2->8, 8->3
        write_tensor("DEC_L1_W", state["decoder.0.weight"])  # [8,2]
        write_tensor("DEC_L1_B", state["decoder.0.bias"])    # [8]
        f.write("\n")
        write_tensor("DEC_L2_W", state["decoder.2.weight"])  # [3,8]
        write_tensor("DEC_L2_B", state["decoder.2.bias"])    # [3]
        f.write("\n")

        f.write("#endif // NN_WEIGHTS_H\n")

    print(f"  Header saved -> {header_path}")
    print("\n" + "=" * 60)
    print("  DONE! Now update ml_inference.cpp INPUT_DIM to 3,")
    print("  then recompile and upload firmware.")
    print("=" * 60)

if __name__ == "__main__":
    run()
