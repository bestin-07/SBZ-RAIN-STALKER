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
from zoneinfo import ZoneInfo

try:
    from pywebpush import webpush, WebPushException
    PUSH_AVAILABLE = True
except ImportError:
    PUSH_AVAILABLE = False
    print("[push] pywebpush not available — push notifications disabled")

POINTS = [
    # original city centre ring
    {"name": "altstadt",   "lat": 47.7985, "lon": 13.0469},
    {"name": "bahnhof",    "lat": 47.8127, "lon": 13.0449},
    {"name": "lehen",      "lat": 47.8097, "lon": 13.0200},
    {"name": "schallmoos", "lat": 47.8190, "lon": 13.0600},
    {"name": "maxglan",    "lat": 47.7930, "lon": 13.0250},
    # extended coverage — north, west, east foothills, south
    {"name": "itzling",    "lat": 47.8310, "lon": 13.0400},
    {"name": "liefering",  "lat": 47.8265, "lon": 13.0170},
    {"name": "parsch",     "lat": 47.8060, "lon": 13.0790},
    {"name": "aigen",      "lat": 47.7790, "lon": 13.0730},
    {"name": "gneis",      "lat": 47.7755, "lon": 13.0380},
    {"name": "taxham",     "lat": 47.7940, "lon": 13.0060},
]

DRY_THRESHOLD = 0.1

