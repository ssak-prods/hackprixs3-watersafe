import pandas as pd
import numpy as np
import requests
import os
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib

# Configuration
DATA_URL = "https://raw.githubusercontent.com/amankharwal/Website-data/master/water_potability.csv"
RAW_FILE = "ml/water_potability_raw.csv"
PROCESSED_NORMAL_FILE = "ml/dataset_normal.csv" # For training (only normal data)
PROCESSED_TEST_FILE = "ml/dataset_test.csv"     # For evaluation (mixed normal/abnormal)
SCALER_FILE = "ml/scaler.save"

def download_data():
    print(f"Downloading data from {DATA_URL}...")
    try:
        response = requests.get(DATA_URL, timeout=10)
        response.raise_for_status()
        with open(RAW_FILE, 'wb') as f:
            f.write(response.content)
        print("Download complete.")
        return True
    except Exception as e:
        print(f"Download failed: {e}")
        return False

def generate_synthetic_data(n_samples=1000, mode='normal'):
    """
    Generate synthetic water quality data based on physics rules.
    Mode: 'normal' or 'abnormal'
    """
    print(f"Generating synthetic {mode} data...")
    np.random.seed(42 if mode == 'normal' else 99)
    
    # Normal ranges (approximate for potable water)
    # pH: 6.5 - 8.5
    # Turbidity: < 5 NTU (let's say 0.1 - 4.0)
    # TDS: < 500 ppm (let's say 50 - 500)
    # Temp: 20 - 30 C
    
    if mode == 'normal':
        ph = np.random.normal(7.5, 0.4, n_samples)
        ph = np.clip(ph, 6.5, 8.5)
        
        turbidity = np.random.normal(2.5, 1.0, n_samples)
        turbidity = np.clip(turbidity, 0.1, 4.5)
        
        tds = np.random.normal(250, 80, n_samples)
        tds = np.clip(tds, 50, 500) # Realistic ppm range for baseline
        
        temp = np.random.normal(25, 2.0, n_samples)
        temp = np.clip(temp, 20, 30)
        
        potability = np.ones(n_samples)
        
    else: # abnormal
        # Mix of different anomalies
        ph = np.random.normal(7.0, 2.0, n_samples) # Wide range
        # Bias some to be definitely bad
        mask = np.random.rand(n_samples) > 0.5
        ph[mask] = np.random.choice([np.random.uniform(4, 6), np.random.uniform(9, 11)], size=mask.sum())
        
        turbidity = np.random.normal(6.0, 3.0, n_samples)
        turbidity = np.clip(turbidity, 0.0, 20.0)
        
        tds = np.random.normal(600, 200, n_samples)
        tds = np.clip(tds, 0, 1500)
        
        temp = np.random.normal(25, 5.0, n_samples) # Wider temp swing?
        
        potability = np.zeros(n_samples)

    df = pd.DataFrame({
        'ph': ph,
        'Hardness': np.random.normal(150, 30, n_samples), # Dummy
        'Solids': tds,
        'Chloramines': np.random.normal(7, 1, n_samples), # Dummy
        'Sulfate': np.random.normal(330, 30, n_samples), # Dummy
        'Conductivity': np.random.normal(400, 100, n_samples), # Dummy
        'Organic_carbon': np.random.normal(14, 3, n_samples), # Dummy
        'Trihalomethanes': np.random.normal(66, 15, n_samples), # Dummy
        'Turbidity': turbidity,
        'Potability': potability
    })
    return df

