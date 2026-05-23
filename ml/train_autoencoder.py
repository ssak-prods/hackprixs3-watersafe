import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import pandas as pd
import numpy as np
import joblib

# Configuration
TRAIN_FILE = "ml/dataset_normal.csv"
TEST_FILE = "ml/dataset_test.csv"
MODEL_PATH = "ml/autoencoder.pth"
ONNX_PATH = "ml/autoencoder.onnx"
INPUT_DIM = 4
HIDDEN_DIM = 8
BOTTLENECK_DIM = 2
EPOCHS = 1000
BATCH_SIZE = 256
LEARNING_RATE = 1e-3

# 1. Define the Autoencoder Model
class WaterQualityAutoencoder(nn.Module):
    def __init__(self):
        super(WaterQualityAutoencoder, self).__init__()
        # Encoder
        self.encoder = nn.Sequential(
            nn.Linear(INPUT_DIM, HIDDEN_DIM),
            nn.ReLU(),
            nn.Linear(HIDDEN_DIM, BOTTLENECK_DIM)
            # Removed ReLU from bottleneck to prevent dead neurons in low-D space
        )
        # Decoder
        self.decoder = nn.Sequential(
            nn.Linear(BOTTLENECK_DIM, HIDDEN_DIM),
            nn.ReLU(),
            nn.Linear(HIDDEN_DIM, INPUT_DIM)
            # No final activation (or potentially Tanh/Sigmoid if data was normalized to [0,1] or [-1,1])
            # Since we used StandardScaler, data is approx N(0,1), so linear output is fine.
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded

def train():
    # 2. Load Data
    print(f"Loading training data from {TRAIN_FILE}...")
    df_train = pd.read_csv(TRAIN_FILE)
    train_data = torch.tensor(df_train.values, dtype=torch.float32)
    
    train_loader = DataLoader(TensorDataset(train_data), batch_size=BATCH_SIZE, shuffle=True)
    
    # 3. Initialize Model, Loss, Optimizer
    model = WaterQualityAutoencoder()
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # 4. Training Loop
    print("Starting training...")
    model.train()
    for epoch in range(EPOCHS):
        total_loss = 0
        for batch in train_loader:
            inputs = batch[0]
            
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, inputs)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
        if (epoch+1) % 10 == 0:
            avg_loss = total_loss / len(train_loader)
            print(f"Epoch [{epoch+1}/{EPOCHS}], Loss: {avg_loss:.6f}")

    # 5. Save PyTorch Model
    print(f"Saving model to {MODEL_PATH}...")
    torch.save(model.state_dict(), MODEL_PATH)

    # 6. Evaluate on Test Set (Calculate Threshold)
    print("Evaluating model to determine anomaly threshold...")
    model.eval()
    
    # Calculate reconstruction error on training set (Normal data) to set threshold
    with torch.no_grad():
        train_recon = model(train_data)
        train_mse = torch.mean((train_data - train_recon) ** 2, axis=1)
        
        # Threshold: 95th percentile of normal reconstruction error
        threshold = np.percentile(train_mse.numpy(), 95)
        print(f"95th Percentile Threshold (MSE): {threshold:.6f}")

        # Save stats for later usage
        with open("ml/model_stats.txt", "w") as f:
            f.write(f"THRESHOLD_MSE={threshold}\n")
            
        # Optional: Check performance on labeled test set
        if TEST_FILE:
            df_test = pd.read_csv(TEST_FILE)
            X_test = torch.tensor(df_test.iloc[:, :4].values, dtype=torch.float32)
            y_test = df_test['Potability'].values # 1=Normal, 0=Abnormal
            
            test_recon = model(X_test)
            test_mse = torch.mean((X_test - test_recon) ** 2, axis=1).numpy()
            
            # Predict Anomaly if MSE > Threshold
            # Our y_test is 1=Normal, so Anomaly is 0.
            # Prediction: Anomaly=True (1) if MSE > Threshold
            
            predictions = (test_mse > threshold).astype(int) # 1 if anomaly
            
            # Convert y_test: Normal(1) -> 0 (Not Anomaly), Abnormal(0) -> 1 (Anomaly)
            ground_truth_anomalies = (y_test == 0).astype(int)
            
            # Simple accuracy/metrics
            tp = np.sum((predictions == 1) & (ground_truth_anomalies == 1))
            fp = np.sum((predictions == 1) & (ground_truth_anomalies == 0))
            fn = np.sum((predictions == 0) & (ground_truth_anomalies == 1))
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            
            print(f"Evaluation on Test Set:")
            print(f"Precision: {precision:.4f}")
            print(f"Recall: {recall:.4f}")
            print(f"Anomalies Detected: {tp}/{np.sum(ground_truth_anomalies)}")

    # 7. Export to ONNX
    print(f"Exporting to ONNX: {ONNX_PATH}...")
    dummy_input = torch.randn(1, INPUT_DIM)
    torch.onnx.export(model, dummy_input, ONNX_PATH, 
                      input_names=['input'], 
                      output_names=['output'],
                      dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}})
    print("Export complete.")

if __name__ == "__main__":
    train()
