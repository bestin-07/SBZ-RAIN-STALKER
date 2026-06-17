from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import httpx
import asyncio
import sqlite3
import json
import base64
import os
from datetime import datetime, timezone
from contextlib import asynccontextmanager

try:
    from pywebpush import webpush, WebPushException
    PUSH_AVAILABLE = True
except ImportError:
    PUSH_AVAILABLE = False
    print("[push] pywebpush not available — push notifications disabled")

POINTS = [
    {"name": "altstadt",   "lat": 47.7985, "lon": 13.0469},
    {"name": "bahnhof",    "lat": 47.8127, "lon": 13.0449},
    {"name": "lehen",      "lat": 47.8097, "lon": 13.0200},
    {"name": "schallmoos", "lat": 47.8190, "lon": 13.0600},
    {"name": "maxglan",    "lat": 47.7930, "lon": 13.0250},
]

DB_PATH = os.getenv("DB_PATH", "accuracy.db")
DRY_THRESHOLD = 0.1
VAPID_CONTACT = os.getenv("VAPID_CONTACT", "mailto:sbzrainstalker@example.com")

# VAPID keys — loaded at startup
VAPID_PRIVATE_KEY = None
VAPID_PUBLIC_KEY = None


# ---------------------------------------------------------------------------
# DB init
# ---------------------------------------------------------------------------

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forecasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            point_name TEXT NOT NULL,
            forecast_made_at INTEGER NOT NULL,
            target_time INTEGER NOT NULL,
            horizon_minutes INTEGER NOT NULL,
            predicted_precip REAL NOT NULL,
            actual_precip REAL,
            verified INTEGER DEFAULT 0
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_target ON forecasts(target_time, verified)")
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at REAL NOT NULL
        )
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# VAPID key management
# ---------------------------------------------------------------------------

def init_vapid():
    global VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY

    # Env vars take priority (set these on Railway after first deploy)
    env_priv = os.getenv("VAPID_PRIVATE_KEY")
    env_pub = os.getenv("VAPID_PUBLIC_KEY")
    if env_priv and env_pub:
        VAPID_PRIVATE_KEY = env_priv
        VAPID_PUBLIC_KEY = env_pub
        print("[vapid] Loaded from environment variables")
        return

    # Fall back to DB-persisted keys
    conn = sqlite3.connect(DB_PATH)
    priv_row = conn.execute("SELECT value FROM settings WHERE key='vapid_private_key'").fetchone()
    pub_row  = conn.execute("SELECT value FROM settings WHERE key='vapid_public_key'").fetchone()

    if priv_row and pub_row:
        VAPID_PRIVATE_KEY = priv_row[0]
        VAPID_PUBLIC_KEY  = pub_row[0]
        conn.close()
        print("[vapid] Loaded from database")
        return

    # Generate new keypair
    from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption
    )
    private_key = generate_private_key(SECP256R1())
    priv_pem = private_key.private_bytes(
        Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption()
    ).decode()
    pub_bytes = private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64   = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()

    VAPID_PRIVATE_KEY = priv_pem
    VAPID_PUBLIC_KEY  = pub_b64

    conn.execute("INSERT OR REPLACE INTO settings VALUES ('vapid_private_key', ?)", (priv_pem,))
    conn.execute("INSERT OR REPLACE INTO settings VALUES ('vapid_public_key',  ?)", (pub_b64,))
    conn.commit()
    conn.close()
    print(f"[vapid] Generated new keypair. Public key: {pub_b64[:20]}...")


# ---------------------------------------------------------------------------
# Push sending
# ---------------------------------------------------------------------------

def _send_push_sync(endpoint: str, p256dh: str, auth: str, payload: dict) -> bool:
    """Returns False if the subscription is expired/gone and should be deleted."""
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CONTACT},
            ttl=3600,
        )
        return True
    except WebPushException as e:
        if e.response is not None and e.response.status_code in (404, 410):
            return False  # Subscription expired
        print(f"[push] WebPushException: {e}")
        return True


async def push_to_all(payload: dict):
    if not PUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        return
    conn = sqlite3.connect(DB_PATH)
    subs = conn.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions").fetchall()
    conn.close()

    expired = []
    for endpoint, p256dh, auth in subs:
        ok = await asyncio.to_thread(_send_push_sync, endpoint, p256dh, auth, payload)
        if not ok:
            expired.append(endpoint)

    if expired:
        conn = sqlite3.connect(DB_PATH)
        for ep in expired:
            conn.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (ep,))
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# Forecast helpers
# ---------------------------------------------------------------------------

