from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse, Response
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
import time
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
# When the five-day outlook currently in _ambient["daily"] was actually fetched
# from Open-Meteo (not just restored from DB) — gates the TTL in run_cycle.
_daily_fetched_at = 0
# Wide-area forecast raster for the expanded map (v2.47.1), served by /api/nowcast-grid —
# kept out of /api/ambient, which every client polls whether or not it opens the map.
# `_map_grid_body` is the serialised response, rebuilt once per cycle, not per request.
_map_grid = None
_map_grid_body = None
_grid_status = {"city": None, "map": None}   # last outcome per grid call: {ok, at, err}

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


# ---- Whole-area future radar for the map's expanded time-scrubber (v2.44.0) ------
# Same instrument as fetch_nowcast_timeline above (GeoSphere nowcast-v1-15min-1km),
# requested as a GRID instead of 11 separate points: one call returns every ~1km
# cell across the whole viewing area (city + surrounding AREAS towns) for every
# 15-min step out to +3h. RainViewer's own free-tier nowcast dropped to zero
# frames (confirmed live, see CLAUDE.md) — this replaces it with real radar
# extrapolation, not a model, for the map's expanded scrubber only.
# DISPLAY LAYER ONLY: never read by getStatus/the verdict/push/accuracy pipeline,
# which all still use the per-point `nowcast` series above, untouched.
GRID_BBOX = "47.60,12.85,47.96,13.17"  # south,west,north,east — city + AREAS towns


def _parse_grid_response(data):
    """Pure parse, kept separate from the HTTP call so it's unit-testable without
    a network mock. Raises ValueError on any unexpected shape (caller keeps the
    previous grid, same doctrine as every other fetch_ in this file)."""
    from datetime import datetime  # local import: keeps this extractable standalone
    # by test_logic.py's AST-based _extract(), same technique _area_watch uses for math.
    ts = data.get("timestamps", [])
    features = data.get("features", [])
    if not ts or not features:
        raise ValueError("unexpected grid response: no timestamps/features")
    times = [int(datetime.fromisoformat(s).timestamp()) for s in ts]
    cells = []
    for f in features:
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates")
        params = (f.get("properties") or {}).get("parameters") or {}
        # Dataset uses lowercase "rr" (confirmed live on the point endpoint this
        # grid call mirrors); fall back case-insensitively in case the grid
        # endpoint's own casing differs — never assumed, only checked.
        rr = params.get("rr")
        if rr is None:
            rr = next((v for k, v in params.items() if isinstance(k, str) and k.lower() == "rr"), None)
        if not coords or len(coords) != 2 or not isinstance(rr, dict) or "data" not in rr:
            continue
        vals = rr["data"]
        if len(vals) != len(times):
            continue
        cells.append({
            "lat": coords[1], "lon": coords[0],
            "precips": [float(v) if isinstance(v, (int, float)) else 0.0 for v in vals],
        })
    if not cells:
        raise ValueError("no usable grid cells in response")
    return {"times": times, "cells": cells}


def _grid_timeline(grid, lat, lon, max_km=1.5):
    """(times, precips) of the grid cell nearest (lat, lon), or None if there is no cell
    within max_km. The per-point timeseries endpoint returns exactly this cell (verified
    live 2026-09-24: all 121 overlapping values and every timestamp identical), so the
    one grid call can stand in for the 11 per-point calls."""
    import math  # local import: keeps this extractable standalone by test_logic.py
    cells = (grid or {}).get("cells") or []
    times = (grid or {}).get("times") or []
    if not cells or not times:
        return None
    kx = 111.2 * math.cos(math.radians(lat))
    best = min(cells, key=lambda c: ((c["lat"] - lat) * 111.2) ** 2 + ((c["lon"] - lon) * kx) ** 2)
    d = math.hypot((best["lat"] - lat) * 111.2, (best["lon"] - lon) * kx)
    if d > max_km:
        return None
    return list(times), list(best["precips"])


def _city_cells(grid, points):
    """The city grid for the browser to pick its OWN 1 km cell from (v2.48.0) — compact:
    {times, lat[], lon[], v[step][cell]}, hundredths of a mm. Each cell is virga-filtered
    exactly like a point's served series, with the NEAREST point's hourly probability, so
    at a point's own location the cell and the point are the same series (pinned in
    test_logic). GPS stays in the browser: every cell is served, the pick is local."""
    times = list((grid or {}).get("times") or [])
    cells = (grid or {}).get("cells") or []
    if not times or not cells or not points:
        return None
    lat, lon, cols = [], [], []
    for c in cells:
        k = 0.67  # cos(47.8°): a degree of longitude is ~2/3 of a degree of latitude here
        pt = min(points, key=lambda p: (p["lat"] - c["lat"]) ** 2 + ((p["lon"] - c["lon"]) * k) ** 2)
        f = _filter_virga(times, c["precips"], pt.get("ptime"), pt.get("pprob"))
        lat.append(round(c["lat"], 4))
        lon.append(round(c["lon"], 4))
        cols.append([int(round(x * 100)) for x in f])
    return {"times": times, "lat": lat, "lon": lon,
            "v": [[col[s] for col in cols] for s in range(len(times))]}


async def fetch_nowcast_grid(client: httpx.AsyncClient):
    r = await client.get(
        f"{GEOSPHERE}/grid/forecast/nowcast-v1-15min-1km",
        params={"parameters": "rr", "bbox": GRID_BBOX, "output_format": "geojson"},
        timeout=15,
    )
    r.raise_for_status()
    return _parse_grid_response(r.json())


# ---- The expanded map's forecast frames (v2.47.1) ----------------------------------
# GRID_BBOX above is the city (it seeds the verdict and stays small and fast). The map
# needs far more: a wide desktop window at the default zoom shows ~1.3° of longitude,
# and GRID_BBOX's 0.32° drew the forecast as a small rectangle in the middle of a radar
# frame that covers everything (live report 2026-09-24). This is a separate call, made
# AFTER the snapshot swap, so the map's larger request can never delay or break the
# verdict. Same dataset, one more GeoSphere call per cycle (~12/h, well inside 240/h).
# south,west,north,east: the map's whole pan area (RadarMap BOUNDS, 47.50–48.10 N ×
# 12.65–13.65 E) plus margin, centred on it — a window wider than that area is centred on
# it by Leaflet, so a 1.7° span covers even a 2400 px wide window at the default zoom.
MAP_GRID_BBOX = "47.45,12.30,48.15,14.00"
MAP_GRID_DLAT = 0.009    # ~1 km, the source resolution
MAP_GRID_DLON = 0.0134   # ~1 km at 47.8° N
MAP_GRID_MAX_KM = 0.8    # > a cell's half-diagonal (0.71 km): inside coverage there's always a cell


