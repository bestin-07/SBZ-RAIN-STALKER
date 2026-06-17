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
    from pywebpush import webpush, WebPushException
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
    if not VAPID_PRIVATE_KEY:
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
# Gap push logic
# ---------------------------------------------------------------------------

def _find_gap_soon(times, precips, now_ts, window_sec=45 * 60):
    """If currently raining and a dry slot opens in the next window_sec, return minutes until it."""
    slotpairs = list(zip(times, precips))
    current = next((p for t, p in slotpairs if t >= now_ts - 300), None)
    if current is None or current < DRY_THRESHOLD:
        return None  # Already dry or no data
    for t, p in slotpairs:
        if now_ts < t <= now_ts + window_sec and p < DRY_THRESHOLD:
            return max(0, round((t - now_ts) / 60))
    return None


async def check_and_push(client: httpx.AsyncClient, now_ts: int):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT value FROM settings WHERE key='last_gap_push_ts'").fetchone()
    conn.close()

    last_push = float(row[0]) if row else 0
    if now_ts - last_push < 3600:  # max one push per hour
        return

    # Check if any monitoring point has a gap opening soon
    for point in POINTS:
        try:
            data = await fetch_forecast_for_point(client, point)
            times  = data.get("minutely_15", {}).get("time", [])
            precips = data.get("minutely_15", {}).get("precipitation", [])
            gap_in = _find_gap_soon(times, precips, now_ts)
            if gap_in is not None:
                body = (
                    f"In {gap_in} Min. wird es trocken bei {point['name']}. Jetzt loslegen!"
                    if gap_in > 0 else
                    "Regen hat gerade aufgehört. Jetzt rausgehen!"
                )
                await push_to_all({"title": "Regenluecke", "body": body})
                conn = sqlite3.connect(DB_PATH)
                conn.execute(
                    "INSERT OR REPLACE INTO settings VALUES ('last_gap_push_ts', ?)",
                    (str(float(now_ts)),)
                )
                conn.commit()
                conn.close()
                return
        except Exception as e:
            print(f"[push check] {point['name']}: {e}")


# ---------------------------------------------------------------------------
# Main scheduler
# ---------------------------------------------------------------------------

async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    conn = sqlite3.connect(DB_PATH)

    async with httpx.AsyncClient() as client:
        # Store new accuracy forecasts
        for point in POINTS:
            try:
                data = await fetch_forecast_for_point(client, point)
                times   = data.get("minutely_15", {}).get("time", [])
                precips = data.get("minutely_15", {}).get("precipitation", [])

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
                actual = await fetch_current_for_point(client, point)
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
    init_vapid()
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
