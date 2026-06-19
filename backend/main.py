from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from contextlib import contextmanager, asynccontextmanager
import psycopg2
import psycopg2.pool
import httpx
import asyncio
import json
import base64
import os
import re
import uuid
import secrets
from datetime import datetime, timezone

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

DRY_THRESHOLD = 0.1
VAPID_CONTACT = os.getenv("VAPID_CONTACT", "mailto:gemmaraus@example.com")
MAX_PUSH_SUBS = 50_000
PRUNE_DAYS    = 8

_PUSH_ORIGIN_RE = re.compile(
    r'^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
    r'[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.apple\.com|'
    r'[a-z0-9-]+\.mozilla\.com)/'
)

VAPID_PRIVATE_KEY: str | None = None
VAPID_PUBLIC_KEY:  str | None = None

_db_pool: psycopg2.pool.ThreadedConnectionPool | None = None


# ---------------------------------------------------------------------------
# DB connection pool
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    """Yield (conn, cursor). Auto-commits on clean exit, rolls back on error."""
    conn = _db_pool.getconn()
    try:
        with conn.cursor() as cur:
            yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _db_pool.putconn(conn)


def init_db():
    global _db_pool
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set — add a PostgreSQL service on Railway "
            "and link it to this service"
        )
    _db_pool = psycopg2.pool.ThreadedConnectionPool(1, 10, dsn=db_url)

    with get_db() as (_, cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS forecasts (
                id               BIGSERIAL PRIMARY KEY,
                point_name       TEXT             NOT NULL,
                forecast_made_at BIGINT           NOT NULL,
                target_time      BIGINT           NOT NULL,
                horizon_minutes  INTEGER          NOT NULL,
                predicted_precip DOUBLE PRECISION NOT NULL,
                actual_precip    DOUBLE PRECISION,
                verified         INTEGER          DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_target
            ON forecasts (target_time, verified)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint   TEXT             PRIMARY KEY,
                p256dh     TEXT             NOT NULL,
                auth       TEXT             NOT NULL,
                token      TEXT             NOT NULL DEFAULT '',
                created_at DOUBLE PRECISION NOT NULL
            )
        """)

    # Parse host from URL for the log (mask credentials)
    try:
        host = db_url.split("@")[-1].split("/")[0]
    except Exception:
        host = "unknown"
    print(f"[db] PostgreSQL connected → {host}")


# ---------------------------------------------------------------------------
# VAPID key management
# ---------------------------------------------------------------------------

def _prepare_vapid_private(priv_str: str):
    """Accept PEM or base64url-DER; return (base64url_DER_PKCS8, derived_pub_b64).
    pywebpush requires base64url-DER, not PEM."""
    from cryptography.hazmat.primitives.serialization import (
        load_pem_private_key, load_der_private_key,
        Encoding, PublicFormat, PrivateFormat, NoEncryption,
    )
    s = (priv_str or "").strip()
    if "BEGIN" in s:
        key = load_pem_private_key(s.encode(), password=None)
    else:
        raw = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
        key = load_der_private_key(raw, password=None)
    der     = key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    priv_b64 = base64.urlsafe_b64encode(der).rstrip(b"=").decode()
    pub     = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64  = base64.urlsafe_b64encode(pub).rstrip(b"=").decode()
    return priv_b64, pub_b64


def init_vapid():
    global VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY

    env_priv = os.getenv("VAPID_PRIVATE_KEY")
    env_pub  = os.getenv("VAPID_PUBLIC_KEY")
    if env_priv and env_pub:
        VAPID_PUBLIC_KEY = env_pub
        try:
            priv_b64, derived_pub = _prepare_vapid_private(env_priv)
            VAPID_PRIVATE_KEY = priv_b64
            if derived_pub != env_pub.rstrip("="):
                print("[vapid] *** WARNING: public key does NOT match private key — push will fail")
            else:
                print("[vapid] Loaded from env (pair verified ✓)")
        except Exception as e:
            VAPID_PRIVATE_KEY = env_priv
            print(f"[vapid] *** Could not parse private key — push will fail: {e}")
        return

    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'vapid_private_key'")
        priv_row = cur.fetchone()
        cur.execute("SELECT value FROM settings WHERE key = 'vapid_public_key'")
        pub_row = cur.fetchone()

    if priv_row and pub_row:
        VAPID_PUBLIC_KEY = pub_row[0]
        try:
            VAPID_PRIVATE_KEY, _ = _prepare_vapid_private(priv_row[0])
        except Exception:
            VAPID_PRIVATE_KEY = priv_row[0]
        print("[vapid] Loaded from database")
        return

    # Generate a fresh keypair and persist it
    from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption,
    )
    private_key = generate_private_key(SECP256R1())
    der      = private_key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    priv_b64 = base64.urlsafe_b64encode(der).rstrip(b"=").decode()
    pub_b64  = base64.urlsafe_b64encode(
        private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    ).rstrip(b"=").decode()

    VAPID_PRIVATE_KEY = priv_b64
    VAPID_PUBLIC_KEY  = pub_b64

    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('vapid_private_key', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (priv_b64,),
        )
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('vapid_public_key', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (pub_b64,),
        )
    print(f"[vapid] Generated new keypair — public key: {pub_b64[:20]}…")


# ---------------------------------------------------------------------------
# Push sending
# ---------------------------------------------------------------------------

def _send_push_sync(endpoint: str, p256dh: str, auth: str, payload: dict) -> bool:
    """Returns False if the subscription is expired/gone (should be deleted)."""
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
            return False  # subscription expired
        print(f"[push] WebPushException: {e}")
        return True
    except Exception as e:
        print(f"[push] send error: {e}")
        return True


async def push_to_all(payload: dict):
    if not PUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        return

    with get_db() as (_, cur):
        cur.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions LIMIT %s",
            (MAX_PUSH_SUBS,),
        )
        subs = cur.fetchall()

    expired = []
    for endpoint, p256dh, auth in subs:
        ok = await asyncio.to_thread(_send_push_sync, endpoint, p256dh, auth, payload)
        if not ok:
            expired.append(endpoint)

    if expired:
        with get_db() as (_, cur):
            cur.execute(
                "DELETE FROM push_subscriptions WHERE endpoint = ANY(%s)",
                (expired,),
            )


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
# GeoSphere sources
# ---------------------------------------------------------------------------

GEOSPHERE = "https://dataset.api.hub.geosphere.at/v1"
_tawes_stations = None


async def fetch_nowcast_timeline(client: httpx.AsyncClient, point: dict):
    r = await client.get(
        f"{GEOSPHERE}/timeseries/forecast/nowcast-v1-15min-1km",
        params={"parameters": "rr", "lat_lon": f"{point['lat']},{point['lon']}"},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    ts   = data.get("timestamps", [])
    rr   = data["features"][0]["properties"]["parameters"]["rr"]["data"]
    if not ts or len(ts) != len(rr):
        raise ValueError("unexpected nowcast response")
    times   = [int(datetime.fromisoformat(s).timestamp()) for s in ts]
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
        for s in r.json().get("stations", [])[:500]:
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
    try:
        return await fetch_nowcast_timeline(client, point)
    except Exception:
        data = await fetch_forecast_for_point(client, point)
        return (data.get("minutely_15", {}).get("time", []),
                data.get("minutely_15", {}).get("precipitation", []))


async def fetch_now_precip(client: httpx.AsyncClient, point: dict):
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
    slots   = sorted(zip(times, precips), key=lambda s: s[0])
    current = min(slots, key=lambda s: abs(s[0] - now_ts), default=None)
    if current is None:
        return None
    is_raining = current[1] >= DRY_THRESHOLD

    if is_raining:
        window = [(t, p) for t, p in slots if now_ts < t <= now_ts + 15 * 60]
        for gap_t, p in window:
            if p < DRY_THRESHOLD:
                gap_in_min = max(0, round((gap_t - now_ts) / 60))
                gap_slots  = sum(
                    1 for t2, p2 in slots if t2 >= gap_t and p2 < DRY_THRESHOLD
                    and t2 < next(
                        (t3 for t3, p3 in slots if t3 > gap_t and p3 >= DRY_THRESHOLD),
                        gap_t + 99999,
                    )
                )
                if gap_slots * 15 >= 10:
                    return {"type": "gap", "gap_in_min": gap_in_min, "gap_min": gap_slots * 15}
    else:
        window = [(t, p) for t, p in slots if now_ts < t <= now_ts + 30 * 60]
        for rain_t, p in window:
            if p >= DRY_THRESHOLD:
                return {"type": "rain_incoming",
                        "rain_in_min": max(0, round((rain_t - now_ts) / 60))}

    return None


def _cooldown_ok(key: str, seconds: int, now_ts: int) -> bool:
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return (now_ts - float(row[0])) >= seconds if row else True


def _build_payload(event: dict) -> dict:
    t = event["type"]
    if t == "gap":
        x, y = int(event["gap_in_min"]), int(event["gap_min"])
        if x == 0:
            return {"type": "gap",
                    "title_de": "Jetzt trocken",    "body_de": f"{y} Minuten Fenster — rausgehen!",
                    "title_en": "Dry now",           "body_en": f"{y} minute window — go!"}
        return {"type": "gap",
                "title_de": f"Lücke in {x} Min.",  "body_de": f"{y} Minuten trocken — bereit machen",
                "title_en": f"Gap in {x} min",      "body_en": f"{y} minutes dry — get ready"}
    if t == "rain_incoming":
        x = int(event["rain_in_min"])
        if x <= 5:
            return {"type": "rain",
                    "title_de": "Regen kommt gleich", "body_de": "Jetzt noch schnell reinkommen",
                    "title_en": "Rain arriving now",   "body_en": "Head inside soon"}
        return {"type": "rain",
                "title_de": f"Regen in {x} Min.",   "body_de": "Schnell noch raus oder drin bleiben",
                "title_en": f"Rain in {x} min",      "body_en": "Get out now or stay in"}
    return {}


async def check_and_push(client: httpx.AsyncClient, now_ts: int):
    events = []
    for point in POINTS:
        try:
            times, precips = await fetch_timeline(client, point)
            now_precip     = await fetch_now_precip(client, point)
            ev = _analyze_forecast([now_ts] + list(times), [now_precip] + list(precips), now_ts)
            if ev:
                events.append(ev)
        except Exception as e:
            print(f"[push] {point['name']}: {e}")

    if not events:
        return

    gap_events  = [e for e in events if e["type"] == "gap"]
    rain_events = [e for e in events if e["type"] == "rain_incoming"]
    sent = False

    if gap_events and _cooldown_ok("last_gap_push_ts", 45 * 60, now_ts):
        best = min(gap_events, key=lambda e: e["gap_in_min"])
        await push_to_all(_build_payload(best))
        with get_db() as (_, cur):
            cur.execute(
                "INSERT INTO settings (key, value) VALUES ('last_gap_push_ts', %s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (str(float(now_ts)),),
            )
        sent = True

    if not sent and rain_events and _cooldown_ok("last_rain_push_ts", 60 * 60, now_ts):
        best = min(rain_events, key=lambda e: e["rain_in_min"])
        await push_to_all(_build_payload(best))
        with get_db() as (_, cur):
            cur.execute(
                "INSERT INTO settings (key, value) VALUES ('last_rain_push_ts', %s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (str(float(now_ts)),),
            )


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())

    async with httpx.AsyncClient() as client:
        # Store new forecasts for all points × horizons
        forecast_rows = []
        for point in POINTS:
            try:
                times, precips = await fetch_timeline(client, point)
                for horizon in [30, 60, 90]:
                    target_ts = now_ts + horizon * 60
                    best_idx  = min(range(len(times)), key=lambda i: abs(times[i] - target_ts), default=None)
                    if best_idx is not None:
                        forecast_rows.append(
                            (point["name"], now_ts, target_ts, horizon, precips[best_idx])
                        )
            except Exception as e:
                print(f"[cycle] forecast {point['name']}: {e}")

        if forecast_rows:
            with get_db() as (_, cur):
                cur.executemany(
                    "INSERT INTO forecasts"
                    " (point_name, forecast_made_at, target_time, horizon_minutes, predicted_precip)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    forecast_rows,
                )

        # Verify past predictions whose target time has passed
        with get_db() as (_, cur):
            cur.execute(
                "SELECT id, point_name FROM forecasts"
                " WHERE verified = 0 AND target_time < %s",
                (now_ts - 120,),
            )
            rows = cur.fetchall()

        for row_id, point_name in rows:
            point = next((p for p in POINTS if p["name"] == point_name), None)
            if not point:
                continue
            try:
                actual = await fetch_now_precip(client, point)
                with get_db() as (_, cur):
                    cur.execute(
                        "UPDATE forecasts SET actual_precip = %s, verified = 1 WHERE id = %s",
                        (actual, row_id),
                    )
            except Exception as e:
                print(f"[cycle] verify {point_name}: {e}")

        # Prune forecast rows older than PRUNE_DAYS
        cutoff = now_ts - PRUNE_DAYS * 86400
        with get_db() as (_, cur):
            cur.execute("DELETE FROM forecasts WHERE forecast_made_at < %s", (cutoff,))

        # Prune push subscriptions inactive for 90 days (as stated in privacy policy)
        sub_cutoff = now_ts - 90 * 86400
        with get_db() as (_, cur):
            cur.execute("DELETE FROM push_subscriptions WHERE created_at < %s", (sub_cutoff,))

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
    if _db_pool:
        _db_pool.closeall()


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(lifespan=lifespan, debug=False)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    print(f"[error] {request.method} {request.url.path}: {exc}")
    return JSONResponse({"error": "internal error"}, status_code=500)


# CORS — same-origin in prod; open for localhost dev
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if not _allowed_origins:
    _allowed_origins = ["http://localhost:5173", "http://localhost:4173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


# Canonical-host redirect: non-canonical gemmaraus.* hosts → www.gemmaraus.at (301)
# Set CANONICAL_HOST=www.gemmaraus.at to activate. ACME challenge paths are exempt.
CANONICAL_HOST = os.getenv("CANONICAL_HOST", "").strip().lower()


@app.middleware("http")
async def canonical_redirect(request: Request, call_next):
    if CANONICAL_HOST:
        host   = (request.headers.get("host") or "").split(":")[0].lower()
        is_acme = request.url.path.startswith("/.well-known/acme-challenge/")
        if host and host != CANONICAL_HOST and "gemmaraus" in host and not is_acme:
            target = request.url.replace(netloc=CANONICAL_HOST, scheme="https")
            return RedirectResponse(str(target), status_code=301)
    return await call_next(request)


# Security headers on every response
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]   = "nosniff"
    response.headers["X-Frame-Options"]           = "DENY"
    response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]        = "geolocation=(self), camera=(), microphone=()"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["Content-Security-Policy"]   = (
        "default-src 'self'; "
        "script-src 'self' 'wasm-unsafe-eval'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob: "
        "https://*.basemaps.cartocdn.com "
        "https://tilecache.rainviewer.com https://*.rainviewer.com "
        "https://*.tile.openstreetmap.org; "
        "connect-src 'self' "
        "https://api.open-meteo.com "
        "https://dataset.api.hub.geosphere.at "
        "https://api.rainviewer.com; "
        "worker-src 'self' blob:; "
        "manifest-src 'self'; "
        "frame-ancestors 'none';"
    )
    return response


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/vapid-public-key")
def get_vapid_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.post("/api/subscribe")
@limiter.limit("30/minute")
async def subscribe(request: Request):
    content_length = int(request.headers.get("content-length", 0))
    if content_length > 4096:
        return JSONResponse({"error": "payload too large"}, status_code=413)

    body     = await request.json()
    endpoint = body.get("endpoint", "")
    p256dh   = body.get("keys", {}).get("p256dh", "")
    auth     = body.get("keys", {}).get("auth", "")

    if not endpoint or not p256dh or not auth:
        return JSONResponse({"error": "invalid subscription"}, status_code=400)
    if not _PUSH_ORIGIN_RE.match(endpoint) or len(endpoint) > 500:
        return JSONResponse({"error": "invalid endpoint"}, status_code=400)
    if len(p256dh) < 80 or len(p256dh) > 200:
        return JSONResponse({"error": "invalid p256dh"}, status_code=400)
    if len(auth) < 20 or len(auth) > 100:
        return JSONResponse({"error": "invalid auth"}, status_code=400)

    token = str(uuid.uuid4())
    with get_db() as (_, cur):
        cur.execute("SELECT COUNT(*) FROM push_subscriptions")
        if cur.fetchone()[0] >= MAX_PUSH_SUBS:
            return JSONResponse({"error": "service at capacity"}, status_code=503)

        cur.execute(
            """
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, token, created_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (endpoint) DO UPDATE SET
                p256dh     = EXCLUDED.p256dh,
                auth       = EXCLUDED.auth,
                token      = EXCLUDED.token,
                created_at = EXCLUDED.created_at
            """,
            (endpoint, p256dh, auth, token, datetime.now(timezone.utc).timestamp()),
        )

    if bool(body.get("confirm", True)) and PUSH_AVAILABLE and VAPID_PRIVATE_KEY:
        await asyncio.to_thread(_send_push_sync, endpoint, p256dh, auth, {
            "type":     "gap",
            "title_de": "Benachrichtigungen aktiv ✓",
            "body_de":  "Du bekommst Bescheid bei Regenlücken.",
            "title_en": "Notifications on ✓",
            "body_en":  "You'll get a ping when a dry window opens.",
        })

    return {"ok": True, "token": token}


@app.delete("/api/subscribe")
@limiter.limit("10/minute")
async def unsubscribe(request: Request):
    content_length = int(request.headers.get("content-length", 0))
    if content_length > 1024:
        return JSONResponse({"error": "payload too large"}, status_code=413)

    body     = await request.json()
    endpoint = body.get("endpoint", "")
    token    = body.get("token", "")

    if not endpoint or not token:
        return JSONResponse({"error": "endpoint and token required"}, status_code=400)

    with get_db() as (_, cur):
        cur.execute("SELECT token FROM push_subscriptions WHERE endpoint = %s", (endpoint,))
        row = cur.fetchone()
        if not row:
            return {"ok": True}
        if row[0] != token:
            return JSONResponse({"error": "invalid token"}, status_code=403)
        cur.execute("DELETE FROM push_subscriptions WHERE endpoint = %s", (endpoint,))

    return {"ok": True}


@app.get("/api/accuracy")
@limiter.limit("30/minute")
def get_accuracy(request: Request):
    cutoff = int(datetime.now(timezone.utc).timestamp()) - 7 * 86400
    result = {}

    for horizon in [30, 60, 90]:
        with get_db() as (_, cur):
            cur.execute(
                """
                SELECT COUNT(*),
                       SUM(CASE WHEN (predicted_precip < %s AND actual_precip < %s) OR
                                     (predicted_precip >= %s AND actual_precip >= %s)
                                THEN 1 ELSE 0 END)
                FROM forecasts
                WHERE verified = 1
                  AND horizon_minutes = %s
                  AND forecast_made_at > %s
                """,
                (DRY_THRESHOLD, DRY_THRESHOLD, DRY_THRESHOLD, DRY_THRESHOLD, horizon, cutoff),
            )
            total, correct = cur.fetchone()
        correct = correct or 0
        result[f"{horizon}min"] = {
            "total":    total   or 0,
            "correct":  correct,
            "accuracy": round(correct / total * 100, 1) if total and total > 0 else None,
        }

    return result


ADMIN_KEY = os.getenv("ADMIN_KEY", "")


@app.get("/api/admin/accuracy")
@limiter.limit("20/minute")
def admin_accuracy(request: Request):
    """Detailed accuracy dashboard. Requires X-Admin-Key header matching ADMIN_KEY env var."""
    if not ADMIN_KEY:
        return JSONResponse({"error": "admin not configured"}, status_code=503)
    provided = request.headers.get("x-admin-key", "")
    if not provided or not secrets.compare_digest(provided, ADMIN_KEY):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    th          = DRY_THRESHOLD
    window_days = 30
    cutoff      = int(datetime.now(timezone.utc).timestamp()) - window_days * 86400

    def horizon_stats(h):
        with get_db() as (_, cur):
            cur.execute(
                """
                SELECT COUNT(*),
                       SUM(CASE WHEN (predicted_precip < %s AND actual_precip < %s) OR
                                     (predicted_precip >= %s AND actual_precip >= %s) THEN 1 ELSE 0 END),
                       SUM(CASE WHEN predicted_precip >= %s AND actual_precip < %s  THEN 1 ELSE 0 END),
                       SUM(CASE WHEN predicted_precip < %s  AND actual_precip >= %s THEN 1 ELSE 0 END)
                FROM forecasts
                WHERE verified = 1 AND horizon_minutes = %s AND forecast_made_at > %s
                """,
                (th, th, th, th, th, th, th, th, h, cutoff),
            )
            total, correct, false_alarm, missed = (v or 0 for v in cur.fetchone())
        return {
            "total":       total,
            "correct":     correct,
            "accuracy":    round(correct / total * 100, 1) if total else None,
            "false_alarms": false_alarm,
            "missed":      missed,
        }

    by_point = {}
    for p in POINTS:
        with get_db() as (_, cur):
            cur.execute(
                """
                SELECT COUNT(*),
                       SUM(CASE WHEN (predicted_precip < %s AND actual_precip < %s) OR
                                     (predicted_precip >= %s AND actual_precip >= %s) THEN 1 ELSE 0 END)
                FROM forecasts
                WHERE verified = 1 AND point_name = %s AND forecast_made_at > %s
                """,
                (th, th, th, th, p["name"], cutoff),
            )
            total, correct = cur.fetchone()
        by_point[p["name"]] = {
            "total":    total   or 0,
            "correct":  correct or 0,
            "accuracy": round(correct / total * 100, 1) if total else None,
        }

    with get_db() as (_, cur):
        cur.execute("SELECT COUNT(*), COALESCE(SUM(verified), 0) FROM forecasts")
        total_rows, verified = cur.fetchone()
        cur.execute("SELECT MAX(forecast_made_at) FROM forecasts")
        last_made = cur.fetchone()[0]

    return {
        "window_days":  window_days,
        "dry_threshold": th,
        "summary": {
            "total_rows":       total_rows or 0,
            "verified":         verified   or 0,
            "pending":          (total_rows or 0) - (verified or 0),
            "last_forecast_at": last_made,
            "points":           [p["name"] for p in POINTS],
        },
        "by_horizon": {f"{h}min": horizon_stats(h) for h in [30, 60, 90]},
        "by_point":   by_point,
    }


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