def _grid_to_raster(data, bbox, dlat, dlon, max_km):
    """GeoSphere grid GeoJSON → a regular lat/lon raster the browser stretches straight
    over the map. The source lattice is Lambert-projected (tilted in lat/lon, every cell
    has a unique lat and lon — the v2.46.1 lesson), so each raster pixel takes its NEAREST
    source cell within max_km; none in reach → -1, i.e. no data, drawn transparent and
    never as dry. Values are hundredths of a mm per 15 min (ints — a third of the JSON).
    Row 0 = north, col 0 = west. Raises ValueError on an unusable response."""
    import math  # local imports: keep this extractable standalone by test_logic.py
    from datetime import datetime
    ts = data.get("timestamps", [])
    features = data.get("features", [])
    if not ts or not features:
        raise ValueError("unexpected grid response: no timestamps/features")
    times = [int(datetime.fromisoformat(s).timestamp()) for s in ts]
    south, west, north, east = (float(x) for x in bbox.split(","))
    src = []
    for f in features:
        coords = (f.get("geometry") or {}).get("coordinates")
        params = (f.get("properties") or {}).get("parameters") or {}
        rr = params.get("rr")
        if rr is None:
            rr = next((v for k, v in params.items() if isinstance(k, str) and k.lower() == "rr"), None)
        if not coords or len(coords) != 2 or not isinstance(rr, dict):
            continue
        vals = rr.get("data")
        if not isinstance(vals, list) or len(vals) != len(times):
            continue
        src.append((float(coords[1]), float(coords[0]),
                    [int(round(v * 100)) if isinstance(v, (int, float)) and v >= 0 else -1 for v in vals]))
    if not src:
        raise ValueError("no usable grid cells in response")
    rows = max(1, int(round((north - south) / dlat)))
    cols = max(1, int(round((east - west) / dlon)))
    # Bucket the source cells on the target lattice: a cell within max_km (< one step)
    # of a pixel always sits in that pixel's bucket or one of its 8 neighbours.
    buckets = {}
    for i, (la, lo, _) in enumerate(src):
        buckets.setdefault((math.floor((la - south) / dlat), math.floor((lo - west) / dlon)), []).append(i)
    ky = 111.2
    kx = 111.2 * math.cos(math.radians((south + north) / 2))
    reach = max_km * max_km
    pick = []
    for r in range(rows):
        lat = north - (r + 0.5) * dlat
        bi = math.floor((lat - south) / dlat)
        for c in range(cols):
            lon = west + (c + 0.5) * dlon
            bj = math.floor((lon - west) / dlon)
            best, best_d = -1, reach
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for i in buckets.get((bi + di, bj + dj), ()):
                        d = ((src[i][0] - lat) * ky) ** 2 + ((src[i][1] - lon) * kx) ** 2
                        if d < best_d:
                            best, best_d = i, d
            pick.append(best)
    return {
        "times": times, "rows": rows, "cols": cols,
        "bounds": [[round(north - rows * dlat, 5), west], [north, round(west + cols * dlon, 5)]],
        "v": [[src[i][2][k] if i >= 0 else -1 for i in pick] for k in range(len(times))],
    }


async def fetch_map_grid(client: httpx.AsyncClient):
    r = await client.get(
        f"{GEOSPHERE}/grid/forecast/nowcast-v1-15min-1km",
        params={"parameters": "rr", "bbox": MAP_GRID_BBOX, "output_format": "geojson"},
        timeout=30,
    )
    r.raise_for_status()
    return _grid_to_raster(r.json(), MAP_GRID_BBOX, MAP_GRID_DLAT, MAP_GRID_DLON, MAP_GRID_MAX_KM)


def _grid_error(e):
    """Short, loggable description of a failed grid call — served on /api/nowcast-grid so
    a failure can be diagnosed without server logs (2026-09-24: the city grid failed on
    every cycle after a deploy and nothing outside the logs said why)."""
    status = getattr(getattr(e, "response", None), "status_code", None)
    return f"{type(e).__name__}{f' {status}' if status else ''}: {str(e)[:160]}"


def _serialise_map_grid():
    """Rebuild the /api/nowcast-grid body once (raster + status), plain and gzipped."""
    import gzip
    global _map_grid_body
    raw = json.dumps({"grid": _map_grid, "status": _grid_status}, separators=(",", ":")).encode()
    _map_grid_body = (raw, gzip.compress(raw, 6))


def _deaccumulate(vals):
    """Accumulated series → per-interval amounts. Clamps negatives to 0 (model
    runs can reset the accumulator mid-series at a new forecast base time)."""
    out, prev = [], 0.0
    for v in vals:
        v = float(v) if isinstance(v, (int, float)) else 0.0
        out.append(max(0.0, v - prev))
        prev = v
    return out


# ---- AROME second model (v2.7) ------------------------------------------------
# GeoSphere's AROME (nwp-v1-1h-2500m: 2.5 km, hourly steps, 60 h, re-run every
# 3 h) assimilates the Austrian radar network — the closest thing to "radar
# beyond 3 h" that exists. The forecast tail is served as the UNION of both
# models (client takes the per-slot max): whichever shows rain is displayed.
# The precip parameter name is discovered at runtime from the dataset metadata
# (prefer per-interval "rr", else accumulated "rr_acc" + de-accumulation) so a
# wrong guess degrades to "no AROME" instead of a crash.
AROME_DATASET = "nwp-v1-1h-2500m"
_arome_param = None   # discovered once per process; False = discovery failed


async def _discover_arome_param(client: httpx.AsyncClient):
    global _arome_param
    if _arome_param is not None:
        return _arome_param or None
    try:
        r = await client.get(
            f"{GEOSPHERE}/timeseries/forecast/{AROME_DATASET}/metadata", timeout=10)
        r.raise_for_status()
        meta = r.json()
        raw = meta.get("parameters", [])
        names = set()
        for p in raw if isinstance(raw, list) else raw.values():
            names.add(p.get("name") if isinstance(p, dict) else str(p))
        _arome_param = "rr" if "rr" in names else ("rr_acc" if "rr_acc" in names else False)
        print(f"[arome] precip parameter: {_arome_param or 'NONE FOUND'} (of {sorted(names)[:12]}…)")
    except Exception as e:
        print(f"[arome] metadata discovery failed (will retry next cycle): {e}")
        return None   # leave _arome_param None → retried next call
    return _arome_param or None