# Ambient weather snapshot (temp/wind/code/cape/uv + hourly precip probability) for
# the grid, refreshed each 5-min cycle in ONE batched Open-Meteo call and served via
# /api/ambient. Clients pick the nearest point (GPS stays client-side) instead of
# each calling Open-Meteo — dodges the per-IP rate limit and shared-NAT throttling.
# The rain verdict is unaffected (still GeoSphere nowcast + TAWES, client-side).
_ambient = {"ts": 0, "points": []}

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
        # Calibration columns — safe to run on existing DB (IF NOT EXISTS)
        cur.execute("ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS nowcast_source TEXT")
        cur.execute("ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS hour_of_day    INTEGER")
        cur.execute("ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS month_num      INTEGER")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS calibration_runs (
                id                  BIGSERIAL PRIMARY KEY,
                run_at              BIGINT           NOT NULL,
                point_name          TEXT             NOT NULL,
                horizon_minutes     INTEGER          NOT NULL,
                old_threshold       DOUBLE PRECISION,
                new_threshold       DOUBLE PRECISION,
                sample_count        INTEGER,
                false_alarms_before INTEGER,
                false_alarms_after  INTEGER,
                f1_score            DOUBLE PRECISION
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS accuracy_alerts (
                id              BIGSERIAL PRIMARY KEY,
                triggered_at    BIGINT           NOT NULL,
                point_name      TEXT,
                horizon_minutes INTEGER,
                accuracy_7d     DOUBLE PRECISION,
                old_threshold   DOUBLE PRECISION,
                new_threshold   DOUBLE PRECISION,
                action          TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS push_log (
                id       BIGSERIAL PRIMARY KEY,
                sent_at  BIGINT NOT NULL,
                type     TEXT   NOT NULL,
                body_en  TEXT
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


TAWES_CAP_KM = 15  # mirror the frontend cap — distant mountain stations cause false "raining now"

async def fetch_tawes_precip(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
    stations = await _load_tawes_stations(client)
    if stations:
        scored  = sorted(stations, key=lambda s: _haversine_km(lat, lon, s[1], s[2]))
        within  = [s for s in scored if _haversine_km(lat, lon, s[1], s[2]) <= TAWES_CAP_KM]
        capped  = (within if len(within) >= 2 else scored)[:n]
        ids = [s[0] for s in capped]
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
    times, precips, _ = await _fetch_timeline_sourced(client, point)
    return times, precips

async def _fetch_timeline_sourced(client: httpx.AsyncClient, point: dict):
    """Like fetch_timeline but also returns the source string ('geosphere'|'open_meteo')."""
    try:
        times, precips = await fetch_nowcast_timeline(client, point)
        return times, precips, "geosphere"
    except Exception:
        data = await fetch_forecast_for_point(client, point)
        return (data.get("minutely_15", {}).get("time", []),
                data.get("minutely_15", {}).get("precipitation", []),
                "open_meteo")


# ---------------------------------------------------------------------------
# Calibration helpers
# ---------------------------------------------------------------------------

# Never offer a candidate below the 0.10 runtime floor (get_threshold clamps to
# it) — otherwise calibration "tunes" to 0.05 which is silently a no-op.
CALIB_CANDIDATES   = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]
# Optimise F-beta with beta < 1 (precision-weighted). Rain is rare here (~4% base
# rate), so plain F1 pushes thresholds down and floods false alarms. For a "should
# I go out" app a false alarm (false STUCK / false push) is worse than a miss, so
# we weight precision ~2x recall.
CALIB_BETA         = 0.5
MIN_CALIB_SAMPLES  = 50
MIN_RAIN_EVENTS    = 10  # minimum actual rain events needed before calibration is meaningful
ALERT_FLOOR        = 85.0   # 7-day accuracy % below which emergency raise fires
ALERT_COOLDOWN_S   = 3600   # don't re-alert same (point, horizon) within 1 hour


def get_threshold(point_name: str, horizon: int) -> float:
    key = f"calib_threshold_{horizon}_{point_name}"
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    val = float(row[0]) if row else DRY_THRESHOLD
    return max(val, DRY_THRESHOLD)  # floor: never go below 0.1mm (0.05 is too noisy)


def set_threshold(point_name: str, horizon: int, value: float):
    key = f"calib_threshold_{horizon}_{point_name}"
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, str(round(value, 4))),
        )


def _score(rows, candidate: float, beta: float = CALIB_BETA):
    """Return (F-beta score, false_alarm_count) for a candidate threshold.
    beta<1 weights precision over recall (fewer false alarms)."""
    tp = fp = fn = 0
    for pred, actual in rows:
        pw = pred   >= candidate
        aw = actual >= DRY_THRESHOLD
        if pw and aw:      tp += 1
        elif pw and not aw: fp += 1
        elif not pw and aw: fn += 1
    prec = tp / (tp + fp) if (tp + fp) else 1.0
    rec  = tp / (tp + fn) if (tp + fn) else 1.0
    b2    = beta * beta
    denom = b2 * prec + rec
    score = (1 + b2) * prec * rec / denom if denom else 0.0
    return score, fp


def weekly_calibrate():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    cutoff = now_ts - 30 * 86400
    print("[calib] running weekly calibration")
    for point in POINTS:
        for horizon in [30, 60, 90]:
            with get_db() as (_, cur):
                cur.execute(
                    "SELECT predicted_precip, actual_precip FROM forecasts"
                    " WHERE verified=1 AND point_name=%s AND horizon_minutes=%s"
                    " AND forecast_made_at > %s AND actual_precip IS NOT NULL",
                    (point["name"], horizon, cutoff),
                )
                rows = cur.fetchall()
            if len(rows) < MIN_CALIB_SAMPLES:
                continue
            actual_rain = sum(1 for _, a in rows if a >= DRY_THRESHOLD)
            if actual_rain < MIN_RAIN_EVENTS:
                print(f"[calib] {point['name']} {horizon}min — skip"
                      f" (only {actual_rain} rain events, need {MIN_RAIN_EVENTS})")
                continue
            old_th = get_threshold(point["name"], horizon)
            _, old_fa = _score(rows, old_th)
            best_th, best_f1, best_fa = old_th, 0.0, old_fa
            for c in CALIB_CANDIDATES:
                f1, fa = _score(rows, c)
                if f1 > best_f1:
                    best_f1, best_th, best_fa = f1, c, fa
            if best_f1 == 0.0:
                print(f"[calib] {point['name']} {horizon}min — no F{CALIB_BETA} improvement"
                      f" (base rate too low), keeping {old_th}")
                continue
            set_threshold(point["name"], horizon, best_th)
            with get_db() as (_, cur):
                cur.execute(
                    "INSERT INTO calibration_runs"
                    " (run_at, point_name, horizon_minutes, old_threshold, new_threshold,"
                    "  sample_count, false_alarms_before, false_alarms_after, f1_score)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (now_ts, point["name"], horizon, old_th, best_th,
                     len(rows), old_fa, best_fa, round(best_f1, 4)),
                )
            if best_th != old_th:
                print(f"[calib] {point['name']} {horizon}min {old_th}→{best_th}"
                      f" (F{CALIB_BETA}={best_f1:.3f}, FA {old_fa}→{best_fa})")
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('last_calibration_at', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (str(float(now_ts)),),
        )
    print("[calib] done")


