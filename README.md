# SBZ Rain Stalker

Tells you when to step outside in Salzburg without getting rained on. Finds gaps in the rain at your exact GPS location, shows a live radar map, and tracks how accurate the forecast actually was after the fact.

---

## How it works

The frontend hits Open-Meteo directly for a 15-minute resolution precipitation forecast at your coordinates. It scans the next 3 hours for dry windows (below 0.1mm per 15min slot, minimum 30 minutes long) and shows you the result as one clear sentence: GO NOW, WAIT 8 MIN, or STUCK INSIDE.

The radar map pulls animated tiles from RainViewer showing the past 2 hours and the next 30 minutes of extrapolated radar.

The backend runs every 5 minutes, stores what the forecast predicted for 5 fixed Salzburg locations at 30, 60, and 90 minute horizons, then checks the actual observed precipitation when those times arrive. This builds a real accuracy score over time so you know whether to trust the data.

---

## Run locally

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
Opens at localhost:5173. Works without the backend — accuracy badge just won't appear.

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```
Runs at localhost:8000. Creates accuracy.db in the backend folder.

To connect them locally, create `frontend/.env` with:
```
VITE_BACKEND_URL=http://localhost:8000
```

---

## Deploy on Railway

1. Create a Railway project
2. Add two services, one pointing at `/backend` and one at `/frontend`
3. Both folders have a `railway.toml` that handles the build and start commands
4. On the frontend service, add an environment variable: `VITE_BACKEND_URL=https://your-backend-service.railway.app`
5. The backend writes `accuracy.db` to the working directory — add a Railway volume at `/app` if you want it to survive redeploys

---

## What to do next

**Right now**
- Deploy to Railway using the steps above
- Buy a domain and point it at the frontend service
- Open the app on your phone, tap Add to Home Screen — it installs as a PWA

**Stage 2**
- Add push notifications: when your next dry window is 5 minutes away, the app notifies you
- This needs a service worker and a notification permission flow on the frontend, plus a push endpoint on the backend

**Stage 3**
- Swap Open-Meteo for GeoSphere Austria radar data directly — higher resolution, Austria-specific quality control, updates every 5 minutes instead of 15
- This improves gap detection accuracy significantly for Salzburg specifically because the Alpine terrain causes issues with global models

**Stage 4**
- Native iOS and Android apps via React Native, reusing the same backend API
- The PWA is good enough for most people but App Store presence helps discoverability

**Stage 5**
- Expand beyond Salzburg to any Austrian city, then any European city with OPERA radar coverage
- The backend already abstracts location as fixed monitoring points, so it scales by adding more points