async def fetch_arome_timeline(client: httpx.AsyncClient, point: dict):
    """AROME hourly precip for one point, sliced to now-1h … now+13h.
    Values stay mm-per-HOUR — the client scales them to its slot width."""
    param = await _discover_arome_param(client)
    if not param:
        return None
    r = await client.get(
        f"{GEOSPHERE}/timeseries/forecast/{AROME_DATASET}",
        params={"parameters": param, "lat_lon": f"{point['lat']},{point['lon']}"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    ts   = data.get("timestamps", [])
    vals = data["features"][0]["properties"]["parameters"][param]["data"]
    if not ts or len(ts) != len(vals):
        raise ValueError("unexpected arome response")
    vals = [float(v) if isinstance(v, (int, float)) else 0.0 for v in vals]
    if param == "rr_acc":
        vals = _deaccumulate(vals)
    times = [int(datetime.fromisoformat(s).timestamp()) for s in ts]
    nowt = time.time()
    keep = [(t, v) for t, v in zip(times, vals) if nowt - 3600 <= t <= nowt + 13 * 3600]
    if not keep:
        return None
    return [t for t, _ in keep], [v for _, v in keep]


# AROME re-runs only every 3 h, so a 30-min per-point cache keeps the added
# GeoSphere load tiny (~22 calls/h on top of the nowcast's ~130) — the rate
# limit that caused the 429 starvation incident stays comfortably clear.
_arome_cache = {}
_AROME_TTL = 1800


async def _arome_cached(client: httpx.AsyncClient, point: dict):
    name, nowt = point["name"], time.time()
    hit = _arome_cache.get(name)
    if hit and nowt - hit[0] < _AROME_TTL:
        return hit[1]
    try:
        res = await fetch_arome_timeline(client, point)
    except Exception as e:
        print(f"[arome] {name}: {e}")
        # Serve the stale copy through upstream hiccups; only a hard None ages out.
        return hit[1] if hit else None
    _arome_cache[name] = (nowt, res)
    return res


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

# Per-cycle TAWES cache (station-id key → (ts, value)). Every city grid point resolves
# to the SAME 2 gauges (Freisaal 11350, Airport 11150), and each cycle the ground fetch +
# per-row verification + check_and_push all read them — that was ~45 identical TAWES calls
# a cycle, the main cause of the GeoSphere 429s. Cached < the 300 s cycle → one real call.
_tawes_cache = {}
_TAWES_TTL = 120

def _tawes_obs_ts(payload):
    """Unix seconds of a TAWES `station/current` reading (its top-level `timestamps`),
    or None if absent/unparseable. The reading can be well behind wall-clock time —
    a 10-min sum, published with a delay, then held for a 5-min cycle — so the client
    shows its age rather than presenting it as "now"."""
    try:
        stamps = payload.get("timestamps") or []
        if not stamps:
            return None
        dt = datetime.fromisoformat(stamps[-1])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except (AttributeError, TypeError, ValueError, IndexError):
        return None


async def fetch_tawes_precip(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
    return (await fetch_tawes_reading(client, lat, lon, n))[0]


def _tawes_parse(payload, stations):
    """({station id: RR mm/10 min}, [every RR value]) from a TAWES station/current response.
    Each feature is matched to its station by `properties.station` when present, else by
    the nearest known station to its coordinates (≤ 1 km) — so either response shape
    works. The flat value list keeps the city max exactly as before even if no feature
    can be matched to a station."""
    per, values = {}, []
    for f in (payload or {}).get("features", []) or []:
        props = f.get("properties") or {}
        try:
            v = props["parameters"]["RR"]["data"][0]
        except (KeyError, IndexError, TypeError):
            continue
        if not isinstance(v, (int, float)):
            continue
        values.append(v)
        sid = props.get("station")
        if sid is None and stations:
            coords = (f.get("geometry") or {}).get("coordinates")
            if coords and len(coords) == 2:
                lon, lat = coords
                best = min(stations, key=lambda s: _haversine_km(lat, lon, s[1], s[2]))
                if _haversine_km(lat, lon, best[1], best[2]) <= 1.0:
                    sid = best[0]
        if sid is not None:
            per[str(sid)] = float(v)
    return per, values


async def _tawes_ids(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
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
    return ids


async def _tawes_fetch(client: httpx.AsyncClient, ids):
    """(per-station RR dict, all RR values, observation ts) for these stations — one call,
    cached per station set for _TAWES_TTL."""
    key  = ",".join(sorted(ids))
    nowt = datetime.now(timezone.utc).timestamp()
    hit  = _tawes_cache.get(key)
    if hit and nowt - hit[0] < _TAWES_TTL:
        return hit[1]
    r = await client.get(
        f"{GEOSPHERE}/station/current/tawes-v1-10min",
        params={"parameters": "RR", "station_ids": ",".join(ids)},
        timeout=10,
    )
    r.raise_for_status()
    payload = r.json()
    per, vals = _tawes_parse(payload, _tawes_stations or [])
    res = (per, vals, _tawes_obs_ts(payload))
    _tawes_cache[key] = (nowt, res)
    return res


async def fetch_tawes_reading(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
    """(max RR across the nearest gauges in mm/10 min, observation unix ts) — either may be None."""
    _, vals, ts = await _tawes_fetch(client, await _tawes_ids(client, lat, lon, n))
    return (max(vals) if vals else None, ts)


async def fetch_tawes_gauges(client: httpx.AsyncClient, lat: float, lon: float, n: int = 3):
    """Each gauge's OWN reading and position (v2.48.0) — [{id, lat, lon, rr, ts}] — from the
    same (cached) call as fetch_tawes_reading. The browser keeps only the gauges within
    GAUGE_OWN_KM of the user: a gauge speaks for its neighbourhood, not the whole city."""
    ids = await _tawes_ids(client, lat, lon, n)
    per, _, ts = await _tawes_fetch(client, ids)
    where = {s[0]: (s[1], s[2]) for s in (_tawes_stations or [])}
    return [{"id": sid, "lat": where[sid][0], "lon": where[sid][1], "rr": per.get(sid), "ts": ts}
            for sid in ids if sid in where]


# ---------------------------------------------------------------------------
# GeoSphere/ZAMG official severe-weather warnings (Warn API) — a separate,
# authoritative civil-protection source, distinct from our own CAPE/wind/UV
# heuristics above. Municipality-aggregated (Salzburg city = one query).
# ---------------------------------------------------------------------------
WARN_API = "https://warnungen.zamg.at/wsapp/api"

# warntypid (1-7) and warnstufeid (1-3) → (DE, EN) label pairs, used both by the
# push payload here and mirrored as i18n keys (warn_type_N / warn_level_N) for
# the frontend banner — the raw text field from the API is never served/shown,
# so both languages come from one translation source, not the external API.
WARN_TYPE_NAMES = {
    1: ("Sturm", "Storm"), 2: ("Regen", "Rain"), 3: ("Schnee", "Snow"),
    4: ("Glatteis", "Black ice"), 5: ("Gewitter", "Thunderstorm"),
    6: ("Hitze", "Heat"), 7: ("Kälte", "Cold"),
}
WARN_LEVEL_NAMES = {1: ("Gelb", "Yellow"), 2: ("Orange", "Orange"), 3: ("Rot", "Red")}


async def fetch_severe_warnings(client: httpx.AsyncClient, lat: float, lon: float):
    """Official GeoSphere/ZAMG civil-protection warnings for the municipality
    containing (lat, lon). Returns only structured fields (id/type/level/start/end)
    — the API's free-text is deliberately not served; the frontend translates
    type+level via t(), matching the area_watch dir_* pattern."""
    r = await client.get(f"{WARN_API}/getWarningsForCoords", params={"lat": lat, "lon": lon}, timeout=10)
    if r.status_code != 200:
        print(f"[warnings] {r.status_code}: {r.text[:200]}")
        return []
    out = []
    for w in r.json().get("properties", {}).get("warnings", []):
        p = w.get("properties", {})
        raw = p.get("rawinfo") or {}
        start, end = raw.get("start"), raw.get("end")
        if start is None or end is None:
            continue
        wtype, wlevel = p.get("warntypid"), p.get("warnstufeid")
        if wtype not in WARN_TYPE_NAMES or wlevel not in WARN_LEVEL_NAMES:
            continue
        # v2.17.0: Gewitter/Thunderstorm (wtype 5) is NO LONGER dropped. It was
        # filtered on the theory that our CAPE storm banner already covers the hazard —
        # but that banner needs CAPE >= 1500, and the Nonntal thunderstorm of
        # 2026-08-06 ran at CAPE 200-260, so nothing covered it at all. We were
        # discarding the only authoritative, independently-issued, human-checked storm
        # signal we have, and the one with headline-override power (v2.14.0 redWarning)
        # — a meteorologist's call thrown away in favour of our own heuristic's silence.
        # Duplicate-banner risk stays bounded by the existing top-2-by-severity cap.
        out.append({
            "id": f"{p.get('warnid')}:{p.get('verlaufid')}",
            "type": wtype,
            "level": wlevel,
            "start": int(start),
            "end": int(end),
        })
    return out


async def _push_severe_warning(warnings: list, now_ts: int):
    """One-time push per warning INSTANCE (warnid:verlaufid) — reissued only when
    the active id changes (new hazard, new level, or the next day's instance of a
    multi-day event). Bypasses the daytime/story-slot gates used by check_and_push:
    an official civil-protection warning isn't our own heuristic, and multi-day
    hazards (e.g. heat) legitimately span the whole day."""
    active = [w for w in warnings if w["start"] <= now_ts <= w["end"]]
    if not active:
        return
    best = max(active, key=lambda w: (w["level"], -w["start"]))
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'last_warning_push_id'")
        row = cur.fetchone()
    if row and row[0] == best["id"]:
        return  # same instance already pushed — no reissue until it changes
    type_de, type_en = WARN_TYPE_NAMES[best["type"]]
    level_de, level_en = WARN_LEVEL_NAMES[best["level"]]
    payload = {
        "type": "severe",
        "title_de": f"{level_de}e Warnung: {type_de}",
        "body_de":  "Offizielle Warnung von GeoSphere Austria für Salzburg — Details in der App",
        "title_en": f"{level_en} warning: {type_en}",
        "body_en":  "Official warning from GeoSphere Austria for Salzburg — see the app for details",
    }
    await push_to_all(payload)
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('last_warning_push_id', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (best["id"],),
        )
    print(f"[warnings] pushed {best['id']} (type {best['type']}, level {best['level']})")


async def fetch_timeline(client: httpx.AsyncClient, point: dict):
    times, precips, _ = await _fetch_timeline_sourced(client, point)
    return times, precips

# Per-cycle nowcast cache (point name → (ts, result)). The forecast loop AND
# check_and_push both request every point's timeline in the same cycle; without this
# that's 2× the GeoSphere nowcast calls, which (with the TAWES calls) tripped GeoSphere's
# 429 rate limit and starved the served nowcast → false "rain then dry" retractions.
# TTL < the 300 s cycle, so each cycle still gets FRESH data but reuses within the cycle.
_nowcast_cache = {}
# Outlives one cycle's own reads (the push check runs ~2½ min in and would otherwise
# re-fetch all 11 points) but expires before the next 5-min cycle reads it, even when
# that cycle's grid fetch fails and its seeding came late in the previous one.
_NOWCAST_TTL = 240

async def _fetch_timeline_sourced(client: httpx.AsyncClient, point: dict):
    """Like fetch_timeline but also returns the source string ('geosphere'|'open_meteo').
    Cached per point for _NOWCAST_TTL so repeated same-cycle requests reuse one call."""
    name = point["name"]
    nowt = datetime.now(timezone.utc).timestamp()
    hit = _nowcast_cache.get(name)
    if hit and nowt - hit[0] < _NOWCAST_TTL:
        return hit[1]
    try:
        times, precips = await fetch_nowcast_timeline(client, point)
        res = (times, precips, "geosphere")
    except Exception:
        data = await fetch_forecast_for_point(client, point)
        res = (data.get("minutely_15", {}).get("time", []),
               data.get("minutely_15", {}).get("precipitation", []),
               "open_meteo")
    _nowcast_cache[name] = (nowt, res)
    return res


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


def save_last_good_ambient(points: list, ts: int):
    """Persist the last complete ambient snapshot (weather + ground + nowcast + AROME)
    so a restart serves real data at once. v2.46.1: saved AFTER enrichment, with its
    ts — it used to be saved before ground/nowcast were attached, so every deploy
    served ~2 min of snapshot with neither and clients fell back to per-IP calls."""
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('last_good_ambient', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"ts": ts, "points": points}),),
        )


def load_last_good_ambient():
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'last_good_ambient'")
        row = cur.fetchone()
    return json.loads(row[0]) if row else None


# A restored gauge reading / nowcast older than this is dropped rather than served as
# current (the client's own stale cap on timelines is also 20 min). Weather fields are
# kept at any age — they only feed comfort notes and are replaced on the first cycle.
RESTORE_FRESH_S = 1200
_TIME_SENSITIVE = ("ground", "ground_ts", "nowcast", "arome")


def _restore_ambient(saved, now_ts):
    """Saved snapshot → (points, ts); (None, 0) if nothing usable. Accepts the pre-v2.46.1
    bare-list format (no ts → treated as stale)."""
    if isinstance(saved, list):
        points, ts = saved, 0
    elif isinstance(saved, dict) and isinstance(saved.get("points"), list):
        points, ts = saved["points"], int(saved.get("ts") or 0)
    else:
        return None, 0
    points = [dict(p) for p in points if isinstance(p, dict)]
    if not points:
        return None, 0
    if now_ts - ts > RESTORE_FRESH_S:
        for p in points:
            for k in _TIME_SENSITIVE:
                p.pop(k, None)
        ts = 0
    return points, ts


def save_last_good_daily(daily: dict, fetched_at: int):
    """Same doctrine as save_last_good_ambient, plus the fetch time — restoring
    only the payload after a restart would make run_cycle think it's fresh and
    skip re-fetching for a full DAILY_TTL_S even if it was actually already
    stale when the process last exited."""
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('last_good_daily', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"daily": daily, "fetched_at": fetched_at}),),
        )


