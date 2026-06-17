from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import sqlite3
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import os

POINTS = [
    {"name": "altstadt",   "lat": 47.7985, "lon": 13.0469},
    {"name": "bahnhof",    "lat": 47.8127, "lon": 13.0449},
    {"name": "lehen",      "lat": 47.8097, "lon": 13.0200},
    {"name": "schallmoos", "lat": 47.8190, "lon": 13.0600},
    {"name": "maxglan",    "lat": 47.7930, "lon": 13.0250},
]

DB_PATH = os.getenv("DB_PATH", "accuracy.db")
DRY_THRESHOLD = 0.1  # mm per 15min slot


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
    conn.commit()
    conn.close()


async def fetch_forecast_for_point(client: httpx.AsyncClient, point: dict) -> dict:
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": point["lat"],
            "longitude": point["lon"],
            "minutely_15": "precipitation",
            "forecast_minutely_15": 24,
            "timeformat": "unixtime",
            "timezone": "UTC",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


async def fetch_current_for_point(client: httpx.AsyncClient, point: dict) -> float | None:
    r = await client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": point["lat"],
            "longitude": point["lon"],
            "current": "precipitation",
            "timezone": "UTC",
        },
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("current", {}).get("precipitation")


async def run_cycle():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    conn = sqlite3.connect(DB_PATH)

    async with httpx.AsyncClient() as client:
        # Store new forecasts for horizons 30, 60, 90 min
        for point in POINTS:
            try:
                data = await fetch_forecast_for_point(client, point)
                times = data.get("minutely_15", {}).get("time", [])
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

        # Verify forecasts whose target time has passed
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
                print(f"[cycle] verification failed for {point_name}: {e}")

    conn.commit()
    conn.close()


async def scheduler():
    while True:
        try:
            await run_cycle()
        except Exception as e:
            print(f"[scheduler] error: {e}")
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
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
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/accuracy")
def get_accuracy():
    conn = sqlite3.connect(DB_PATH)
    cutoff = int(datetime.now(timezone.utc).timestamp()) - 7 * 86400
    result = {}

    for horizon in [30, 60, 90]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) as total,
                SUM(CASE
                    WHEN (predicted_precip < ? AND actual_precip < ?) OR
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
