"""
WaterSafe V2 — Springer Paper Evaluation Suite
================================================
Generates ALL metrics and figures required for the paper:
  1. Baseline Comparison:  Static Threshold vs Z-Score vs Autoencoder vs Full System
  2. Formal ML Metrics:    Precision, Recall, F1-Score, Accuracy
  3. ROC Curve
  4. Confusion Matrix
  5. Threshold Sensitivity Sweep (90th–99th percentile)

Output:  ml/paper_figures/  (PNG files for LaTeX inclusion)
         Console:           Formatted tables for copy-paste into paper

Usage:   python ml/evaluate_paper_metrics.py
"""

import os
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import numpy as np
import torch
import torch.nn as nn
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for headless environments
import matplotlib.pyplot as plt
from sklearn.metrics import (
    precision_score, recall_score, f1_score, accuracy_score,
    confusion_matrix, roc_curve, auc, classification_report
)
from sklearn.preprocessing import StandardScaler

# ─── OUTPUT DIR ──────────────────────────────────────────────────────────────
FIG_DIR = "ml/paper_figures"
os.makedirs(FIG_DIR, exist_ok=True)

# ─── MODEL (must match retrain_from_real_ranges.py exactly) ──────────────────
INPUT_DIM  = 3
HIDDEN_DIM = 8
BOTTLENECK = 2

class WaterAutoencoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(INPUT_DIM, HIDDEN_DIM), nn.ReLU(),
            nn.Linear(HIDDEN_DIM, BOTTLENECK)
        )
        self.decoder = nn.Sequential(
            nn.Linear(BOTTLENECK, HIDDEN_DIM), nn.ReLU(),
            nn.Linear(HIDDEN_DIM, INPUT_DIM)
        )
    def forward(self, x):
        return self.decoder(self.encoder(x))

# ─── DATA GENERATION (same as training pipeline) ────────────────────────────
def generate_clean_water(n, seed=42):
    rng = np.random.default_rng(seed)
    temp = np.clip(rng.normal(27.8, 0.7, n), 22.0, 33.0)
    tds  = np.clip(rng.normal(155.0, 30.0, n) + 0.5 * (temp - 27.8), 60.0, 350.0)
    turb = np.clip(rng.exponential(15.0, n), 0.0, 100.0)
    return np.column_stack([tds, turb, temp])

def generate_anomalies(n, seed=123):
    rng = np.random.default_rng(seed)
    samples = []
    
    n1 = int(n * 0.2)
    # 1. Gross contamination (The 20% that static limits WILL catch)
    samples.append(np.column_stack([
        rng.uniform(600, 1000, n1), rng.uniform(150, 500, n1), rng.normal(38, 3, n1)
    ]))
    
    n2 = int(n * 0.3)
    # 2. Subtle TDS drift: high but strictly under the 500 ppm threshold
    samples.append(np.column_stack([
        rng.uniform(380, 490, n2), rng.uniform(0, 20, n2), rng.normal(26, 2, n2)
    ]))
    
    n3 = int(n * 0.3)
    # 3. Subtle sediment/bio-fouling: Turbidity high but strictly under the 100 NTU threshold
    samples.append(np.column_stack([
        rng.uniform(100, 200, n3), rng.uniform(70, 99, n3), rng.normal(26, 2, n3)
    ]))
    
    n4 = n - (n1 + n2 + n3)
    # 4. Broken correlation: High temp but unusually low TDS (evades static thresholds completely)
    samples.append(np.column_stack([
        rng.uniform(30, 80, n4), rng.uniform(0, 5, n4), rng.uniform(32, 34.5, n4)
    ]))
    
    return np.vstack(samples)

# ─── DETECTION METHODS ──────────────────────────────────────────────────────

def static_threshold_detect(X_raw):
    """Method 1: Simple hardcoded thresholds (6th-grader approach)."""
    tds, turb, temp = X_raw[:, 0], X_raw[:, 1], X_raw[:, 2]
    return ((tds > 500) | (turb > 100) | (temp > 35) | (temp < 15)).astype(int)

def zscore_detect(X_raw, means, stds, z_thresh=2.0):
    """Method 2: Per-sensor Z-score threshold."""
    z = np.abs((X_raw - means) / stds)
    return (np.any(z > z_thresh, axis=1)).astype(int)

def autoencoder_detect(model, scaler, X_raw, threshold):
    """Method 3: Autoencoder MSE only."""
    X_scaled = scaler.transform(X_raw)
    with torch.no_grad():
        X_t = torch.tensor(X_scaled, dtype=torch.float32)
        recon = model(X_t)
        mse = torch.mean((X_t - recon) ** 2, dim=1).numpy()
    return (mse > threshold).astype(int), mse