def save_last_good_map_grid(raster: dict, fetched_at: int):
    """The map's forecast raster, so a restart doesn't blank the scrubber's future half
    until the first grid call succeeds — 2026-09-24 it failed on the first two cycles
    after a deploy, and nothing else held a copy."""
    with get_db() as (_, cur):
        cur.execute(
            "INSERT INTO settings (key, value) VALUES ('last_good_map_grid', %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps({"raster": raster, "fetched_at": fetched_at}, separators=(",", ":")),),
        )


def load_last_good_map_grid():
    """Returns (raster, fetched_at) or (None, 0)."""
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'last_good_map_grid'")
        row = cur.fetchone()
    if not row:
        return None, 0
    wrapper = json.loads(row[0])
    return wrapper.get("raster"), wrapper.get("fetched_at", 0)


def load_last_good_daily():
    """Returns (daily, fetched_at) or (None, 0)."""
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = 'last_good_daily'")
        row = cur.fetchone()
    if not row:
        return None, 0
    wrapper = json.loads(row[0])
    return wrapper.get("daily"), wrapper.get("fetched_at", 0)


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
            "minutely_15": "precipitation", "forecast_minutely_15": 48,
            "hourly": "precipitation_probability",
            # v2.18: 6 -> 12 so the served confidence layer spans the whole 12 h the
            # ribbon draws. _filter_virga only ever reads the first 3 h of this, and
            # the client's isUnsettled reads slice(0, 4) — both unaffected.
            "forecast_hours": 12, "timeformat": "unixtime", "timezone": "UTC",
        },
        timeout=15,
    )
    if r.status_code != 200:
        print(f"[ambient] Open-Meteo {r.status_code}: {r.text[:200]}")
        return None
    arr = r.json()
    if not isinstance(arr, list):
        arr = [arr]
    out = []
    for i, p in enumerate(POINTS):
        d = arr[i] if i < len(arr) else {}
        cur = (d or {}).get("current", {}) or {}
        hr  = (d or {}).get("hourly", {}) or {}
        m15 = (d or {}).get("minutely_15", {}) or {}
        out.append({
            "name": p["name"], "lat": p["lat"], "lon": p["lon"],
            "temp": cur.get("temperature_2m"), "wind": cur.get("wind_speed_10m"),
            "code": cur.get("weather_code"),  "precip": cur.get("precipitation"),
            "cape": cur.get("cape"),          "uv": cur.get("uv_index"),
            "ptime": hr.get("time", []),      "pprob": hr.get("precipitation_probability", []),
            # 15-min precip series — the ribbon's fallback when the GeoSphere nowcast is down
            "mtime": m15.get("time", []),     "mprecip": m15.get("precipitation", []),
        })
    return out


# Days shown in the strip (5) + 1, so the last visible row still has a real
# next-midnight to bucket against instead of assuming a 24 h day.
DAILY_FORECAST_DAYS = 6

# v2.36.1 — was fetched every 5-min run_cycle (288 calls/day) for data that only
# needs to change a few times a day; that volume is the likely cause of a live
# "Daily API request limit exceeded" 429 from Open-Meteo that blanked the Coming
# days tab for the rest of the day. 1h → ~24 calls/day, in line with how often a
# day-scale forecast is worth re-asking for.
DAILY_TTL_S = 3600


async def fetch_daily(client: httpx.AsyncClient):
    """Five-day outlook for the CITY CENTRE only (v2.30) — the same single-point
    precedent as city_ground and the severe-weather warnings. A day-scale forecast
    does not vary meaningfully across 11 grid points 3 km apart, so one query
    represents the city; the browser makes no call of its own and the per-IP quota
    is untouched.

    timezone=Europe/Vienna, NOT the UTC the rest of the pipeline uses: this is the
    one place where the day BOUNDARY is itself the data. Asked in UTC, "Wednesday"
    would begin at 02:00 local and the strip would bucket two hours of Tuesday
    evening into it. Timestamps still come back as unix seconds, so nothing
    downstream parses a local-time string.

    The hourly precipitation series rides along on the same call — it is what gives
    each day its shape and its dry window (gaps.dayBuckets / gaps.bestWindow).
    Returns a dict, or None on failure (caller keeps the previous snapshot)."""
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": 47.8009, "longitude": 13.0448,
            # sunrise/sunset (v2.30.1): the strip's "best window" must not offer a
            # dry stretch that runs through the night — see gaps.bestWindow. Free on
            # this call; no extra request.
            "daily": ("weather_code,temperature_2m_max,temperature_2m_min,"
                      "precipitation_sum,precipitation_probability_max,"
                      "sunrise,sunset"),
            "hourly": "precipitation",
            "forecast_days": DAILY_FORECAST_DAYS,
            "timeformat": "unixtime", "timezone": "Europe/Vienna",
        },
        timeout=15,
    )
    if r.status_code != 200:
        print(f"[daily] Open-Meteo {r.status_code}: {r.text[:200]}")
        return None
    d = r.json() or {}
    dy = d.get("daily", {}) or {}
    hr = d.get("hourly", {}) or {}
    times = dy.get("time") or []
    if not times:
        return None
    return {
        "time":  times,
        "code":  dy.get("weather_code", []),
        "tmax":  dy.get("temperature_2m_max", []),
        "tmin":  dy.get("temperature_2m_min", []),
        "psum":  dy.get("precipitation_sum", []),
        "pprob": dy.get("precipitation_probability_max", []),
        "sunrise": dy.get("sunrise", []),
        "sunset":  dy.get("sunset", []),
        "htime":   hr.get("time", []),
        "hprecip": hr.get("precipitation", []),
    }


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


