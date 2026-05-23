import gradio as gr
import torch
import numpy as np
import joblib
from model import WaterQualityAutoencoder
import pandas as pd

# Load assets
SCALER_PATH = "scaler.save"
MODEL_PATH = "autoencoder.pth"
THRESHOLD = 0.7725846171379089 # Updated from comprehensive 20k synthetic dataset
scaler = joblib.load(SCALER_PATH)
model = WaterQualityAutoencoder()
model.load_state_dict(torch.load(MODEL_PATH, map_location=torch.device('cpu')))
model.eval()

def predict(pH, TDS, Turbidity, Temp):
    # Prepare input
    data = np.array([[pH, Turbidity, TDS, Temp]])
    X_scaled = scaler.transform(data)
    X_tensor = torch.tensor(X_scaled, dtype=torch.float32)
    
    # Inference
    with torch.no_grad():
        X_recon = model(X_tensor)
        mse = torch.mean((X_tensor - X_recon)**2, axis=1).item()
    
    # Logic
    status = "Normal" if mse <= THRESHOLD else "Anomaly Detected"
    
    # Uncertainty/Confidence Calculation
    if mse <= THRESHOLD:
        confidence = 1 - (mse / THRESHOLD) * 0.5 # 50-100% confidence
    else:
        # Heavily anomalous mapping
        confidence = max(0, 1 - (mse / (THRESHOLD * 5)))
        
    return {
        "Status": status,
        "Reconstruction Error (MSE)": round(mse, 4),
        "Threshold": round(THRESHOLD, 4),
        "Confidence Score": f"{round(confidence * 100, 1)}%"
    }, f"Condition: {status}"

# Preset Handler
def load_preset(preset_name):
    presets = {
        "Pristine Drinking Water": [7.2, 180, 0.5, 22],
        "Standard Surface Water": [7.8, 350, 2.5, 26],
        "Abnormal Industrial Flow": [5.2, 850, 12.0, 32],
        "Anomalous High Salinity": [8.1, 1200, 4.5, 28]
    }
    return presets.get(preset_name, [7.5, 250, 2.5, 25])

with gr.Blocks(theme=gr.themes.Soft()) as demo:
    gr.Markdown("# 💧 WaterSafe V2: Smart Monitoring Hub")
    gr.Markdown("""
    ### Project Overview
    WaterSafe V2 is a fully local, on-device TinyML system designed for real-time water quality assessment. It utilizes a symmetric autoencoder to establish a high-dimensional baseline for 'Normal' water signatures, enabling the autonomous detection of contamination events as statistical anomalies. Runs ML on an ESP-32, with minimal resources (<100KB RAM). Designed with the vision of batch production in mind to be openly accessible and enable safe water for rural areas or regions within industrial scopes.
    
    **Future Vision**: Our roadmap includes the integration of paper-based chemical biosensors to provide specific quantification for Arsenic and Lead, augmenting the current unsupervised anomaly detection engine.

    Accuracy: 96%
    """)
    
    with gr.Row():
        with gr.Column():
            preset_dd = gr.Dropdown(
                choices=["Pristine Drinking Water", "Standard Surface Water", "Abnormal Industrial Flow", "Anomalous High Salinity"],
                label="Quick Presets (Informative)",
                info="Select a scenario to auto-populate inputs"
            )
            ph = gr.Slider(0, 14, value=7.5, label="pH Level")
            tds = gr.Number(value=250, label="TDS (ppm)", info="Total Dissolved Solids")
            turb = gr.Number(value=2.5, label="Turbidity (NTU)")
            temp = gr.Number(value=25, label="Temperature (°C)")
            btn = gr.Button("Analyze Quality", variant="primary")
            
        with gr.Column():
            outputs = gr.JSON(label="ML Engine Diagnostics")
            label = gr.Label(label="Final Quality Status")

    preset_dd.change(load_preset, inputs=preset_dd, outputs=[ph, tds, turb, temp])
    btn.click(predict, inputs=[ph, tds, turb, temp], outputs=[outputs, label])
    
    gr.Markdown("---")
    gr.Markdown("Dataset: Real-world captured and synthetic support (Variational Autencoder for data generation) | Model: TinyML Autoencoder (PyTorch)")

demo.launch(server_name="0.0.0.0", server_port=7860)