def check_accuracy_health(now_ts: int):
    """Emergency threshold raise if 7-day accuracy drops below ALERT_FLOOR."""
    cutoff_7d = now_ts - 7 * 86400
    for point in POINTS:
        for horizon in [30, 60, 90]:
            with get_db() as (_, cur):
                cur.execute(
                    """SELECT COUNT(*),
                              SUM(CASE WHEN (predicted_precip < %s AND actual_precip < %s)
                                         OR (predicted_precip >= %s AND actual_precip >= %s)
                                       THEN 1 ELSE 0 END)
                       FROM forecasts
                       WHERE verified=1 AND point_name=%s AND horizon_minutes=%s
                         AND forecast_made_at > %s AND actual_precip IS NOT NULL""",
                    (DRY_THRESHOLD,) * 4 + (point["name"], horizon, cutoff_7d),
                )
                total, correct = cur.fetchone()
            if not total or total < 20:
                continue
            accuracy = (correct or 0) / total * 100
            if accuracy >= ALERT_FLOOR:
                continue
            # Check cooldown — don't spam alerts
            with get_db() as (_, cur):
                cur.execute(
                    "SELECT id FROM accuracy_alerts WHERE point_name=%s"
                    " AND horizon_minutes=%s AND triggered_at > %s",
                    (point["name"], horizon, now_ts - ALERT_COOLDOWN_S),
                )
                if cur.fetchone():
                    continue
            old_th = get_threshold(point["name"], horizon)
            new_th = round(min(old_th * 1.5, 0.5), 4)
            set_threshold(point["name"], horizon, new_th)
            with get_db() as (_, cur):
                cur.execute(
                    "INSERT INTO accuracy_alerts"
                    " (triggered_at, point_name, horizon_minutes, accuracy_7d,"
                    "  old_threshold, new_threshold, action)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (now_ts, point["name"], horizon, round(accuracy, 1),
                     old_th, new_th, "raised_threshold"),
                )
            print(f"[alert] {point['name']} {horizon}min acc={accuracy:.1f}%"
                  f" → threshold {old_th}→{new_th}")


async def fetch_ambient(client: httpx.AsyncClient):
    """One batched Open-Meteo call for all grid POINTS → the coarse weather fields
    the app shows (temp/wind/code/cape/uv) + hourly precip probability. Returns a
    list of per-point dicts, or None on failure (caller keeps the last snapshot)."""
    lats = ",".join(str(p["lat"]) for p in POINTS)
    lons = ",".join(str(p["lon"]) for p in POINTS)
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lats, "longitude": lons,
            "current": "temperature_2m,wind_speed_10m,weather_code,precipitation,cape,uv_index",
            "hourly": "precipitation_probability",
            "forecast_hours": 6, "timeformat": "unixtime", "timezone": "UTC",
        },
        timeout=15,
    )
    if r.status_code != 200:
        return None
    arr = r.json()
    if not isinstance(arr, list):
        arr = [arr]
    out = []
    for i, p in enumerate(POINTS):
        d = arr[i] if i < len(arr) else {}
        cur = (d or {}).get("current", {}) or {}
        hr  = (d or {}).get("hourly", {}) or {}
        out.append({
            "name": p["name"], "lat": p["lat"], "lon": p["lon"],
            "temp": cur.get("temperature_2m"), "wind": cur.get("wind_speed_10m"),
            "code": cur.get("weather_code"),  "precip": cur.get("precipitation"),
            "cape": cur.get("cape"),          "uv": cur.get("uv_index"),
            "ptime": hr.get("time", []),      "pprob": hr.get("precipitation_probability", []),
        })
    return out


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