def _last_push_ts(push_type: str):
    with get_db() as (_, cur):
        cur.execute("SELECT value FROM settings WHERE key = %s", (f"last_{push_type}_push_ts",))
        row = cur.fetchone()
    try:
        return float(row[0]) if row else None
    except (TypeError, ValueError):
        return None


def _update_dry_spell(any_wet: bool, now_ts: int):
    """Track the city-wide dry spell (v2.49.0). Returns the last time a spell of
    DRY_RESET_S was completed — the moment every push type becomes free to fire again."""
    def get(key):
        with get_db() as (_, cur):
            cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
            row = cur.fetchone()
        try:
            return float(row[0]) if row and row[0] not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def put(key, value):
        with get_db() as (_, cur):
            cur.execute(
                "INSERT INTO settings (key, value) VALUES (%s, %s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (key, "" if value is None else str(value)),
            )

    dry_start = get("city_dry_start")
    if any_wet:
        put("city_dry_start", None)
    elif dry_start is None:
        put("city_dry_start", now_ts)
    elif now_ts - dry_start >= DRY_RESET_S:
        put("last_dry_reset", now_ts)
    return get("last_dry_reset")


# ---- v2.49.0: pushes run on the SAME rules as the app ---------------------------------
# Audit (2026-09-24): the push path had fallen behind the app. It gave all 11 points the
# same two city gauges (so one shower over Freisaal won the 3-of-11 vote alone), compared
# a raw 10-min gauge sum against 15-min thresholds, read the UNfiltered radar at 0.1 (so
# drizzle and virga pushed "rain incoming" on afternoons the app calls GO ANYWAY),
# promised 30-min gaps the app would not call usable, and had no downpour push at all.
# These constants mirror frontend/src/gaps.js; test_logic reads that file and fails if
# any of them drift apart.
LIGHT_MAX          = 0.5         # gaps.js LIGHT_MAX — "real rain" starts here
DOWNPOUR_MM        = 1.5         # gaps.js DOWNPOUR_MM
GO_MIN_SLOTS       = 3           # gaps.js GO_MIN_SLOTS — a usable window is 45 min
LOOK_AHEAD_S       = 3 * 3600    # gaps.js LOOK_AHEAD
GAUGE_SLOT_SCALE   = 1.5         # gaps.js GAUGE_SLOT_SCALE — RR is per 10 min, slots per 15
PUSH_GAUGE_KM      = 2.5         # gaps.js GAUGE_OWN_KM — a gauge speaks for its neighbourhood
PUSH_GAUGE_MAX_AGE_S = 40 * 60   # gaps.js GAUGE_MAX_AGE_MIN
DOWNPOUR_PUSH_MIN  = 45          # gaps.js GO_MIN_WINDOW — the usable-window horizon
DOWNPOUR_MIN_POINTS = 2          # a convective core covers ~2 of the 11 points, not 3
DOWNPOUR_COOLDOWN_S = 3600       # a downpour push may repeat, but not every cycle
DRY_RESET_S        = 2 * 3600    # a type may fire again after this long city-wide dry


def _gauge_slot(rr):
    """TAWES RR (mm per 10 min) on the 15-min slot scale — gaps.js gaugeSlotValue:
    raise-only, and readings below the reporting line pass through unscaled."""
    v = rr if isinstance(rr, (int, float)) and rr > 0 else 0
    return v if v < DRY_THRESHOLD else v * GAUGE_SLOT_SCALE


def _point_now(point, gauges, times, precips, now_ts):
    """(NOW value, from_gauge) for one grid point: the wettest FRESH gauge within
    PUSH_GAUGE_KM, else the point's own radar slot — the app's NOW rule (v2.48)."""
    near = []
    for g in gauges or []:
        if not isinstance(g, dict) or not isinstance(g.get("rr"), (int, float)):
            continue
        ts = g.get("ts")
        if isinstance(ts, (int, float)) and now_ts - ts > PUSH_GAUGE_MAX_AGE_S:
            continue
        try:
            if _haversine_km(point["lat"], point["lon"], g["lat"], g["lon"]) <= PUSH_GAUGE_KM:
                near.append(g["rr"])
        except (KeyError, TypeError):
            continue
    if near:
        return _gauge_slot(max(near)), True
    if not times:
        return 0.0, False
    i = min(range(len(times)), key=lambda k: abs(times[k] - now_ts))
    p = precips[i] if i < len(precips) and isinstance(precips[i], (int, float)) else 0.0
    return p, False


def _analyze_point(times, precips, now_ts, now_val, threshold=DRY_THRESHOLD):
    """Every push-worthy event at one point (a list; empty if none), on the FILTERED
    series the app itself reads:
      downpour       — >= DOWNPOUR_MM within DOWNPOUR_PUSH_MIN, wet or dry now
      rain_incoming  — dry now, rain >= threshold within 30 min, and real rain
                       (>= LIGHT_MAX) somewhere in the look-ahead: a drizzle-only
                       afternoon is GO ANYWAY in the app, so it is not a rain push
      raining        — wet now (light = below LIGHT_MAX)
      gap / rain_clearing — wet now, a run of GO_MIN_SLOTS dry slots ahead (the app's
                       45-min usable window); open-ended to the series end = clearing"""
    slots = sorted((t, p if isinstance(p, (int, float)) else 0.0) for t, p in zip(times or [], precips or []))
    future = [(t, p) for t, p in slots if now_ts < t <= now_ts + LOOK_AHEAD_S]
    events = []
    dp = next(((t, p) for t, p in future if t <= now_ts + DOWNPOUR_PUSH_MIN * 60 and p >= DOWNPOUR_MM), None)
    if dp:
        events.append({"type": "downpour", "in_min": max(0, round((dp[0] - now_ts) / 60))})
    if now_val < DRY_THRESHOLD:
        if any(p >= LIGHT_MAX for _, p in future):
            hit = next(((t, p) for t, p in future if t <= now_ts + 1800 and p >= threshold), None)
            if hit:
                events.append({"type": "rain_incoming", "rain_in_min": max(0, round((hit[0] - now_ts) / 60))})
        return events
    events.append({"type": "raining", "now": now_val})
    start, count = None, 0
    for t, p in future:
        if p < DRY_THRESHOLD:
            start = t if start is None else start
            count += 1
            continue
        if count >= GO_MIN_SLOTS:
            events.append({"type": "gap", "gap_in_min": max(0, round((start - now_ts) / 60)), "gap_min": count * 15})
            return events
        start, count = None, 0
    if count >= GO_MIN_SLOTS:
        events.append({"type": "rain_clearing", "clears_in_min": max(0, round((start - now_ts) / 60))})
    return events


def _push_events(points, gauges, now_ts, thresholds=None):
    """({type: [events]}, any_point_wet) across the served snapshot's points."""
    by_type, any_wet = {}, False
    for pt in points or []:
        nc = pt.get("nowcast") or {}
        times, precips = nc.get("times") or [], nc.get("precips") or []
        if not times:
            continue
        now_val, _ = _point_now(pt, gauges, times, precips, now_ts)
        any_wet = any_wet or now_val >= DRY_THRESHOLD
        th = (thresholds or {}).get(pt.get("name"), DRY_THRESHOLD)
        for ev in _analyze_point(times, precips, now_ts, now_val, th):
            by_type.setdefault(ev["type"], []).append(ev)
    return by_type, any_wet