def process_data():
    if os.path.exists(RAW_FILE):
        df = pd.read_csv(RAW_FILE)
        print(f"Loaded {len(df)} samples from {RAW_FILE}")
    else:
        print("Raw file not found. Generating fallback data.")
        df_normal = generate_synthetic_data(1000, 'normal')
        df_abnormal = generate_synthetic_data(500, 'abnormal')
        df = pd.concat([df_normal, df_abnormal], ignore_index=True)
        # Ensure directory exists if we generated data without file
        os.makedirs(os.path.dirname(RAW_FILE), exist_ok=True)
        df.to_csv(RAW_FILE, index=False)
        print("Saved synthetic data to raw file.")

    # 1. Fill missing values (if any)
    # The real dataset often has NaNs. Drop or fill.
    # For Autoencoder training on "Normal" data, accurate data is key.
    # Potability column: 1 (Potable/Normal), 0 (Not Potable/Abnormal).
    df = df.dropna()
    print(f"Samples after dropping NaNs: {len(df)}")
    
    # 2. Select relevant columns
    # We need: pH, Turbidity, TDS (Solids), Temperature.
    # Real dataset has: ph, Solids, Turbidity. Missing Temperature.
    
    # Rename columns and scale TDS
    df = df.rename(columns={
        'ph': 'pH',
        'Solids': 'TDS_raw', # Keep raw to scale
        'Turbidity': 'turbidity'
    })
    
    # Scale Kaggle Solids (often > 20,000) to realistic ppm (0-1000)
    # This is a heuristic translation for the TinyML demonstration to match 
    # the user's sensor expectations.
    df['TDS'] = (df['TDS_raw'] / 50.0).clip(0, 1000) 
    
    # 3. Synthesize Temperature if missing
    if 'temp' not in df.columns:
        print("Synthesizing Temperature column...")
        # Gaussian distribution: Mean 25C, STD 2C, clipped 15-35
        # No strong correlation assumed for this MVP
        df['temp'] = np.random.normal(25, 2.0, len(df))
        df['temp'] = df['temp'].clip(15, 35)

    # --- PURE SYNTHETIC DATA GENERATION ---
    # The user requested a robust model covering all acceptable bounds
    # based on global standards. We will generate 20,000 samples of pure 'Normal'.
    
    # Acceptable / "Normal" Bounds:
    # pH: 5.5 to 9.0 (Relaxed to handle slightly acidic/basic but generally safe water)
    # TDS: 10.0 to 1000.0 (WHO max acceptable is 1000 ppm)
    # Turbidity: 0.1 to 5.0 (WHO limit for drinking water is 5 NTU)
    # Temp: 10.0 to 35.0 (Broad range of surface/ground water)
    
    n_synthetic = 20000
    df_normal = pd.DataFrame({
        'pH': np.random.uniform(5.5, 9.0, n_synthetic),
        'turbidity': np.random.uniform(0.1, 5.0, n_synthetic),
        'TDS': np.random.uniform(10.0, 1000.0, n_synthetic),
        'temp': np.random.uniform(10.0, 35.0, n_synthetic)
    })
    
    df_test = df.copy() # Keep Kaggle data for testing anomalous values

    print(f"Massive Synthetic Normal samples for training: {len(df_normal)}")
    print(f"Kaggle samples for testing: {len(df_test)}")

    # Features for the model
    feature_cols = ['pH', 'turbidity', 'TDS', 'temp']
    
    # 5. Normalize/Scale
    # We must save the scaler for the inference phase (C++ conversion later)
    scaler = StandardScaler()
    
    # Fit scaler ONLY on normal data
    scaler.fit(df_normal[feature_cols])
    
    # Transform
    X_normal = scaler.transform(df_normal[feature_cols])
    # For testing, we only care about the features, but we need to handle potential NaNs
    df_test = df_test.dropna(subset=['pH', 'TDS_raw', 'turbidity', 'temp'])
    df_test['TDS'] = (df_test['TDS_raw'] / 50.0).clip(0, 1000)
    X_test = scaler.transform(df_test[feature_cols])
    
    # 6. Save
    # Save Scaler
    joblib.dump(scaler, SCALER_FILE)
    print(f"Scaler saved to {SCALER_FILE}")
    
    # Save Processed Normal Data (for training)
    # Convert back to DF for easy saving/loading
    df_train_processed = pd.DataFrame(X_normal, columns=feature_cols)
    df_train_processed.to_csv(PROCESSED_NORMAL_FILE, index=False)
    print(f"Training data saved to {PROCESSED_NORMAL_FILE}")
    
    # Save Processed Test Data (with labels for evaluation)
    # We include the 'Potability' label for ground truth checking later
    df_test_processed = pd.DataFrame(X_test, columns=feature_cols)
    df_test_processed['Potability'] = df_test['Potability'].values # 1=Normal, 0=Anomalous
    df_test_processed.to_csv(PROCESSED_TEST_FILE, index=False)
    print(f"Test data saved to {PROCESSED_TEST_FILE}")

def main():
    if not os.path.exists('ml'):
        os.makedirs('ml')
        
    if not os.path.exists(RAW_FILE):
        success = download_data()
        if not success:
            print("Proceeding with synthetic data generation.")
    
    process_data()

if __name__ == "__main__":
    main()