MIN_PUSH_AGREEMENT  = 3   # points that must agree before any push fires (out of 11)

# Notification pacing (deliberately conservative to avoid alert fatigue):
#  - daytime only, Salzburg local time
#  - ≥ 15 min between ANY two pushes
#  - each type fires at most ONCE per calendar day → max 4 pushes/day
try:
    TZ_SALZBURG = ZoneInfo("Europe/Vienna")   # needs the tzdata pip package on slim images
except Exception:
    from datetime import timedelta
    TZ_SALZBURG = timezone(timedelta(hours=2))  # CEST fallback; day/night gating tolerates ±1h
PUSH_DAY_START = 8        # local hour: no pushes before 08:00
PUSH_DAY_END   = 22       # local hour: no pushes at/after 22:00
PUSH_MIN_GAP_S = 15 * 60  # ≥ 15 min between any two pushes


def _salzburg_now(now_ts: int) -> datetime:
    return datetime.fromtimestamp(now_ts, TZ_SALZBURG)


def _is_push_daytime(now_ts: int) -> bool:
    return PUSH_DAY_START <= _salzburg_now(now_ts).hour < PUSH_DAY_END


def _global_gap_ok(now_ts: int) -> bool:
    with get_db() as (_, cur):
        cur.execute("SELECT MAX(sent_at) FROM push_log")
        row = cur.fetchone()
    last = row[0] if row and row[0] else 0
    return (now_ts - last) >= PUSH_MIN_GAP_S


def _type_fired_today(push_type: str, now_ts: int) -> bool:
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = %s", (f"last_{push_type}_push_ts",))
        row = cur.fetchone()
    if not row:
        return False
    return _salzburg_now(float(row[0])).date() == _salzburg_now(now_ts).date()


def _analyze_forecast(times, precips, now_ts, now_precip_live: float = 0.0, threshold: float = DRY_THRESHOLD):
    """Classify the current situation for one grid point. Returns one of:
      rain_incoming  — dry now, rain arriving within 30 min
      gap            — raining, a ≥30-min dry window opens ahead
      rain_clearing  — raining, gap extends to end of forecast (rain looks done)
    or None if nothing actionable."""
    slots   = sorted(zip(times, precips), key=lambda s: s[0])
    current = min(slots, key=lambda s: abs(s[0] - now_ts), default=None)
    if current is None:
        return None

    nowcast_dry = current[1] < threshold
    is_dry_now  = nowcast_dry and now_precip_live < threshold

    if is_dry_now:
        # Use the point's calibrated threshold (not the fixed floor) so a point that
        # chronically over-predicts light rain stops firing false "rain incoming"
        # pushes once calibration raises its threshold.
        window = [(t, p) for t, p in slots if now_ts < t <= now_ts + 30 * 60]
        for rain_t, p in window:
            if p >= threshold:
                return {"type": "rain_incoming",
                        "rain_in_min": max(0, round((rain_t - now_ts) / 60))}
    else:
        # Raining now — scan future slots for a ≥30-min dry window
        future    = [(t, p) for t, p in slots if t > now_ts]
        gap_start = None
        gap_count = 0
        for t, p in future:
            if p < DRY_THRESHOLD:
                if gap_start is None:
                    gap_start = t
                gap_count += 1
            else:
                if gap_count >= 2:
                    return {"type": "gap",
                            "gap_in_min": max(0, round((gap_start - now_ts) / 60)),
                            "gap_min":    gap_count * 15}
                gap_start = None
                gap_count = 0
        # Reached end of forecast still in a gap → open-ended (rain clearing)
        if gap_count >= 2 and gap_start is not None:
            return {"type": "rain_clearing",
                    "clears_in_min": max(0, round((gap_start - now_ts) / 60))}

    return None


def _log_push(now_ts: int, push_type: str, body_en: str):
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO push_log (sent_at, type, body_en) VALUES (%s, %s, %s)",
            (now_ts, push_type, body_en),
        )
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (f"last_{push_type}_push_ts", str(float(now_ts))),
        )