def _may_fire(last_ts, last_dry_reset, same_day):
    """Once per EVENT, not once per calendar day (v2.49.0): a type may fire again after
    a city-wide dry spell of DRY_RESET_S has passed since it last fired — so the
    afternoon storm is not silenced by the morning shower — and on a new day."""
    if last_ts is None:
        return True
    if last_dry_reset is not None and last_dry_reset > last_ts:
        return True
    return not same_day


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
    if t == "downpour":
        x = int(event["in_min"])
        soon = x <= 5
        m = max(5, round(x / 5) * 5)
        return {"type": "rain",
                "title_de": "Starkregen über Salzburg — jetzt" if soon else f"Starkregen in ~{m} Min. über Salzburg",
                "body_de":  "Wenn du draußen bist: such dir einen Unterstand",
                "title_en": "Heavy rain over Salzburg — now" if soon else f"Heavy rain over Salzburg in ~{m} min",
                "body_en":  "If you're out: find shelter"}
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
    if t == "forming":
        # Radar-CONFIRMED convective initiation (multiple grid points newly wet +
        # real instability) — the strongest early warning we can honestly give.
        return {"type": "rain",
                "title_de": "Schauer bilden sich über Salzburg",
                "body_de":  "Zellen entstehen gerade in der Region - kann jeden Punkt treffen",
                "title_en": "Showers forming over Salzburg",
                "body_en":  "Cells forming in the area right now - any spot could get hit"}
    return {}


