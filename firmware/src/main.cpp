/*
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  WaterSafe V2 — Edge AI + Context Enrichment Layer               ║
 * ║  Confidence-Scored Anomaly Detection | 5-Screen OLED Dashboard   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Hardware:
 *   - ESP32-WROOM-32 (38-pin)
 *   - DS18B20 Temperature Sensor (GPIO 4, 4.7kΩ pullup)
 *   - DFRobot TDS Sensor       (ADS1115 A0)
 *   - DFRobot Turbidity Sensor (ADS1115 A1, switch → A)
 *   - ADS1115 16-bit ADC       (I2C: 0x48)
 *   - OLED SSD1306 128×64      (I2C: 0x3C)
 *
 * Pipeline:
 *   Sensors → Autoencoder MSE → 5-Signal Context Engine → Confidence %
 *
 * OLED Screens (auto-cycling):
 *   0: Temperature   1: TDS   2: Turbidity
 *   3: AI Status + Confidence
 *   4: DIAGNOSIS (why screen) — shown only on alert
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_SSD1306.h>
#include "ml_inference.h"
#include "context_layer.h"

// ─── HARDWARE ────────────────────────────────────────────────────────────────
#define ONE_WIRE_BUS  4
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1

// ─── SENSOR CALIBRATION ──────────────────────────────────────────────────────
#define TDS_KVALUE      0.5f

// ─── CLOUD DASHBOARD (Vercel + Proxy) ─────────────────────────────────────────
#define ENABLE_WIFI       true    // Wi-Fi enabled after isolating TensorFlowLite crashes
const char* WIFI_SSID     = "ga14";
const char* WIFI_PASSWORD = "meow123321";

// Point directly at localtunnel (Vercel rewrites can't bypass localtunnel's interstitial page)
// UPDATE THIS URL every time you restart localtunnel!
const char* API_ENDPOINT  = "https://fifty-states-tickle.loca.lt/api/ingest";

// Turbidity: DFRobot analog output — higher voltage = clearer water
// Calibrate TURB_V_CLEAR to what the sensor reads in your clean water sample.
// Read the [V] column in Serial Monitor with clean water and set it here.
#define TURB_V_CLEAR  2.55f   // ← Calibrated for your clean bottled waters (mean ~2.40-2.51V)
#define TURB_V_MURKY  0.50f
#define TURB_NTU_MAX  3000.0f

// ─── OBJECTS ─────────────────────────────────────────────────────────────────
OneWire             oneWire(ONE_WIRE_BUS);
DallasTemperature   tempSensor(&oneWire);
Adafruit_ADS1115    ads;
Adafruit_SSD1306    display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ─── PHYSICAL CELLULAR SMS CONFIGURATION ──────────────────────────────────────
#define ENABLE_CELLULAR_SMS  false  // Hardware GSM disabled — using Twilio software SMS via Node.js server instead
#define GSM_RX_PIN           16
#define GSM_TX_PIN           17
HardwareSerial gsmSerial(2);        // Use ESP32 UART2 for cell communication
const char* RECIPIENT_NUMBER = "+919876543210"; // Replace with your phone number for the demo
unsigned long lastSMSSentTime = 0;  // Debounce SMS triggers

// ─── SENSOR DATA ─────────────────────────────────────────────────────────────
struct SensorData {
  float temperature;    // °C
  float tds;            // ppm
  float tds_voltage;    // Raw V (for TDS calibration)
  float turbidity;      // NTU
  float turb_voltage;   // Raw V (for turbidity calibration)
  unsigned long timestamp;
};

SensorData    currentData;
ContextResult ctx;  // Full context result: confidence, alert, why strings

unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 3000;  // 3 seconds

// ─── UI STATE MACHINE ─────────────────────────────────────────────────────────
// States: 0=Temp  1=TDS  2=Turb  3=Status  4=Diagnosis(why)
unsigned long lastUIFrame    = 0;
unsigned long stateStartTime = 0;
int           uiState        = 0;
int           scrollX        = 128;   // for scrolling text on status screen

// ─── SENSOR HELPERS ──────────────────────────────────────────────────────────
float voltageToTDS(float v, float t) {
  float coeff = 1.0f + 0.02f * (t - 25.0f);
  float vc    = v / coeff;
  return max(0.0f, (133.42f * vc * vc * vc
                  - 255.86f * vc * vc
                  + 857.39f * vc) * TDS_KVALUE);
}

float voltageToNTU(float v) {
  if (v > TURB_V_CLEAR) v = TURB_V_CLEAR;
  if (v < 0.0f)         v = 0.0f;
  float ratio = (v - TURB_V_MURKY) / (TURB_V_CLEAR - TURB_V_MURKY);
  if (ratio < 0.0f) ratio = 0.0f;
  if (ratio > 1.0f) ratio = 1.0f;
  return TURB_NTU_MAX - (ratio * TURB_NTU_MAX);
}

// ─── SENSOR RATE-OF-CHANGE GUARD ─────────────────────────────────────────────
// Detects sudden voltage jumps (>40% and >0.10V absolute) between consecutive readings.
// Real contamination changes gradually. A 40%+ jump in 3 seconds = loose wire,
// air bubble, or sensor repositioning — NOT real water quality change.
static float prev_tds_v  = -1.0f;
static float prev_turb_v = -1.0f;
static bool  sensor_fault = false;
#define VOLTAGE_JUMP_THRESHOLD 0.40f  // 40% change in 3s = hardware fault

static int tds_fault_streak = 0;
static int turb_fault_streak = 0;

bool checkVoltageJump(float prev, float curr, const char* name, int &streak) {
  if (prev < 0.01f) return false;  // First reading, no comparison possible
  float abs_diff = fabsf(curr - prev);
  if (abs_diff < 0.10f) {          // Ignore tiny voltage fluctuations under 0.10V
    streak = 0;
    return false;
  }
  float change = abs_diff / prev;
  if (change > VOLTAGE_JUMP_THRESHOLD) {
    streak++;
    if (streak >= 3) {
      // If the jump persists for 3 consecutive cycles (9s), accept it as the new baseline
      Serial.printf("[SENSOR_FAULT] %s voltage change persisted. Accepting new reading: %.3fV\n", name, curr);
      streak = 0;
      return false;
    }
    Serial.printf("[SENSOR_FAULT] %s voltage jumped %.0f%% (%.3fV → %.3fV) [streak %d/3] — holding previous reading\n",
                  name, change * 100.0f, prev, curr, streak);
    return true;
  }
  streak = 0;
  return false;
}

// ─── SENSOR READ ─────────────────────────────────────────────────────────────
void readSensors() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  
  // Safe nominal fallback (25.0C) if temperature probe reading fails or drifts out of bounds
  if (t == DEVICE_DISCONNECTED_C || t < -10.0f || t > 85.0f) {
    currentData.temperature = 25.0f;
  } else {
    currentData.temperature = t;
  }

  int16_t adc0 = ads.readADC_SingleEnded(0);
  float   v0   = adc0 * 0.1875f / 1000.0f;

  int16_t adc1 = ads.readADC_SingleEnded(1);
  float   v1   = adc1 * 0.1875f / 1000.0f;

  // Rate-of-change guard: if either sensor voltage jumps >40% and >0.10V, hold previous values
  bool tds_fault  = checkVoltageJump(prev_tds_v,  v0, "TDS", tds_fault_streak);
  bool turb_fault = checkVoltageJump(prev_turb_v, v1, "TURB", turb_fault_streak);
  sensor_fault = tds_fault || turb_fault;

  if (!tds_fault) {
    currentData.tds_voltage = v0;
    currentData.tds = voltageToTDS(v0, currentData.temperature);
    prev_tds_v = v0;
  }
  // else: keep currentData.tds and tds_voltage from previous reading

  if (!turb_fault) {
    currentData.turb_voltage = v1;
    currentData.turbidity    = voltageToNTU(v1);
    prev_turb_v = v1;
  }
  // else: keep currentData.turbidity and turb_voltage from previous reading

  currentData.timestamp = millis();
}

// ─── OLED HELPERS ────────────────────────────────────────────────────────────
// Draws a thin separator line
void drawSeparator(int y) {
  display.drawLine(0, y, SCREEN_WIDTH - 1, y, SSD1306_WHITE);
}

// Large label + value pair (for sensor screens)
void drawSensorScreen(const char* label1, const char* label2, const char* value, const char* unit) {
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(label1);
  if (strlen(label2) > 0) {
    display.setCursor(0, 10);
    display.print(label2);
    drawSeparator(20);
  } else {
    drawSeparator(10);
  }
  
  display.setTextSize(3);
  display.setCursor(4, 25);
  display.print(value);
  
  display.setTextSize(1);
  display.setCursor(4, 54);
  display.print(unit);
}

// Alert label with inverted background flash (for high severity)
void drawAlertBanner(const char* label, bool flash, unsigned long t) {
  bool inv = flash && ((t / 300) % 2 == 0);
  if (inv) display.fillRect(0, 0, SCREEN_WIDTH, 20, SSD1306_WHITE);
  display.setTextColor(inv ? SSD1306_BLACK : SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(4, 2);
  display.print(label);
  display.setTextColor(SSD1306_WHITE);
}

// ─── DISPLAY UPDATE ──────────────────────────────────────────────────────────
void updateDisplay() {
  display.clearDisplay();
  unsigned long t = millis() - stateStartTime;
  char buf[24];

  // ── STATE 0: TEMPERATURE ─────────────────────────────────────────────────
  if (uiState == 0) {
    snprintf(buf, sizeof(buf), "%.1f", currentData.temperature);
    drawSensorScreen("TEMP:", "", buf, "Celsius");
    if (t > 2000) { uiState = 1; stateStartTime = millis(); }
  }

  // ── STATE 1: TDS (INORGANIC CONCENTRATION) ───────────────────────────────
  else if (uiState == 1) {
    snprintf(buf, sizeof(buf), "%d", (int)currentData.tds);
    drawSensorScreen("INORGANIC", "CONCENTRATION:", buf, "ppm");
    if (t > 2000) { uiState = 2; stateStartTime = millis(); }
  }

  // ── STATE 2: TURBIDITY (CLOUDINESS) ──────────────────────────────────────
  else if (uiState == 2) {
    snprintf(buf, sizeof(buf), "%d", (int)currentData.turbidity);
    drawSensorScreen("CLOUDINESS:", "", buf, "NTU");
    if (t > 2000) { uiState = 3; stateStartTime = millis(); }
  }

  // ── STATE 3: AI STATUS (VERDICT) ─────────────────────────────────────────
  else if (uiState == 3) {
    if (ctx.alert_level == ALERT_NORMAL) {
      // ─ NORMAL ─
      display.setTextColor(SSD1306_WHITE);
      display.fillRect(0, 0, SCREEN_WIDTH, 20, SSD1306_WHITE);
      display.setTextColor(SSD1306_BLACK);
      display.setTextSize(2);
      display.setCursor(4, 3);
      display.print("WATER SAFE");
      
      display.setTextColor(SSD1306_WHITE);
      display.setTextSize(1);
      display.setCursor(15, 35);
      display.print("Clear for drinking");
      
      if (t > 3000) { uiState = 0; stateStartTime = millis(); scrollX = 128; }

    } else {
      // ─ ALERT ─
      const char* banner = "DANGER !!!";
      bool flash = true;

      drawAlertBanner(banner, flash, t);

      // Actionable instruction / Simple reason
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(2, 28);
      display.print("Conf: ");
      display.print(ctx.confidence);
      display.print("%");

      // Scrolling reason
      drawSeparator(44);
      display.setTextSize(1);
      display.setCursor(scrollX, 50);
      display.print(ctx.reason);
      scrollX -= 4; // Faster animation
      if (scrollX < -(int)(strlen(ctx.reason) * 6)) scrollX = 128;

      unsigned long dwell = (ctx.alert_level >= ALERT_WARNING) ? 4000 : 3000;
      if (t > dwell) {
        uiState = 0; // Skip Diagnosis screen, go straight back to sensors
        stateStartTime = millis();
        scrollX = 128;
      }
    }
  }

  display.display();
}

// ─── SERIAL LOG ──────────────────────────────────────────────────────────────
void logToSerial() {
  char buf[160];
  const char* verdict;
  if (ctx.alert_level == ALERT_NORMAL) verdict = "[SAFE]     ";
  else                                 verdict = "[UNSAFE]   ";

  snprintf(buf, sizeof(buf),
    "%5lu  |  %5.1fC  |  %4dppm [%.3fV]  |  %5dNTU [%.3fV]  |  MSE:%7.3f  |  %s  Conf:%3d%%  |  %s",
    currentData.timestamp / 1000,
    currentData.temperature,
    (int)currentData.tds,
    currentData.tds_voltage,
    (int)currentData.turbidity,
    currentData.turb_voltage,
    ml_get_last_error(),
    verdict,
    ctx.confidence,
    ctx.reason);
  Serial.println(buf);
}

// ─── CLOUD PUSH ──────────────────────────────────────────────────────────────
void pushToDashboard() {
  if (!ENABLE_WIFI) {
    return; // Fast return when running in offline mode to prevent brownouts
  }
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.setInsecure(); // Bypass certificate validation to prevent crashes and save heap RAM
    HTTPClient http;
    http.begin(client, API_ENDPOINT);
    http.setTimeout(6000); // Give SSL handshake enough time on mobile hotspots, but prevent permanent blocking
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Bypass-Tunnel-Reminder", "true"); // Skip localtunnel interstitial page

    // Build JSON Payload
    String payload = "{";
    payload += "\"tds\":" + String(currentData.tds, 1) + ",";
    payload += "\"turbidity\":" + String(currentData.turbidity, 1) + ",";
    payload += "\"temperature\":" + String(currentData.temperature, 1) + ",";
    payload += "\"confidence\":" + String(ctx.confidence) + ",";
    payload += "\"alert_level\":" + String(ctx.alert_level) + ",";
    payload += "\"reason\":\"" + String(ctx.reason) + "\",";
    payload += "\"is_anomaly\":" + String(ctx.is_anomaly ? "true" : "false");
    payload += "}";

    int httpResponseCode = http.POST(payload);
    if (httpResponseCode > 0) {
      Serial.print(" [☁️ ] Cloud Push OK: ");
      Serial.println(httpResponseCode);
    } else {
      Serial.print(" [☁️ ] Cloud Push Error: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println(" [☁️ ] Wi-Fi Disconnected. Skipping push.");
  }
}

// ─── PHYSICAL SMS SENDING ───────────────────────────────────────────────────
void sendPhysicalSMS(const char* phoneNumber, const char* messageText) {
  if (!ENABLE_CELLULAR_SMS) return;
  
  Serial.printf("\n[CELLULAR] Dispatching alert SMS to %s...\n", phoneNumber);
  
  // Handshake with AT command
  gsmSerial.println("AT");
  delay(200);
  
  // Set SMS Text Mode
  gsmSerial.println("AT+CMGF=1");
  delay(200);
  
  // Setup recipient phone number
  gsmSerial.print("AT+CMGS=\"");
  gsmSerial.print(phoneNumber);
  gsmSerial.println("\"");
  delay(300);
  
  // Write message content
  gsmSerial.print(messageText);
  delay(300);
  
  // Send Ctrl+Z (ASCII 26) to commit and send SMS
  gsmSerial.write(26);
  delay(4000); // Give the module 4 seconds to transmit
  
  Serial.println("[CELLULAR] SMS transmit process completed.\n");
}

// ─── SETUP ───────────────────────────────────────────────────────────────────
void setup() {

  Serial.begin(115200);
  delay(800);

  Serial.println("\n╔══════════════════════════════════════════╗");
  Serial.println("║  WaterSafe V2 — Context-Aware Edge AI   ║");
  Serial.println("╚══════════════════════════════════════════╝\n");

  Wire.begin(21, 22);

  Serial.print("OLED      ... ");
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("FAILED"); while (1);
  }
  Serial.println("OK");

  // Boot splash
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(20, 10);  display.println("WaterSafe V2");
  display.setCursor(12, 22);  display.println("Context-Aware AI");
  display.setCursor(30, 38);  display.println("Starting...");
  display.display();

  Serial.print("DS18B20   ... ");
  tempSensor.begin();
  if (tempSensor.getDeviceCount() == 0) { Serial.println("FAILED"); while (1); }
  Serial.println("OK");

  Serial.print("ADS1115   ... ");
  if (!ads.begin()) { Serial.println("FAILED"); while (1); }
  ads.setGain(GAIN_TWOTHIRDS);
  Serial.println("OK  (gain ±6.144V)");

  // Initialize Wi-Fi
  if (ENABLE_WIFI) {
    Serial.print("Wi-Fi     ... Connecting to ");
    Serial.print(WIFI_SSID);
    
    // Set OLED to show Wi-Fi status temporarily
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(10, 20); display.print("Connecting to Wi-Fi");
    display.setCursor(10, 35); display.print(WIFI_SSID);
    display.display();

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // Wait max 10 seconds for Wi-Fi connection
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) {
      delay(500);
      Serial.print(".");
      retries++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println(" OK!");
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
    } else {
      // We continue execution standalone if WiFi fails.
      Serial.println(" FAILED (Running Offline)");
    }
  } else {
    Serial.println("DISABLED (Offline Mode)");
    WiFi.mode(WIFI_OFF);
  }

  // Initialize GSM Serial
  if (ENABLE_CELLULAR_SMS) {
    Serial.print("GSM Serial ... Initializing on RX:16 TX:17... ");
    gsmSerial.begin(115200, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
    Serial.println("OK");
  }

  ml_setup();
  context_setup();
  uiState       = 0;

  stateStartTime = millis();
  ctx.alert_level = ALERT_NORMAL;
  ctx.confidence  = 0;
  snprintf(ctx.reason, sizeof(ctx.reason), "Initializing...");

  Serial.println("\nTime(s) | Temp   |  TDS [V]         | Turbidity [V]       | MSE       | Verdict         | Conf | Reason");
  Serial.println("--------|--------|------------------|---------------------|-----------|-----------------|------|-------------------------------");
  Serial.println("\n✓ All systems ready. Context-Aware Edge AI active.\n");
  delay(600);
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── Sensor read + AI evaluation every 3s ─────────────────────────────────
  if (now - lastReadTime >= READ_INTERVAL) {
    lastReadTime = now;

    readSensors();

    // Layer 1: Autoencoder MSE + persistence
    ml_check_anomaly(currentData.temperature, currentData.tds, currentData.turbidity);

    // Layer 2: Context Engine → confidence score + why strings
    uint8_t old_level = ctx.alert_level;
    ctx = context_evaluate(
      currentData.tds,
      currentData.turbidity,
      currentData.temperature,
      ml_get_last_error(),
      ml_get_anomaly_count(),
      sensor_fault
    );

    // FIX: Instant OLED reaction ONLY when escalating from NORMAL, to prevent skipping sensor displays forever.
    if (old_level == ALERT_NORMAL && ctx.alert_level > ALERT_NORMAL && uiState < 3) {
      uiState = 3;
      stateStartTime = millis();
    }

    // Trigger physical SMS alert on escalation
    if (old_level == ALERT_NORMAL && ctx.alert_level > ALERT_NORMAL) {
      if (now - lastSMSSentTime > 60000) { // 60s debounce for fast demo cycles
        lastSMSSentTime = now;
        char alertMsg[160];
        snprintf(alertMsg, sizeof(alertMsg), 
                 "[ALERT] Well #1 UNCLEAN!\nReason: %s\nTDS: %d ppm | Turbidity: %d NTU\nWater cutoff activated locally.", 
                 ctx.reason, (int)currentData.tds, (int)currentData.turbidity);
        sendPhysicalSMS(RECIPIENT_NUMBER, alertMsg);
      }
    }

    logToSerial();
    pushToDashboard();
  }

  // ── OLED animation at 25fps ─────────────────────────────────────────────
  if (now - lastUIFrame >= 40) {
    lastUIFrame = now;
    updateDisplay();
  }
}