def _build_payload(event: dict) -> dict:
    # All notifications are city-level (11 grid points across Salzburg),
    # NOT the user's exact spot. Body copy makes this explicit so users
    # who open the app and see "no rain here" aren't confused.
    t = event["type"]
    if t == "rain_incoming":
        x    = int(event["rain_in_min"])
        low  = max(5, x - 10)
        high = x + 10
        if x <= 5:
            return {"type": "rain",
                    "title_de": "Regen erreicht Salzburg",
                    "body_de":  "Könnte dich treffen — App für deinen Standort öffnen",
                    "title_en": "Rain reaching Salzburg",
                    "body_en":  "May affect your spot — open app to check"}
        return {"type": "rain",
                "title_de": f"Regen in {low}–{high} Min. über Salzburg",
                "body_de":  "Könnte dich treffen — App für deinen Standort öffnen",
                "title_en": f"Rain over Salzburg in {low}–{high} min",
                "body_en":  "May affect your spot — open app to check"}
    if t == "gap":
        x, dur = int(event["gap_in_min"]), int(event["gap_min"])
        if x <= 5:
            return {"type": "gap",
                    "title_de": f"Regenpause über Salzburg — {dur} Min.",
                    "body_de":  "Gilt für die Region — check deinen Standort",
                    "title_en": f"Rain gap over Salzburg — {dur} min",
                    "body_en":  "Area forecast — check your spot"}
        return {"type": "gap",
                "title_de": f"Regenpause in {x} Min. über Salzburg",
                "body_de":  f"{dur} Min. trocken in der Region — check deinen Standort",
                "title_en": f"Rain gap in {x} min over Salzburg",
                "body_en":  f"{dur} min dry in the area — check your spot"}
    if t == "rain_clearing":
        x = int(event["clears_in_min"])
        if x <= 5:
            return {"type": "rain",
                    "title_de": "Regen lässt über Salzburg nach",
                    "body_de":  "Sollte trocken bleiben — check deinen Standort",
                    "title_en": "Rain clearing over Salzburg",
                    "body_en":  "Should stay dry — check your spot"}
        return {"type": "rain",
                "title_de": f"Regen endet in ~{x} Min. über Salzburg",
                "body_de":  "Sollte trocken bleiben — check deinen Standort",
                "title_en": f"Rain clearing over Salzburg in ~{x} min",
                "body_en":  "Should stay dry — check your spot"}
    if t == "raining":
        if event.get("light"):
            return {"type": "rain",
                    "title_de": "Leichter Niesel über Salzburg",
                    "body_de":  "Könnte dich treffen — check deinen Standort",
                    "title_en": "Light drizzle over Salzburg",
                    "body_en":  "May affect your spot — check the app"}
        return {"type": "rain",
                "title_de": "Regen über Salzburg",
                "body_de":  "Könnte dich treffen — check deinen Standort",
                "title_en": "Rain over Salzburg",
                "body_en":  "May affect your spot — check the app"}
    return {}