async def check_and_push(client: httpx.AsyncClient, now_ts: int):
    if not _is_push_daytime(now_ts):
        print("[push] outside daytime hours (Salzburg) — suppressed")
        return
    if not _global_gap_ok(now_ts):
        print(f"[push] <{PUSH_MIN_GAP_S // 60} min since last push — skip")
        return

    # v2.49.0 — read the snapshot this cycle just served (filtered per-point series +
    # each gauge's own reading), so a push says what the app says. No new API calls.
    points = _ambient.get("points") or []
    gauges = _ambient.get("gauges")
    thresholds = {}
    for p in POINTS:
        try:
            thresholds[p["name"]] = get_threshold(p["name"], 30)
        except Exception:
            thresholds[p["name"]] = DRY_THRESHOLD
    by_type, any_wet = _push_events(points, gauges, now_ts, thresholds)
    last_dry_reset = _update_dry_spell(any_wet, now_ts)

    # Convective initiation detected this cycle (run_cycle stamps _forming_ts) —
    # already radar-verified across ≥FORMING_MIN_POINTS points, no extra vote needed.
    if _forming_ts and now_ts - _forming_ts < 600:
        by_type["forming"] = [{"type": "forming"}]

    total = len(POINTS)
    counts = {k: len(v) for k, v in by_type.items()}
    print(f"[push] votes: {counts} / {total} (need {MIN_PUSH_AGREEMENT}, downpour {DOWNPOUR_MIN_POINTS})")

    # Story order: forming > downpour > raining now > rain incoming > clearing > gap.
    # Daytime-only + ≥15-min gap (above) + one push per cycle.
    for push_type in ("forming", "downpour", "raining", "rain_incoming", "rain_clearing", "gap"):
        candidates = by_type.get(push_type, [])
        need = 1 if push_type == "forming" else DOWNPOUR_MIN_POINTS if push_type == "downpour" else MIN_PUSH_AGREEMENT
        if len(candidates) < need:
            continue
        last = _last_push_ts(push_type)
        if push_type == "downpour":
            # The one urgent type: may repeat within an event, but not every cycle.
            if last is not None and now_ts - last < DOWNPOUR_COOLDOWN_S:
                continue
        elif not _may_fire(last, last_dry_reset,
                           last is not None and _salzburg_now(last).date() == _salzburg_now(now_ts).date()):
            print(f"[push] {push_type} already fired this event — skip")
            continue
        if push_type == "forming":
            best = candidates[0]
        elif push_type == "raining":
            nows = sorted(e["now"] for e in candidates)
            best = {"type": "raining", "light": nows[len(nows) // 2] < LIGHT_MAX}
        else:
            sort_key = {"downpour": "in_min", "rain_incoming": "rain_in_min",
                        "rain_clearing": "clears_in_min", "gap": "gap_in_min"}[push_type]
            best = min(candidates, key=lambda e: e.get(sort_key, 0))
        payload = _build_payload(best)
        await push_to_all(payload)
        _log_push(now_ts, push_type, payload.get("body_en", ""))
        print(f"[push] {push_type} fired — {len(candidates)}/{total} agreed")
        break  # one push per cycle


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

# The radar nowcast over-reads light echo aloft (virga) on stable days — it paints
# 0.10–0.11 mm (just over the 0.1 "wet" line) while the model reads 0 and probability
# is low. That false "rain" then colours the ribbon AND registers as "rain coming" in
# the verdict (both consume this same timeline). Suppress LIGHT echo only when the
# model's hourly probability is low; heavier radar (real convective cells the model
# misses) and high-probability slots pass through untouched, so genuine onset is kept.
VIRGA_PROB_MIN  = 50     # low-confidence when hourly rain probability is under this
VIRGA_CAP_TO    = 0.4    # cap (not zero) low-confidence LIGHT echo → shows as at most LIGHT
# v2.17.0: 1.5 → 0.8, the shelf fix CLAUDE.md parked for SOFT SPOT ② ("GO ANYWAY light
# drizzle that is actually steady moderate rain"), redeemed by the Nonntal thunderstorm
# of 2026-08-06. Live snapshot at 18:47 CEST: ICON-EU put hour 19 at 43% probability,
# so every slot under 1.5 was clamped — Gneis was served a flat 0.4, 0.4, 0.4, 0.4
# carpet during a hail thunderstorm (code 96/99, AROME 9-14 mm, gauge 1.8 mm/10min).
# Virga is LIGHT by nature (the over-read this filter was built for is 0.10-0.11 mm);
# echo at 0.8+ is real weather, not an artifact, so the lagging model no longer gets
# to call it drizzle. Direction of change is caution-only — leads forgiven, lags never.
VIRGA_HEAVY_PASS = 0.8   # low-confidence echo AT/ABOVE this passes through UNTOUCHED

# ---- Convective-initiation detector (v1.3.0, "Layer 2") -------------------------
# Radar-CONFIRMED formation: several grid points flipping dry → wet within one cycle,
# under real instability (CAPE). This is observation, not speculation — it fires when
# cells ARE forming over the basin, the case no point-forecast can warn about earlier.
FORMING_MIN_POINTS = 3    # newly-wet points required (mirrors MIN_PUSH_AGREEMENT)
FORMING_CAPE_MIN   = 300  # J/kg — below this, new echo is drift/noise, not initiation

def _detect_forming(prev_wet, wet_now, max_cape):
    """Count of points newly wet THIS cycle (dry last cycle). 0 when CAPE is too low
    (stable air → new echo is advection, not initiation) or nothing is new."""
    if (max_cape or 0) < FORMING_CAPE_MIN:
        return 0
    return sum(1 for k, v in wet_now.items() if v and not prev_wet.get(k))

_prev_wet = {}      # point name → was wet last cycle
_forming_ts = 0     # unix ts of the last detected initiation event

# ---- Area watch (v2.4.0, "Layer 3") ---------------------------------------------
# When PART of the 11-point grid is wet, the wet/dry split has a direction: rain
# sitting over the west of the city, clearing in from the north, etc. Comparing the
# wet count against the previous cycle gives the trend (spreading / clearing /
# steady). Radar-observed across the whole basin — the city-scale "which way is it
# moving" signal that per-pixel views can't give.
_AW_SECTORS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

def _area_watch(prev_count, wet_now, coords):
    """wet_now: {name: bool}; coords: {name: (lat, lon)}. Returns
    {'sector','count','trend'} when the grid is PARTIALLY wet, else None (all-dry has
    nothing to report; all-wet has no direction — it's just raining everywhere)."""
    import math
    wet = [n for n, v in wet_now.items() if v]
    total = len(wet_now)
    if not wet or len(wet) == total or total < 2:
        return None
    dry = [n for n in wet_now if n not in wet]
    wlat = sum(coords[n][0] for n in wet) / len(wet)
    wlon = sum(coords[n][1] for n in wet) / len(wet)
    dlat = sum(coords[n][0] for n in dry) / len(dry)
    dlon = sum(coords[n][1] for n in dry) / len(dry)
    # Bearing from the dry centroid toward the wet centroid (N=0°, E=90°); the
    # cos(lat) factor keeps E-W distances honest at Salzburg's latitude.
    dx = (wlon - dlon) * math.cos(math.radians(47.8))
    dy = wlat - dlat
    ang = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    sector = _AW_SECTORS[int(((ang + 22.5) % 360) // 45)]
    trend = ('spreading' if len(wet) > prev_count else
             'clearing' if len(wet) < prev_count else 'steady') if prev_count is not None else 'steady'
    return {'sector': sector, 'count': len(wet), 'trend': trend}

_prev_wet_count = None   # wet-point count last cycle (for the area-watch trend)

def _filter_virga(times, precips, ptime, pprob):
    """Low-confidence echo (model probability < 50%) is CAPPED to ~light, not zeroed —
    EXCEPT heavy echo, which always passes through.

    v1.1.4 REGRESSION FIX: the cap rewrite (v1.1.0) accidentally applied the cap to ALL
    low-probability echo, including a real 2–3 mm convective cell. ICON-EU lags convection,
    so on pop-up shower days its probability stays <50% exactly when the radar sees a real
    downpour — the filter then capped the downpour to 0.4, the ribbon showed "light
    drizzle", the ≥1.5 mm downpour-warning could never fire, and the app said GO ANYWAY
    into a soaking. Radar seeing HEAVY rain is self-evidencing (virga is light echo);
    ≥ VIRGA_HEAVY_PASS therefore passes regardless of what the lagging model thinks:
      • light low-confidence echo (< 1.5) → capped to 0.4 (virga can't paint a storm,
        but a real drizzle still shows),
      • heavy echo (≥ 1.5) → untouched → ribbon shows it, downpour warning can fire,
      • high-probability rain → untouched."""
    if not ptime or not pprob:
        return precips
    out = []
    for t, r in zip(times, precips):
        if r >= VIRGA_HEAVY_PASS:
            out.append(r)           # heavy radar echo is real — never filter it
            continue
        bi = min(range(len(ptime)), key=lambda i: abs(ptime[i] - t))
        prob = pprob[bi] if bi < len(pprob) else None
        out.append(min(r, VIRGA_CAP_TO) if (prob is not None and prob < VIRGA_PROB_MIN) else r)
    return out


async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    now_dt = datetime.now(timezone.utc)
    t0 = time.monotonic()

    async with httpx.AsyncClient() as client:
        # Ambient weather snapshot for the grid (one batched Open-Meteo call) → served
        # to clients so they don't each hit Open-Meteo. Keep the last snapshot on error.
        #
        # Built in `new_points` and swapped into _ambient only once ground + nowcast +
        # AROME are attached (below). Assigning the bare Open-Meteo points here, as this
        # used to, served a snapshot with a FRESH ts but no ground/nowcast for the
        # seconds the GeoSphere calls take — cached 60 s by the browser, 90 s by the
        # client. Clients then fell back to their own per-IP calls (the path that 429s
        # on mobile CGNAT); if the gauge call failed too, the NOW lane was left with
        # Open-Meteo's preceding-hour value, uncapped — a false WAIT caught live 2026-09-24.
        try:
            amb = await fetch_ambient(client)
        except Exception as e:
            print(f"[ambient] {e}")
            amb = None
        skeleton = False
        if amb:
            new_points = amb
        elif _ambient.get("points"):
            # Keep the previous weather fields. Copies, so enriching them below never
            # mutates the list clients are being served mid-cycle.
            new_points = [dict(p) for p in _ambient["points"]]
        else:
            # Open-Meteo failed (e.g. daily limit) AND we have no prior snapshot to keep.
            # GeoSphere may still be fine, so seed a skeleton from POINTS with null weather
            # — the ground + nowcast (attached below, from GeoSphere) then still reach
            # clients instead of the whole snapshot being empty. Decouples our two upstream
            # APIs: one being down no longer wipes the other's data. Client null-guards the
            # weather fields; the virga filter no-ops without probability (serves raw nowcast).
            new_points = [
                {"name": p["name"], "lat": p["lat"], "lon": p["lon"],
                 "temp": None, "wind": None, "code": None, "precip": None,
                 "cape": None, "uv": None, "ptime": [], "pprob": [], "mtime": [], "mprecip": []}
                for p in POINTS
            ]
            skeleton = True

        # Whole-area nowcast grid (v2.44.0), fetched FIRST since v2.46.1: the per-point
        # nowcast IS the nearest grid cell (verified live — every value and timestamp
        # identical), so seeding the per-point cache from it replaces 11 GeoSphere
        # calls per cycle with none. That headroom is what lets the cycle run on true
        # 5-min ticks inside GeoSphere's 240 req/h. A failed grid seeds nothing and the
        # per-point calls below run exactly as before; the previous grid stands for the
        # scrubber rather than blanking it for one bad cycle.
        # v2.47.1: no longer served on /api/ambient — the map reads its own wider grid from
        # /api/nowcast-grid (fetched after the swap, below). This one only seeds the verdict.
        try:
            grid = await fetch_nowcast_grid(client)
            _grid_status["city"] = {"ok": True, "at": now_ts}
        except Exception as e:
            print(f"[nowcast-grid] {e}")
            _grid_status["city"] = {"ok": False, "at": now_ts, "err": _grid_error(e)}
            grid = None
        if grid:
            seeded_at = datetime.now(timezone.utc).timestamp()
            for point in POINTS:
                tl = _grid_timeline(grid, point["lat"], point["lon"])
                if tl:
                    _nowcast_cache[point["name"]] = (seeded_at, (tl[0], tl[1], "geosphere"))

        # Store new forecasts for all points × horizons
        forecast_rows = []
        nowcasts = {}   # point name → full timeline, reused to enrich the ambient snapshot
        aromes   = {}   # point name → AROME hourly tail (v2.7), cached 30 min per point
        for point in POINTS:
            # AROME second model — separate try so its failure can't cost the nowcast row.
            try:
                ar = await _arome_cached(client, point)
                if ar:
                    aromes[point["name"]] = {"times": ar[0], "precips": ar[1]}
            except Exception as e:
                print(f"[arome] cycle {point['name']}: {e}")
            try:
                times, precips, source = await _fetch_timeline_sourced(client, point)
                nowcasts[point["name"]] = {"times": times, "precips": precips}
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

        # Enrich the served ambient snapshot with the per-point nowcast timeline we
        # just fetched. Clients then render the ribbon + gaps from OUR shared server
        # call instead of each hitting GeoSphere directly — which is what fails on
        # mobile CGNAT (thousands of users behind one rate-limited IP). No extra API
        # calls: this reuses the timelines already fetched above for accuracy.
        # Ground (TAWES) reading for the whole city grid — ONE shared fetch. There are
        # only 2 active gauges within 15 km (Freisaal, Airport), so every city point
        # reads the same pair; a single central fetch is representative and avoids 11
        # redundant TAWES calls. Served so clients use this STABLE value instead of each
        # making a per-IP TAWES call that flip-flops under rate limits — when that direct
        # call dropped, the app fell back to the spiky radar current slot and swung
        # GO ANYWAY<->STUCK. None = TAWES genuinely down → client falls back to radar.
        try:
            city_ground, city_ground_ts = await fetch_tawes_reading(client, 47.7985, 13.0469)  # altstadt (central)
        except Exception as e:
            print(f"[ground] {e}")
            city_ground, city_ground_ts = None, None
        # v2.48.0 — the same gauges, each with its own position, so the browser can keep
        # only those within GAUGE_OWN_KM of the user. Same cached call: no extra request.
        # [] on failure = "no gauge anywhere", which the client reads as radar-decides.
        try:
            gauges = await fetch_tawes_gauges(client, 47.7985, 13.0469)
        except Exception as e:
            print(f"[gauges] {e}")
            gauges = []

        # Official GeoSphere/ZAMG severe-weather warnings — municipality-level, one
        # query for Salzburg city centre covers the whole city (same precedent as
        # city_ground above).
        try:
            severe_warnings = await fetch_severe_warnings(client, 47.8009, 13.0448)
            _ambient["warnings"] = severe_warnings
        except Exception as e:
            print(f"[warnings] {e}")
            severe_warnings = []

        # Five-day outlook (v2.30) — city centre. Served, never consulted: nothing
        # in the verdict, the push logic or the accuracy verification reads this.
        # On failure (or inside the TTL) the previous snapshot stands rather than
        # blanking the strip; a day outlook missing for one cycle is not news.
        #
        # v2.36.1 — gated to once per DAILY_TTL_S instead of every 5-min cycle.
        # A day-scale forecast doesn't need 5-min freshness, and calling it 288
        # times a day for data that barely moves is what actually exhausted
        # Open-Meteo's own daily request quota live (429 "Daily API request
        # limit exceeded"), which then blanked the Coming days tab with no
        # retry until midnight UTC. ~24 calls/day instead.
        global _daily_fetched_at
        if now_ts - _daily_fetched_at >= DAILY_TTL_S:
            try:
                daily = await fetch_daily(client)
                if daily:
                    _ambient["daily"] = daily
                    _daily_fetched_at = now_ts
                    try:
                        save_last_good_daily(daily, now_ts)
                    except Exception as e:
                        print(f"[daily] save_last_good failed: {e}")
            except Exception as e:
                print(f"[daily] {e}")

        for pt in new_points:
            pt["ground"] = city_ground   # shared 2-gauge reading (None if TAWES unavailable)
            pt["ground_ts"] = city_ground_ts   # when the gauges measured it, not when we fetched
            nc = nowcasts.get(pt["name"]) if nowcasts else None
            if nc:
                precips = _filter_virga(nc["times"], nc["precips"], pt.get("ptime"), pt.get("pprob"))
                pt["nowcast"] = {"times": nc["times"], "precips": precips}
            # AROME hourly tail (v2.7): served raw (mm/h, radar-assimilating model) —
            # the client unions it with the Open-Meteo 15-min tail, max per slot.
            ar = aromes.get(pt["name"])
            if ar:
                pt["arome"] = ar
        # v2.48.0 — the whole city grid, filtered per cell, for the browser's own 1 km
        # cell. Only from THIS cycle's grid: a stale grid next to fresh points would put
        # two different "nows" on one snapshot. No grid → the key goes, and the browser
        # uses the nearest point's series as before.
        try:
            cells = _city_cells(grid, new_points) if grid else None
        except Exception as e:
            print(f"[cells] {e}")
            cells = None
        # Assigned together, with no await in between: the snapshot never serves one
        # cycle's points next to another cycle's gauges or cells.
        _ambient["gauges"] = gauges
        if cells:
            _ambient["nowcastCells"] = cells
        else:
            _ambient.pop("nowcastCells", None)
        _ambient["points"] = new_points   # one swap: never served half-built
        _ambient["ts"] = now_ts
        _ambient["build_s"] = round(time.monotonic() - t0, 1)   # cycle start → swap
        if not skeleton:   # a null-weather skeleton must not overwrite the last good weather
            try:
                save_last_good_ambient(new_points, now_ts)
            except Exception as e:
                print(f"[ambient] save_last_good failed: {e}")

        # The expanded map's forecast frames (v2.47.1) — AFTER the swap on purpose: this is
        # the largest request in the cycle and nothing in the verdict reads it. On failure
        # the previous raster stands (the client drops steps that have become the past).
        global _map_grid
        try:
            raster = await fetch_map_grid(client)
            _map_grid = raster
            _grid_status["map"] = {"ok": True, "at": now_ts}
            try:
                save_last_good_map_grid(raster, now_ts)
            except Exception as e:
                print(f"[map-grid] save_last_good failed: {e}")
        except Exception as e:
            print(f"[map-grid] {e}")
            _grid_status["map"] = {"ok": False, "at": now_ts, "err": _grid_error(e)}
        _serialise_map_grid()

        # Convective-initiation watch: compare each point's "wet around now" against
        # last cycle. Several dry→wet flips + real CAPE = cells forming over the basin
        # RIGHT NOW → stamp forming_ts (served via /api/ambient → frontend banner) and
        # let check_and_push fire the once-a-day "forming" notification.
        global _prev_wet, _forming_ts, _prev_wet_count
        if nowcasts:
            wet_now = {}
            for name, nc in nowcasts.items():
                near = [p for t_, p in zip(nc["times"], nc["precips"])
                        if now_ts - 900 <= t_ <= now_ts + 900]
                wet_now[name] = bool(near) and max(near) >= DRY_THRESHOLD
            capes = [p.get("cape") for p in _ambient.get("points", [])
                     if isinstance(p.get("cape"), (int, float))]
            max_cape = max(capes) if capes else None
            if _prev_wet and _detect_forming(_prev_wet, wet_now, max_cape) >= FORMING_MIN_POINTS:
                _forming_ts = now_ts
                _ambient["forming_ts"] = now_ts
                print(f"[forming] convective initiation detected (CAPE {max_cape} J/kg)")
            _prev_wet = wet_now
            # Area watch (v2.4): city-scale wet/dry direction + spreading/clearing trend.
            aw = _area_watch(_prev_wet_count, wet_now,
                             {p["name"]: (p["lat"], p["lon"]) for p in POINTS})
            if aw:
                _ambient["area_watch"] = {**aw, "ts": now_ts}
            else:
                _ambient.pop("area_watch", None)
            _prev_wet_count = sum(1 for v in wet_now.values() if v)

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

        try:
            await _push_severe_warning(severe_warnings, now_ts)
        except Exception as e:
            print(f"[warnings] push failed: {e}")


# Fixed 5-min ticks: the wait counts from when a cycle STARTED. A flat sleep(300) after
# a ~150 s cycle made the real cadence ~7½ min (measured live 2026-09-24).
CYCLE_S = 300
CYCLE_MIN_GAP_S = 30   # an overrunning cycle still leaves upstream APIs a breather


async def scheduler():
    while True:
        started = time.monotonic()
        try:
            await run_cycle()
        except Exception as e:
            print(f"[scheduler] error: {e}")
        await asyncio.sleep(max(CYCLE_MIN_GAP_S, CYCLE_S - (time.monotonic() - started)))


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        restored, restored_ts = _restore_ambient(load_last_good_ambient(),
                                                 int(datetime.now(timezone.utc).timestamp()))
        if restored:
            _ambient["points"] = restored
            _ambient["ts"] = restored_ts
            print(f"[ambient] restored last-good snapshot from DB ({len(restored)} points, "
                  f"{'with' if restored_ts else 'without'} ground/nowcast)")
    except Exception as e:
        print(f"[ambient] restore failed: {e}")
    try:
        global _daily_fetched_at
        restored_daily, restored_daily_ts = load_last_good_daily()
        if restored_daily:
            _ambient["daily"] = restored_daily
            _daily_fetched_at = restored_daily_ts
            print(f"[daily] restored last-good outlook from DB (fetched {int(datetime.now(timezone.utc).timestamp()) - restored_daily_ts}s ago)")
    except Exception as e:
        print(f"[daily] restore failed: {e}")
    try:
        global _map_grid
        raster, fetched_at = load_last_good_map_grid()
        # Same freshness rule as the snapshot; the client also drops any step that is
        # already in the past, so an older-but-fresh raster just shows fewer frames.
        if raster and int(datetime.now(timezone.utc).timestamp()) - fetched_at <= RESTORE_FRESH_S:
            _map_grid = raster
            print(f"[map-grid] restored last-good raster from DB (fetched {int(datetime.now(timezone.utc).timestamp()) - fetched_at}s ago)")
    except Exception as e:
        print(f"[map-grid] restore failed: {e}")
    _serialise_map_grid()
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
        "https://server.arcgisonline.com "
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


@app.get("/api/nowcast-grid")
@limiter.limit("30/minute")
def get_nowcast_grid(request: Request):
    """The expanded map's forecast frames (v2.47.1): a regular ~1 km raster over
    MAP_GRID_BBOX, one value array per 15-min step, plus the last outcome of each grid
    call. Fetched by the browser only when the map is expanded. Pre-serialised once per
    cycle; gzipped here when accepted (it is mostly zeros — ~10× smaller)."""
    body = _map_grid_body
    if body is None:
        return JSONResponse({"grid": None, "status": _grid_status}, headers={"Cache-Control": "no-store"})
    raw, gz = body
    headers = {"Cache-Control": "public, max-age=60", "Vary": "Accept-Encoding"}
    if "gzip" in (request.headers.get("accept-encoding") or "").lower():
        headers["Content-Encoding"] = "gzip"
        return Response(content=gz, media_type="application/json", headers=headers)
    return Response(content=raw, media_type="application/json", headers=headers)


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