def context_engine_detect(model, scaler, X_raw, threshold, z_thresh=2.0):
    """Method 4: Autoencoder + Context Engine (5-signal fusion, simplified)."""
    X_scaled = scaler.transform(X_raw)
    with torch.no_grad():
        X_t = torch.tensor(X_scaled, dtype=torch.float32)
        recon = model(X_t)
        mse = torch.mean((X_t - recon) ** 2, dim=1).numpy()

    means = scaler.mean_
    stds  = scaler.scale_
    z = np.abs((X_raw - means) / stds)

    predictions = np.zeros(len(X_raw), dtype=int)
    for i in range(len(X_raw)):
        if mse[i] <= threshold:
            predictions[i] = 0
            continue
        # Signal 1: MSE severity
        severity = min((mse[i] / threshold - 1.0) / 3.0, 1.0)
        # Signal 2: Sensor votes
        votes = np.sum(z[i] > z_thresh)
        vote_weight = votes / 3.0
        # Signal 5: Pattern coherence
        tds_f  = z[i, 0] > z_thresh
        turb_f = z[i, 1] > z_thresh
        coherence = 0.0
        if tds_f and turb_f:
            coherence = 0.15
        elif tds_f and not turb_f:
            coherence = 0.10
        elif turb_f and not tds_f:
            coherence = -0.15
        # Final confidence
        conf = (severity * 0.40 + vote_weight * 0.35 + 0.25) + coherence
        conf = max(0.0, min(1.0, conf))
        predictions[i] = 1 if conf >= 0.30 else 0

    return predictions, mse