async def fetch_forecast_for_point(client: httpx.AsyncClient, point: dict) -> dict:
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": point["lat"], "longitude": point["lon"],
            "minutely_15": "precipitation",
            "forecast_minutely_15": 24,
            "timeformat": "unixtime", "timezone": "UTC",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


async def fetch_current_for_point(client: httpx.AsyncClient, point: dict):
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={"latitude": point["lat"], "longitude": point["lon"],
                "current": "precipitation", "timezone": "UTC"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("current", {}).get("precipitation")


# ---------------------------------------------------------------------------
# GeoSphere sources — mirror the frontend so push/accuracy use the same signal
# (1 km / 15-min radar nowcast for the timeline, TAWES for the live reading)
# instead of the lagging Open-Meteo model.
# ---------------------------------------------------------------------------

GEOSPHERE = "https://dataset.api.hub.geosphere.at/v1"
_tawes_stations = None  # cached list of (id, lat, lon) for the session


async def fetch_nowcast_timeline(client: httpx.AsyncClient, point: dict):
    """GeoSphere nowcast: 1 km / 15-min, +3 h. Returns (times[unix], precips[mm])."""
    r = await client.get(
        f"{GEOSPHERE}/timeseries/forecast/nowcast-v1-15min-1km",
        params={"parameters": "rr", "lat_lon": f"{point['lat']},{point['lon']}"},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    ts = data.get("timestamps", [])
    rr = data["features"][0]["properties"]["parameters"]["rr"]["data"]
    if not ts or len(ts) != len(rr):
        raise ValueError("unexpected nowcast response")
    times = [int(datetime.fromisoformat(s).timestamp()) for s in ts]
    precips = [float(v) if isinstance(v, (int, float)) else 0.0 for v in rr]
    return times, precips


def _haversine_km(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, atan2, sqrt
    r = radians
    dlat, dlon = r(lat2 - lat1), r(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(r(lat1)) * cos(r(lat2)) * sin(dlon / 2) ** 2
    return 6371 * 2 * atan2(sqrt(a), sqrt(1 - a))


async def _load_tawes_stations(client: httpx.AsyncClient):
    global _tawes_stations
    if _tawes_stations is not None:
        return _tawes_stations
    try:
        r = await client.get(f"{GEOSPHERE}/station/current/tawes-v1-10min/metadata", timeout=10)
        r.raise_for_status()
        out = []
        for s in r.json().get("stations", []):
            if s.get("is_active") is False:
                continue
            try:
                out.append((str(s["id"]), float(s["lat"]), float(s["lon"])))
            except (KeyError, TypeError, ValueError):
                continue
        _tawes_stations = out
    except Exception:
        _tawes_stations = []
    return _tawes_stations


async def fetch_tawes_precip(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
    """Max RR (mm, last 10 min) across the nearest active TAWES stations + airport anchor."""
    stations = await _load_tawes_stations(client)
    if stations:
        ids = [s[0] for s in sorted(stations, key=lambda s: _haversine_km(lat, lon, s[1], s[2]))[:n]]
    else:
        ids = ["11150"]
    if "11150" not in ids:
        ids.append("11150")
    r = await client.get(
        f"{GEOSPHERE}/station/current/tawes-v1-10min",
        params={"parameters": "RR", "station_ids": ",".join(ids)},
        timeout=10,
    )
    r.raise_for_status()
    vals = []
    for f in r.json().get("features", []):
        try:
            v = f["properties"]["parameters"]["RR"]["data"][0]
            if isinstance(v, (int, float)):
                vals.append(v)
        except (KeyError, IndexError, TypeError):
            continue
    return max(vals) if vals else None


async def fetch_timeline(client: httpx.AsyncClient, point: dict):
    """Prefer the GeoSphere nowcast; fall back to Open-Meteo minutely_15."""
    try:
        return await fetch_nowcast_timeline(client, point)
    except Exception:
        data = await fetch_forecast_for_point(client, point)
        return (data.get("minutely_15", {}).get("time", []),
                data.get("minutely_15", {}).get("precipitation", []))


async def fetch_now_precip(client: httpx.AsyncClient, point: dict):
    """Live 'now' precip: TAWES (actual obs) with Open-Meteo current as fallback."""
    try:
        v = await fetch_tawes_precip(client, point["lat"], point["lon"])
        if v is not None:
            return v
    except Exception:
        pass
    try:
        return await fetch_current_for_point(client, point) or 0
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Push notification logic
# ---------------------------------------------------------------------------

def _analyze_forecast(times, precips, now_ts):
    """
    Returns a push event dict or None.

    Gap opening:   currently raining, dry window ≥10 min starts within 15 min
    Rain incoming: currently dry, rain starts within 30 min
    """
    slots = sorted(zip(times, precips), key=lambda s: s[0])

    # Current condition — slot closest to now
    current = min(slots, key=lambda s: abs(s[0] - now_ts), default=None)
    if current is None:
        return None
    is_raining = current[1] >= DRY_THRESHOLD

    if is_raining:
        # Look for a dry gap starting within the next 15 min
        window = [(t, p) for t, p in slots if now_ts < t <= now_ts + 15 * 60]
        for gap_t, p in window:
            if p < DRY_THRESHOLD:
                gap_in_min = max(0, round((gap_t - now_ts) / 60))
                # Measure how long the gap lasts (consecutive dry slots)
                gap_slots = sum(
                    1 for t2, p2 in slots if t2 >= gap_t and p2 < DRY_THRESHOLD
                    and t2 < next(
                        (t3 for t3, p3 in slots if t3 > gap_t and p3 >= DRY_THRESHOLD),
                        gap_t + 99999
                    )
                )
                gap_min = gap_slots * 15
                if gap_min >= 10:
                    return {"type": "gap", "gap_in_min": gap_in_min, "gap_min": gap_min}
    else:
        # Look for rain starting within the next 30 min
        window = [(t, p) for t, p in slots if now_ts < t <= now_ts + 30 * 60]
        for rain_t, p in window:
            if p >= DRY_THRESHOLD:
                rain_in_min = max(0, round((rain_t - now_ts) / 60))
                return {"type": "rain_incoming", "rain_in_min": rain_in_min}

    return None


def _cooldown_ok(conn, key: str, seconds: int, now_ts: int) -> bool:
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return (now_ts - float(row[0])) >= seconds if row else True


def _build_payload(event: dict) -> dict:
    """Build a bilingual push payload — service worker picks language via navigator.language."""
    t = event["type"]
    if t == "gap":
        x, y = event["gap_in_min"], event["gap_min"]
        if x == 0:
            return {
                "type": "gap",
                "title_de": "Jetzt trocken",
                "body_de":  f"{y} Minuten Fenster — rausgehen!",
                "title_en": "Dry now",
                "body_en":  f"{y} minute window — go!",
            }
        return {
            "type": "gap",
            "title_de": f"Lücke in {x} Min.",
            "body_de":  f"{y} Minuten trocken — bereit machen",
            "title_en": f"Gap in {x} min",
            "body_en":  f"{y} minutes dry — get ready",
        }
    if t == "rain_incoming":
        x = event["rain_in_min"]
        if x <= 5:
            return {
                "type": "rain",
                "title_de": "Regen kommt gleich",
                "body_de":  "Jetzt noch schnell reinkommen",
                "title_en": "Rain arriving now",
                "body_en":  "Head inside soon",
            }
        return {
            "type": "rain",
            "title_de": f"Regen in {x} Min.",
            "body_de":  "Schnell noch raus oder drin bleiben",
            "title_en": f"Rain in {x} min",
            "body_en":  "Get out now or stay in",
        }
    return {}


async def check_and_push(client: httpx.AsyncClient, now_ts: int):
    # Gather data from all monitoring points using the same signal as the app:
    # the GeoSphere radar nowcast, anchored with a live TAWES "now" reading.
    events = []
    for point in POINTS:
        try:
            times, precips = await fetch_timeline(client, point)
            now_precip = await fetch_now_precip(client, point)
            times   = [now_ts] + list(times)
            precips = [now_precip] + list(precips)
            ev = _analyze_forecast(times, precips, now_ts)
            if ev:
                events.append(ev)
        except Exception as e:
            print(f"[push] {point['name']}: {e}")

    if not events:
        return

    conn = sqlite3.connect(DB_PATH)

    # Prioritise gap notifications over rain warnings
    gap_events  = [e for e in events if e["type"] == "gap"]
    rain_events = [e for e in events if e["type"] == "rain_incoming"]

    sent = False

    if gap_events and _cooldown_ok(conn, "last_gap_push_ts", 45 * 60, now_ts):
        # Use the soonest gap across all points
        best = min(gap_events, key=lambda e: e["gap_in_min"])
        await push_to_all(_build_payload(best))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('last_gap_push_ts', ?)", (str(float(now_ts)),))
        sent = True

    if not sent and rain_events and _cooldown_ok(conn, "last_rain_push_ts", 60 * 60, now_ts):
        best = min(rain_events, key=lambda e: e["rain_in_min"])
        await push_to_all(_build_payload(best))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('last_rain_push_ts', ?)", (str(float(now_ts)),))
        sent = True

    if sent:
        conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Main scheduler
# ---------------------------------------------------------------------------

async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    conn = sqlite3.connect(DB_PATH)

    async with httpx.AsyncClient() as client:
        # Store new accuracy forecasts from the radar nowcast (same as the app)
        for point in POINTS:
            try:
                times, precips = await fetch_timeline(client, point)

                for horizon in [30, 60, 90]:
                    target_ts = now_ts + horizon * 60
                    best_idx = min(range(len(times)), key=lambda i: abs(times[i] - target_ts), default=None)
                    if best_idx is not None:
                        conn.execute(
                            "INSERT INTO forecasts (point_name, forecast_made_at, target_time, horizon_minutes, predicted_precip) VALUES (?,?,?,?,?)",
                            (point["name"], now_ts, target_ts, horizon, precips[best_idx]),
                        )
            except Exception as e:
                print(f"[cycle] forecast failed for {point['name']}: {e}")

        conn.commit()

        # Verify past forecasts
        rows = conn.execute(
            "SELECT id, point_name FROM forecasts WHERE verified=0 AND target_time < ?",
            (now_ts - 120,),
        ).fetchall()

        for row_id, point_name in rows:
            point = next((p for p in POINTS if p["name"] == point_name), None)
            if not point:
                continue
            try:
                actual = await fetch_now_precip(client, point)  # TAWES actual obs
                conn.execute(
                    "UPDATE forecasts SET actual_precip=?, verified=1 WHERE id=?",
                    (actual, row_id),
                )
            except Exception as e:
                print(f"[cycle] verify failed for {point_name}: {e}")

        conn.commit()
        conn.close()

        # Push notifications
        await check_and_push(client, now_ts)


async def scheduler():
    while True:
        try:
            await run_cycle()
        except Exception as e:
            print(f"[scheduler] error: {e}")
        await asyncio.sleep(300)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        init_vapid()
    except Exception as e:
        print(f"[vapid] init failed (push notifications disabled): {e}")
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/vapid-public-key")
def get_vapid_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.post("/api/subscribe")
async def subscribe(request: Request):
    body = await request.json()
    endpoint = body.get("endpoint")
    p256dh   = body.get("keys", {}).get("p256dh")
    auth     = body.get("keys", {}).get("auth")

    if not endpoint or not p256dh or not auth:
        return JSONResponse({"error": "invalid subscription"}, status_code=400)

    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?)",
        (endpoint, p256dh, auth, datetime.now(timezone.utc).timestamp()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/subscribe")
async def unsubscribe(request: Request):
    body = await request.json()
    endpoint = body.get("endpoint")
    if endpoint:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))
        conn.commit()
        conn.close()
    return {"ok": True}


@app.get("/api/accuracy")
def get_accuracy():
    conn = sqlite3.connect(DB_PATH)
    cutoff = int(datetime.now(timezone.utc).timestamp()) - 7 * 86400
    result = {}

    for horizon in [30, 60, 90]:
        row = conn.execute(
            """
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN (predicted_precip < ? AND actual_precip < ?) OR
                                 (predicted_precip >= ? AND actual_precip >= ?)
                            THEN 1 ELSE 0 END) as correct
            FROM forecasts
            WHERE verified=1 AND horizon_minutes=? AND forecast_made_at > ?
            """,
            (DRY_THRESHOLD, DRY_THRESHOLD, DRY_THRESHOLD, DRY_THRESHOLD, horizon, cutoff),
        ).fetchone()
        total, correct = row
        result[f"{horizon}min"] = {
            "total": total or 0,
            "correct": correct or 0,
            "accuracy": round(correct / total * 100, 1) if total and total > 0 else None,
        }

    conn.close()
    return result


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/vapid-keys")
def get_vapid_keys():
    """One-time use: copy these into Railway env vars, then you can remove this endpoint."""
    return {
        "VAPID_PUBLIC_KEY":  VAPID_PUBLIC_KEY,
        "VAPID_PRIVATE_KEY": VAPID_PRIVATE_KEY,
        "note": "Add both as Railway env vars, then delete this endpoint from main.py",
    }


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
