# 📋 Pitch-Ready Setup: From Scratch to Live Vercel Dashboard

This detailed guide outlines the exact steps to bring the WaterSafe V2 system live starting with **no terminals open, no servers running, and a fresh laptop boot**.

---

## ⚡ Setup Phase: Flash the Hardware (Done Once)
If your ESP32 already has the latest code flashed, skip to **Live Pitch Phase**. Otherwise, do this once:

1. **Connect the ESP32** to your laptop using a micro-USB cable.
2. Open VS Code in `d:\watersafeV2\firmware`.
3. Open [main.cpp](file:///d:/watersafeV2/firmware/src/main.cpp#L45-L50) and verify:
   - Wi-Fi SSID and Password match your mobile hotspot (e.g. `ga14` / `meow123321`).
   - `API_ENDPOINT` is set to `"https://watersafe-frontend.vercel.app/api/ingest"`.
4. Click the **PlatformIO: Upload** arrow icon in the VS Code bottom status bar to flash the code onto the ESP32.

---

## 🚀 Live Pitch Phase: The Step-by-Step Flow (Start Here)

Follow these steps when starting the demo for judges:

### Step 1: Open Your Hotspot
- Turn on your mobile phone's hotspot with the credentials matching your code (SSID: `ga14`, Password: `meow123321`).

### Step 2: Power up the ESP32
- Plug the ESP32 into a USB power bank or your laptop. 
- It will automatically connect to your hotspot and start trying to send data. *Note: Since your local server is not running yet, it will log 502/Failed errors on the Serial Monitor — this is expected until Step 5.*

### Step 3: Start your Laptop Backend Server
1. Open a terminal on your laptop and navigate to the project directory:
   ```bash
   cd d:\watersafeV2\web-dashboard
   ```
2. Start the local server:
   ```bash
   npm start
   ```
   *You will see: "WaterSafe V2 Server running on port 3000". Keep this terminal open!*

### Step 4: Expose your Server to the Internet (localtunnel)
1. Open a **second** terminal window.
2. Expose local port 3000 by running this command:
   ```bash
   npx localtunnel --port 3000
   ```
3. Copy the public link it prints to your console. For example:
   `your url is: https://fluffy-deer-camp.loca.lt`
   *Keep this terminal open! If you close it, the tunnel breaks.*

### Step 5: Update the Vercel Proxy Destination
1. Open [vercel.json](file:///d:/watersafeV2/web-dashboard/vercel.json).
2. Update the `destination` URL on line 6 to match your new localtunnel link:
   ```json
   {
     "cleanUrls": true,
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://fluffy-deer-camp.loca.lt/api/:path*"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
3. Open a **third** terminal window in `d:\watersafeV2\web-dashboard` and deploy the update:
   ```bash
   npx vercel --prod
   ```
   *This links the Vercel site to your laptop's backend in 10-15 seconds.*

---

## 🔍 Verification & Diagnostics

Once deployed:
1. Check the ESP32 Serial Monitor: it should print `[☁️] Cloud Push OK: 200`. (If you see `502`, your Vercel deployment didn't finish or the URL in `vercel.json` has a typo).
2. Open the React frontend locally to test:
   - Run `npm run dev` in a terminal.
   - Open the link `http://localhost:5173`. You should see live, changing numbers updating every 3 seconds!
3. Open the **live URL** on the judge's phone (or your phone):
   `https://watersafe-frontend.vercel.app`
   - It will update in real-time from the ESP32, and you can walk away from your laptop to pitch!