async def check_and_push(client: httpx.AsyncClient, now_ts: int):
    if not _is_push_daytime(now_ts):
        print("[push] outside daytime hours (Salzburg) — suppressed")
        return
    if not _global_gap_ok(now_ts):
        print(f"[push] <{PUSH_MIN_GAP_S // 60} min since last push — skip")
        return

    events = []
    now_precips = []
    for point in POINTS:
        try:
            times, precips, _ = await _fetch_timeline_sourced(client, point)
            now_precip        = await fetch_now_precip(client, point)
            now_precips.append(now_precip)
            threshold         = get_threshold(point["name"], 30)
            ev = _analyze_forecast(
                list(times), list(precips),
                now_ts, now_precip_live=now_precip, threshold=threshold,
            )
            if ev:
                events.append(ev)
        except Exception as e:
            print(f"[push] {point['name']}: {e}")

    # "Raining now over Salzburg" — the onset step of the story, between "rain
    # incoming" and "gap/clearing". Verified by GROUND readings: a majority of the
    # grid must be wet right now. Intensity from the median wet reading → light
    # drizzle (<0.5 mm) vs rain. A single already-verified synthetic event.
    wet = [p for p in now_precips if p is not None and p >= DRY_THRESHOLD]
    if len(wet) >= MIN_PUSH_AGREEMENT:
        wet_sorted = sorted(wet)
        median_wet = wet_sorted[len(wet_sorted) // 2]
        events.append({"type": "raining", "light": median_wet < 0.5})

    total = len(POINTS)
    by_type = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(e)

    counts = {k: len(v) for k, v in by_type.items()}
    print(f"[push] votes: {counts} / {total} (need {MIN_PUSH_AGREEMENT})")

    # Story order: raining now > rain incoming > clearing > gap. Daytime-only +
    # ≥15-min gap (checked above) + once-per-type-per-day → max 4 paced pushes/day.
    for push_type in ("raining", "rain_incoming", "rain_clearing", "gap"):
        candidates = by_type.get(push_type, [])
        if not candidates:
            continue
        # "raining" is a single event already verified by the wet-count above; the
        # forecast types need MIN_PUSH_AGREEMENT points to independently agree.
        if push_type != "raining" and len(candidates) < MIN_PUSH_AGREEMENT:
            continue
        if _type_fired_today(push_type, now_ts):
            print(f"[push] {push_type} already fired today — skip")
            continue
        if push_type == "raining":
            best = candidates[0]
        else:
            # Pick the most imminent event across agreeing points
            sort_key = "rain_in_min" if push_type == "rain_incoming" else \
                       "clears_in_min" if push_type == "rain_clearing" else "gap_in_min"
            best = min(candidates, key=lambda e: e.get(sort_key, 0))
        payload = _build_payload(best)
        await push_to_all(payload)
        _log_push(now_ts, push_type, payload.get("body_en", ""))
        print(f"[push] {push_type} fired — {len(candidates)}/{total} agreed")
        break  # one push per cycle


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    now_dt = datetime.now(timezone.utc)

    async with httpx.AsyncClient() as client:
        # Ambient weather snapshot for the grid (one batched Open-Meteo call) → served
        # to clients so they don't each hit Open-Meteo. Keep the last snapshot on error.
        try:
            amb = await fetch_ambient(client)
            if amb:
                _ambient["ts"] = now_ts
                _ambient["points"] = amb
        except Exception as e:
            print(f"[ambient] {e}")

        # Store new forecasts for all points × horizons
        forecast_rows = []
        for point in POINTS:
            try:
                times, precips, source = await _fetch_timeline_sourced(client, point)
                for horizon in [30, 60, 90]:
                    target_ts = now_ts + horizon * 60
                    best_idx  = min(range(len(times)), key=lambda i: abs(times[i] - target_ts), default=None)
                    if best_idx is not None:
                        forecast_rows.append((
                            point["name"], now_ts, target_ts, horizon, precips[best_idx],
                            source, now_dt.hour, now_dt.month,
                        ))
            except Exception as e:
                print(f"[cycle] forecast {point['name']}: {e}")

        if forecast_rows:
            with get_db() as (_, cur):
                cur.executemany(
                    "INSERT INTO forecasts"
                    " (point_name, forecast_made_at, target_time, horizon_minutes, predicted_precip,"
                    "  nowcast_source, hour_of_day, month_num)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
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

        # Health check every cycle — raises thresholds immediately if accuracy falls
        check_accuracy_health(now_ts)

        # Weekly calibration — refits all thresholds from last 30 days of verified data
        with get_db() as (_, cur):
            cur.execute("SELECT value FROM settings WHERE key = 'last_calibration_at'")
            row = cur.fetchone()
        last_calib = float(row[0]) if row else 0
        if now_ts - last_calib >= 7 * 86400:
            weekly_calibrate()

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


@app.get("/api/ambient")
@limiter.limit("30/minute")
def get_ambient(request: Request):
    """Latest ambient weather for the grid (temp/wind/code/cape/uv + hourly precip
    probability per point). Public, no GPS involved — clients pick the nearest point
    themselves. Empty points[] until the first cycle populates it (client falls back
    to a direct Open-Meteo call).

    Anti-abuse: 30/min per IP (the app only needs it ~once/90 s) + a 60 s cacheable
    response so browsers/proxies serve repeats without hitting us. The payload is
    already-computed cached data, so a hit is cheap; the rate limit caps scraping."""
    return JSONResponse(_ambient, headers={"Cache-Control": "public, max-age=60"})


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
                       SUM(CASE WHEN predicted_precip < %s  AND actual_precip >= %s THEN 1 ELSE 0 END),
                       SUM(CASE WHEN predicted_precip >= %s AND actual_precip >= %s THEN 1 ELSE 0 END),
                       SUM(CASE WHEN actual_precip >= %s                            THEN 1 ELSE 0 END)
                FROM forecasts
                WHERE verified = 1 AND horizon_minutes = %s AND forecast_made_at > %s
                """,
                (th, th, th, th, th, th, th, th, th, th, th, h, cutoff),
            )
            total, correct, false_alarm, missed, hits, actual_rain = (v or 0 for v in cur.fetchone())
        denom_csi = hits + false_alarm + missed
        denom_far = hits + false_alarm
        return {
            "total":        total,
            "correct":      correct,
            "accuracy":     round(correct / total * 100, 1) if total else None,
            "false_alarms": false_alarm,
            "missed":       missed,
            "hits":         hits,
            "actual_rain":  actual_rain,
            "base_rate":    round(actual_rain / total * 100, 2) if total else 0,
            "csi":          round(hits / denom_csi * 100, 1) if denom_csi > 0 else None,
            "pod":          round(hits / actual_rain * 100, 1) if actual_rain > 0 else None,
            "far":          round(false_alarm / denom_far * 100, 1) if denom_far > 0 else None,
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


@app.get("/api/admin/dashboard")
@limiter.limit("20/minute")
def admin_dashboard(request: Request):
    """Full calibration + health dashboard. Same auth as admin_accuracy."""
    if not ADMIN_KEY:
        return JSONResponse({"error": "admin not configured"}, status_code=503)
    if not secrets.compare_digest(request.headers.get("x-admin-key", ""), ADMIN_KEY):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    now_ts    = int(datetime.now(timezone.utc).timestamp())
    cutoff_7d = now_ts - 7 * 86400
    th        = DRY_THRESHOLD

    # Health per horizon (7-day window)
    health: dict = {}
    for h in [30, 60, 90]:
        with get_db() as (_, cur):
            cur.execute(
                """SELECT COUNT(*),
                          SUM(CASE WHEN (predicted_precip < %s AND actual_precip < %s)
                                     OR (predicted_precip >= %s AND actual_precip >= %s)
                                   THEN 1 ELSE 0 END),
                          SUM(CASE WHEN predicted_precip >= %s AND actual_precip <  %s THEN 1 ELSE 0 END),
                          SUM(CASE WHEN predicted_precip <  %s AND actual_precip >= %s THEN 1 ELSE 0 END),
                          SUM(CASE WHEN predicted_precip >= %s AND actual_precip >= %s THEN 1 ELSE 0 END),
                          SUM(CASE WHEN actual_precip >= %s                            THEN 1 ELSE 0 END)
                   FROM forecasts
                   WHERE verified=1 AND horizon_minutes=%s
                     AND forecast_made_at > %s AND actual_precip IS NOT NULL""",
                (th,) * 10 + (th, h, cutoff_7d),
            )
            total, correct, fa, missed, hits, actual_rain = (v or 0 for v in cur.fetchone())
        denom_csi = hits + fa + missed
        denom_far = hits + fa
        health[f"{h}min"] = {
            "total":        total,
            "accuracy":     round((correct or 0) / total * 100, 1) if total else None,
            "false_alarms": int(fa),
            "missed":       int(missed),
            "hits":         int(hits),
            "actual_rain":  int(actual_rain),
            "base_rate":    round(actual_rain / total * 100, 2) if total else 0,
            "csi":          round(hits / denom_csi * 100, 1) if denom_csi > 0 else None,
            "pod":          round(hits / actual_rain * 100, 1) if actual_rain > 0 else None,
            "far":          round(fa / denom_far * 100, 1) if denom_far > 0 else None,
        }

    # Current calibrated thresholds — report the EFFECTIVE (floored) value that the
    # runtime actually uses via get_threshold, so the dashboard can't show a "tuned"
    # number that is silently clamped away. "tuned" = effectively above the floor.
    thresholds = []
    for p in POINTS:
        for h in [30, 60, 90]:
            eff = get_threshold(p["name"], h)
            thresholds.append({
                "point":     p["name"],
                "horizon":   h,
                "threshold": eff,
                "tuned":     eff > DRY_THRESHOLD,
            })

    # Calibration meta
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'last_calibration_at'")
        row = cur.fetchone()
    last_calib = float(row[0]) if row else None

    with get_db() as (_, cur):
        cur.execute(
            "SELECT run_at, point_name, horizon_minutes, old_threshold, new_threshold,"
            "       sample_count, false_alarms_before, false_alarms_after, f1_score"
            " FROM calibration_runs ORDER BY run_at DESC LIMIT 50"
        )
        calib_rows = [
            {"run_at": r[0], "point": r[1], "horizon": r[2],
             "old_th": r[3], "new_th": r[4], "samples": r[5],
             "fa_before": r[6], "fa_after": r[7], "f1": r[8]}
            for r in cur.fetchall()
        ]

    # Recent alerts
    with get_db() as (_, cur):
        cur.execute(
            "SELECT triggered_at, point_name, horizon_minutes, accuracy_7d,"
            "       old_threshold, new_threshold, action"
            " FROM accuracy_alerts ORDER BY triggered_at DESC LIMIT 20"
        )
        alert_rows = [
            {"at": r[0], "point": r[1], "horizon": r[2], "accuracy": r[3],
             "old_th": r[4], "new_th": r[5], "action": r[6]}
            for r in cur.fetchall()
        ]

    # Source health (7-day)
    source_health = []
    for p in POINTS:
        with get_db() as (_, cur):
            cur.execute(
                "SELECT COUNT(*),"
                "       SUM(CASE WHEN nowcast_source='geosphere' THEN 1 ELSE 0 END)"
                " FROM forecasts WHERE point_name=%s AND forecast_made_at > %s",
                (p["name"], cutoff_7d),
            )
            total, geo = cur.fetchone()
        total = total or 0; geo = geo or 0
        source_health.append({
            "point":       p["name"],
            "nowcast_pct": round(geo / total * 100, 1) if total else None,
            "om_pct":      round((total - geo) / total * 100, 1) if total else None,
        })

    # Daily rain history — 30 days so the chart shows the full calibration window.
    # Grouped by UTC day bucket so we don't depend on postgres date functions.
    cutoff_30d = now_ts - 30 * 86400
    with get_db() as (_, cur):
        cur.execute(
            """
            SELECT (forecast_made_at / 86400) * 86400   AS day_ts,
                   MAX(actual_precip)                    AS max_mm,
                   SUM(CASE WHEN actual_precip >= %s THEN 1 ELSE 0 END) AS rain_slots,
                   COUNT(*)                              AS total_slots
            FROM forecasts
            WHERE verified=1 AND actual_precip IS NOT NULL
              AND forecast_made_at > %s
            GROUP BY (forecast_made_at / 86400)
            ORDER BY day_ts
            """,
            (th, cutoff_30d),
        )
        rain_history = [
            {"day": int(r[0]), "max_mm": round(float(r[1] or 0), 2),
             "rain_slots": int(r[2] or 0), "total_slots": int(r[3] or 0)}
            for r in cur.fetchall()
        ]

    with get_db() as (_, cur):
        cur.execute(
            "SELECT sent_at, type, body_en FROM push_log ORDER BY sent_at DESC LIMIT 30"
        )
        push_log_rows = [
            {"sent_at": r[0], "type": r[1], "body_en": r[2]}
            for r in cur.fetchall()
        ]

    return {
        "health":       health,
        "thresholds":   thresholds,
        "calibration":  {
            "last_run":  last_calib,
            "next_run":  (last_calib + 7 * 86400) if last_calib else None,
            "runs":      calib_rows,
        },
        "alerts":       alert_rows,
        "source_health": source_health,
        "rain_history":  rain_history,
        "push_log":      push_log_rows,
    }


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