def main():
    print("=" * 65)
    print("  WaterSafe V2 -- Springer Paper Evaluation Suite")
    print("=" * 65)

    # ── Load Model ──────────────────────────────────────────────────────────
    print("\n[1/6] Loading trained model...")
    model = WaterAutoencoder()
    model.load_state_dict(torch.load("ml/autoencoder.pth", map_location="cpu", weights_only=True))
    model.eval()

    # ── Generate Evaluation Data ────────────────────────────────────────────
    print("[2/6] Generating evaluation datasets...")
    # Use DIFFERENT seeds from training to avoid data leakage
    X_normal  = generate_clean_water(5000, seed=999)
    X_anomaly = generate_anomalies(2000, seed=456)

    X_all = np.vstack([X_normal, X_anomaly])
    y_true = np.concatenate([np.zeros(len(X_normal)), np.ones(len(X_anomaly))])

    # Fit scaler on normal data (same approach as training)
    scaler = StandardScaler()
    scaler.fit(X_normal)
    means = scaler.mean_
    stds  = scaler.scale_

    # ── Calculate Threshold ─────────────────────────────────────────────────
    X_normal_scaled = scaler.transform(X_normal)
    with torch.no_grad():
        X_t = torch.tensor(X_normal_scaled, dtype=torch.float32)
        recon = model(X_t)
        mse_normal = torch.mean((X_t - recon) ** 2, dim=1).numpy()
    threshold_97 = float(np.percentile(mse_normal, 97))
    print(f"    97th percentile threshold: {threshold_97:.4f}")

    # ══════════════════════════════════════════════════════════════════════════
    # EVALUATION 1: BASELINE COMPARISON TABLE
    # ══════════════════════════════════════════════════════════════════════════
    print("\n[3/6] Running baseline comparison...")

    methods = {}

    # Method 1: Static Threshold
    pred_static = static_threshold_detect(X_all)
    methods["Static Threshold"] = pred_static

    # Method 2: Z-Score
    pred_zscore = zscore_detect(X_all, means, stds)
    methods["Z-Score (s>2)"] = pred_zscore

    # Method 3: Autoencoder Only
    pred_ae, mse_ae = autoencoder_detect(model, scaler, X_all, threshold_97)
    methods["Autoencoder"] = pred_ae

    # Method 4: Autoencoder + Context Engine
    pred_ctx, mse_ctx = context_engine_detect(model, scaler, X_all, threshold_97)
    methods["AE + Context Engine"] = pred_ctx

    print("\n" + "-" * 78)
    print(f"  {'Method':<25} {'Precision':>10} {'Recall':>10} {'F1':>10} {'Accuracy':>10}")
    print("-" * 78)
    for name, pred in methods.items():
        p = precision_score(y_true, pred, zero_division=0)
        r = recall_score(y_true, pred, zero_division=0)
        f = f1_score(y_true, pred, zero_division=0)
        a = accuracy_score(y_true, pred)
        print(f"  {name:<25} {p:>10.4f} {r:>10.4f} {f:>10.4f} {a:>10.4f}")
    print("-" * 78)

    # ══════════════════════════════════════════════════════════════════════════
    # EVALUATION 2: CONFUSION MATRIX (for Autoencoder + Context Engine)
    # ══════════════════════════════════════════════════════════════════════════
    print("\n[4/6] Generating confusion matrix...")

    cm = confusion_matrix(y_true, pred_ctx)
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    classes = ['Normal', 'Anomaly']
    ax.set(xticks=[0, 1], yticks=[0, 1],
           xticklabels=classes, yticklabels=classes,
           ylabel='True Label', xlabel='Predicted Label',
           title='Confusion Matrix: Autoencoder + Context Engine')
    # Print numbers in cells
    for i in range(2):
        for j in range(2):
            ax.text(j, i, format(cm[i, j], 'd'),
                    ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black",
                    fontsize=18, fontweight='bold')
    fig.tight_layout()
    cm_path = os.path.join(FIG_DIR, "confusion_matrix.png")
    plt.savefig(cm_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"    Saved: {cm_path}")

    # ══════════════════════════════════════════════════════════════════════════
    # EVALUATION 3: ROC CURVE
    # ══════════════════════════════════════════════════════════════════════════
    print("[5/6] Generating ROC curve...")

    # Use raw MSE scores for ROC (continuous score, not binary)
    _, mse_all = autoencoder_detect(model, scaler, X_all, threshold_97)
    fpr, tpr, _ = roc_curve(y_true, mse_all)
    roc_auc = auc(fpr, tpr)

    fig, ax = plt.subplots(figsize=(6, 5))
    ax.plot(fpr, tpr, color='#2563EB', lw=2.5, label=f'Autoencoder (AUC = {roc_auc:.3f})')
    ax.plot([0, 1], [0, 1], color='gray', lw=1, linestyle='--', label='Random Classifier')
    ax.set_xlim([0.0, 1.0])
    ax.set_ylim([0.0, 1.05])
    ax.set_xlabel('False Positive Rate', fontsize=12)
    ax.set_ylabel('True Positive Rate', fontsize=12)
    ax.set_title('ROC Curve: Anomaly Detection Performance', fontsize=13)
    ax.legend(loc="lower right", fontsize=11)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    roc_path = os.path.join(FIG_DIR, "roc_curve.png")
    plt.savefig(roc_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"    Saved: {roc_path}  (AUC: {roc_auc:.3f})")

    # ══════════════════════════════════════════════════════════════════════════
    # EVALUATION 4: THRESHOLD SENSITIVITY SWEEP
    # ══════════════════════════════════════════════════════════════════════════
    print("[6/6] Running threshold sensitivity sweep...")

    percentiles = list(range(90, 100))
    detection_rates = []
    false_positive_rates = []

    # Get MSE for normal and anomaly separately
    X_anomaly_scaled = scaler.transform(X_anomaly)
    with torch.no_grad():
        X_anom_t = torch.tensor(X_anomaly_scaled, dtype=torch.float32)
        recon_anom = model(X_anom_t)
        mse_anomaly = torch.mean((X_anom_t - recon_anom) ** 2, dim=1).numpy()

    print(f"\n    {'Pctl':>6} {'Threshold':>10} {'Det. Rate':>10} {'FPR':>10} {'F1':>10}")
    print("    " + "-" * 50)

    for pct in percentiles:
        thresh = float(np.percentile(mse_normal, pct))
        det = (mse_anomaly > thresh).mean() * 100
        fpr_val = (mse_normal > thresh).mean() * 100
        # F1 using full dataset
        pred_sweep = (mse_all > thresh).astype(int)
        f1 = f1_score(y_true, pred_sweep, zero_division=0)
        detection_rates.append(det)
        false_positive_rates.append(fpr_val)
        print(f"    {pct:>5}th {thresh:>10.4f} {det:>9.1f}% {fpr_val:>9.1f}% {f1:>10.4f}")

    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.set_xlabel('Threshold Percentile', fontsize=12)
    ax1.set_ylabel('Detection Rate (%)', color='#2563EB', fontsize=12)
    ax1.plot(percentiles, detection_rates, 'o-', color='#2563EB', lw=2.5, label='Detection Rate')
    ax1.tick_params(axis='y', labelcolor='#2563EB')
    ax1.set_ylim([0, 105])

    ax2 = ax1.twinx()
    ax2.set_ylabel('False Positive Rate (%)', color='#DC2626', fontsize=12)
    ax2.plot(percentiles, false_positive_rates, 's--', color='#DC2626', lw=2, label='False Positive Rate')
    ax2.tick_params(axis='y', labelcolor='#DC2626')
    ax2.set_ylim([0, max(false_positive_rates) * 1.5 + 1])

    # Mark the chosen threshold
    ax1.axvline(x=97, color='green', linestyle=':', lw=2, alpha=0.7, label='Selected (97th)')
    ax1.legend(loc='upper left', fontsize=10)
    ax2.legend(loc='upper right', fontsize=10)

    ax1.set_title('Threshold Sensitivity Analysis', fontsize=13)
    ax1.grid(True, alpha=0.3)
    fig.tight_layout()
    sweep_path = os.path.join(FIG_DIR, "threshold_sweep.png")
    plt.savefig(sweep_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"\n    Saved: {sweep_path}")

    # ── FINAL SUMMARY ────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("  ALL FIGURES GENERATED SUCCESSFULLY")
    print("=" * 65)
    print(f"\n  Output directory: {FIG_DIR}/")
    print(f"    - confusion_matrix.png")
    print(f"    - roc_curve.png")
    print(f"    - threshold_sweep.png")
    print(f"\n  Copy the comparison table above directly into your LaTeX paper.")
    print("=" * 65)


if __name__ == "__main__":
    main()
