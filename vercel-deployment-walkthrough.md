# Operator Guide: Hackathon Deployment & Quick Redo

This guide explains how to set up, deploy, and quickly reset your WaterSafe V2 dashboard connection during hackathon rounds.

---

## 🚀 Step 1: Deploy the Frontend to Vercel (Done Once)

1. Open your terminal and navigate to the frontend directory:
   ```bash
   cd d:\watersafeV2\web-dashboard
   ```
2. Install the Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```
3. Deploy to Vercel:
   ```bash
   vercel
   ```
   * Follow the prompts to log in (free account) and set up the project (e.g., project name: `watersafe`).
   * Once setup completes, Vercel will give you a **Project URL** (e.g., `https://watersafe.vercel.app`).
4. Note your Vercel URL! This is your permanent link for the judges.

---

## 🔌 Step 2: Flash the ESP32 (Done Once)

Now that you have your permanent Vercel URL, configure the hardware to send data there.

1. Open [main.cpp](file:///d:/watersafeV2/firmware/src/main.cpp) and update `API_ENDPOINT` on line 50 with your Vercel domain:
   ```cpp
   const char* API_ENDPOINT  = "https://watersafe.vercel.app/api/ingest";
   ```
2. If the Wi-Fi credentials in the hall are different, update lines 46-47:
   ```cpp
   const char* WIFI_SSID     = "Your_Hall_WiFi_SSID";
   const char* WIFI_PASSWORD = "WiFi_Password";
   ```
3. Flash the firmware:
   ```bash
   cd d:\watersafeV2\firmware
   pio run --target upload
   ```
   *The ESP32 is now locked in to the Vercel domain. You will not need to re-flash the hardware again when the tunnel changes!*

---

## 🛠️ Step 3: Run the Local Backend & Expose It (Done at Pitch Time)

Before the judges arrive, run your local Node.js server and open a public tunnel.

1. Start your local Node.js server:
   ```bash
   cd d:\watersafeV2\web-dashboard
   npm run start
   ```
   *Your backend is now running locally on port `3000`.*
2. Open a new terminal and run a tunnel. We recommend **Pinggy** because it is completely free, does not require an account, and has no warning pages (unlike localtunnel):
   ```bash
   ssh -R 80:localhost:3000 a.pinggy.io
   ```
   * This will output a public URL in your terminal (e.g., `https://rxxxx.pinggy.link`). Note this URL!
   * *Alternative (Localtunnel):* `npx localtunnel --port 3000`

---

## ⚡ Step 4: Map Vercel to Your Tunnel (Takes 15 Seconds)

Whenever your local tunnel URL changes (e.g., laptop sleep, restarted command, new Wi-Fi hall):

1. Open [vercel.json](file:///d:/watersafeV2/web-dashboard/vercel.json).
2. Update the `destination` URL under `rewrites` to match your current tunnel URL:
   ```json
   {
     "cleanUrls": true,
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://rxxxx.pinggy.link/api/:path*"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
3. Deploy this update instantly to production:
   ```bash
   vercel --prod
   ```
   *The proxy is updated in 10-15 seconds. Data will start flowing instantly to the judges' mobile screens!*

---

## 📋 Emergency Checklists

### "Everything was working but we moved to a new hall!"
1. Update Wi-Fi SSID and Password in [main.cpp](file:///d:/watersafeV2/firmware/src/main.cpp).
2. Re-flash the ESP32.
3. Start the server: `npm run start`.
4. Start the tunnel: `ssh -R 80:localhost:3000 a.pinggy.io`.
5. Update `vercel.json` destination with the new tunnel URL and run `vercel --prod`.

### "My laptop shut down/went to sleep!"
1. Wake up the laptop, verify the ESP32 is powered.
2. Restart the Node server and the SSH tunnel.
3. Update `vercel.json` destination with the new tunnel URL and run `vercel --prod`.
