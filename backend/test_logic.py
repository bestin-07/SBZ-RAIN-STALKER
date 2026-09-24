"""LOGIC INTEGRITY GUARD — backend rain-logic contract.

Tests the REAL functions from main.py by extracting them via AST (importing main.py
directly would require a live DATABASE_URL). If a change breaks one of these, either
the change is a bug — or the intent changed: update the test AND the CLAUDE.md
Logic change log together. Never silently.

Run:  python backend/test_logic.py
"""
import ast
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def _extract(names):
    """Compile just the named top-level functions/constants out of main.py."""
    src = open(os.path.join(HERE, "main.py"), encoding="utf-8").read()
    tree = ast.parse(src)
    wanted = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            wanted.append(node)
        elif isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if any(t in names for t in targets):
                wanted.append(node)
    mod = ast.Module(body=wanted, type_ignores=[])
    ns = {}
    exec(compile(mod, "main.py<extract>", "exec"), ns)
    return ns


NS = _extract({
    "_filter_virga", "VIRGA_PROB_MIN", "VIRGA_CAP_TO", "VIRGA_HEAVY_PASS",
    "DRY_THRESHOLD", "MIN_PUSH_AGREEMENT",
    "_detect_forming", "FORMING_MIN_POINTS", "FORMING_CAPE_MIN",
    "_area_watch", "_AW_SECTORS",
    "_deaccumulate",
    "DAILY_FORECAST_DAYS", "DAILY_TTL_S",
    "_parse_grid_response", "GRID_BBOX",
    "_tawes_obs_ts",
    "_grid_timeline", "_restore_ambient", "RESTORE_FRESH_S", "_TIME_SENSITIVE",
    "CYCLE_S", "CYCLE_MIN_GAP_S", "_NOWCAST_TTL",
    "_grid_to_raster", "MAP_GRID_BBOX", "MAP_GRID_DLAT", "MAP_GRID_DLON", "MAP_GRID_MAX_KM",
    "_grid_error",
    "_tawes_parse", "_haversine_km", "_city_cells",
    "_gauge_slot", "_point_now", "_analyze_point", "_push_events", "_may_fire",
    "LIGHT_MAX", "DOWNPOUR_MM", "GO_MIN_SLOTS", "LOOK_AHEAD_S", "GAUGE_SLOT_SCALE",
    "PUSH_GAUGE_KM", "PUSH_GAUGE_MAX_AGE_S", "DOWNPOUR_PUSH_MIN", "DOWNPOUR_MIN_POINTS",
    "DOWNPOUR_COOLDOWN_S", "DRY_RESET_S",
})
# _extract compiles functions without main.py's imports; _tawes_obs_ts resolves these
# from its globals (this dict) at call time.
from datetime import datetime as _dt, timezone as _tz  # noqa: E402
NS["datetime"], NS["timezone"] = _dt, _tz


def _main_fn(name):
    with open(os.path.join(HERE, "main.py"), encoding="utf-8") as fh:
        src = fh.read()
    return next(n for n in ast.parse(src).body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)


class TestVirgaFilter(unittest.TestCase):
    """The v1.1.4 contract: light low-confidence echo is capped; HEAVY echo and
    high-confidence rain always pass. The lagging model must never veto heavy radar."""

    def setUp(self):
        self.f = NS["_filter_virga"]
        now = int(time.time())
        self.times = [now + 900 * i for i in range(4)]
        self.ptime = [now + 3600 * h for h in range(4)]
        self.low = [20, 20, 20, 20]    # ICON-EU lagging a convective day
        self.high = [70, 70, 70, 70]

    def test_thresholds_contract(self):
        # Change ONLY with a CLAUDE.md logic-log entry.
        self.assertEqual(NS["VIRGA_PROB_MIN"], 50)
        self.assertEqual(NS["VIRGA_CAP_TO"], 0.4)
        self.assertEqual(NS["VIRGA_HEAVY_PASS"], 0.8)   # v2.17.0: was 1.5
        self.assertEqual(NS["DRY_THRESHOLD"], 0.1)

    def test_real_downpour_survives_lagging_model(self):
        # THE NONNTAL SOAKING (v1.1.4 regression fix): a real 3.4mm convective cell
        # with the model still asleep (prob 20%) must reach the app unfiltered.
        out = self.f(self.times, [0.3, 1.2, 3.4, 2.6], self.ptime, self.low)
        self.assertEqual(out[2], 3.4)   # downpour shows in the ribbon
        self.assertEqual(out[3], 2.6)   # and stays heavy → downpour warning can fire
        self.assertTrue(max(out) >= 1.5, "downpour warning threshold must be reachable")

    def test_virga_light_echo_capped_not_zeroed(self):
        # Stable-day over-read (0.10–0.2mm, prob 20%) → capped to light, NOT hidden:
        # the ribbon shows a drizzle instead of claiming a false 'no rain in 3h'.
        out = self.f(self.times, [0.15, 0.2, 0.12, 0.1], self.ptime, self.low)
        for v in out:
            self.assertLessEqual(v, NS["VIRGA_CAP_TO"])
        self.assertTrue(max(out) >= 0.1, "a real light drizzle must still show")

    def test_low_confidence_moderate_echo_now_passes(self):
        # v2.17.0 (was test_low_confidence_moderate_echo_pulled_into_light_band, which
        # pinned the OLD 1.5 boundary and asserted [0.4]*4 here). Moderate echo at
        # 0.8+ is real weather even when the model is asleep at 20% — only genuinely
        # LIGHT echo below 0.8 still gets pulled into the light band.
        out = self.f(self.times, [0.8, 1.2, 0.9, 0.6], self.ptime, self.low)
        self.assertEqual(out, [0.8, 1.2, 0.9, 0.4])

    def test_nonntal_thunderstorm_2026_08_06(self):
        # THE INCIDENT: user soaked in a hail thunderstorm while the app read
        # PASST SCHON. Replays the real served values — ICON-EU had hour 19 at 43%
        # (just under VIRGA_PROB_MIN), which clamped a whole storm to a flat 0.4
        # carpet. Under the new boundary the moderate slots survive, so the verdict
        # and the ribbon see rain instead of drizzle.
        prob43 = [43, 43, 43, 43]
        out = self.f(self.times, [1.1, 1.3, 0.9, 1.4], self.ptime, prob43)
        self.assertEqual(out, [1.1, 1.3, 0.9, 1.4])
        self.assertGreater(max(out), NS["VIRGA_CAP_TO"],
                           "a thunderstorm must never be served as a flat light-band carpet")

    def test_downpour_warning_always_reachable(self):
        # Structural invariant: the >=1.5mm downpour warning reads the FILTERED
        # timeline, so the filter must never be able to clamp a value from at or above
        # DOWNPOUR_MM. Holds as long as VIRGA_HEAVY_PASS <= 1.5.
        self.assertLessEqual(NS["VIRGA_HEAVY_PASS"], 1.5)
        out = self.f(self.times, [1.5, 4.0, 1.6, 0.05], self.ptime, self.low)
        self.assertEqual(out[:3], [1.5, 4.0, 1.6])

    def test_high_confidence_rain_untouched(self):
        vals = [0.8, 1.2, 0.5, 0.2]
        out = self.f(self.times, vals, self.ptime, self.high)
        self.assertEqual(out, vals)

    def test_no_probability_data_noop(self):
        # Open-Meteo down (v1.1.2 skeleton) → serve the raw nowcast, never guess.
        vals = [0.3, 2.0, 0.1, 0.0]
        self.assertEqual(self.f(self.times, vals, [], []), vals)
        self.assertEqual(self.f(self.times, vals, None, None), vals)

    def test_dry_stays_dry(self):
        out = self.f(self.times, [0.0, 0.0, 0.0, 0.0], self.ptime, self.low)
        self.assertEqual(out, [0.0, 0.0, 0.0, 0.0])


class TestWarningTypeFilter(unittest.TestCase):
    """v2.17.0: official GeoSphere thunderstorm warnings must reach the app.

    `fetch_severe_warnings` is async + does HTTP, so it can't be exercised through the
    AST namespace like the pure functions above. This asserts on its parsed body
    instead — narrow, but it pins the exact regression: a `warntypid == 5` skip that
    threw away the only human-issued storm warning we get (and the only signal with
    headline-override power) because our own CAPE>=1500 heuristic was assumed to cover
    it. During the Nonntal thunderstorm of 2026-08-06 CAPE was 200-260 — it did not.
    """

    def test_thunderstorm_warnings_not_dropped(self):
        with open(os.path.join(HERE, "main.py"), encoding="utf-8") as fh:
            src = fh.read()
        fn = next(n for n in ast.parse(src).body
                  if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                  and n.name == "fetch_severe_warnings")
        for node in ast.walk(fn):
            if not isinstance(node, ast.Compare):
                continue
            left, ops, comps = node.left, node.ops, node.comparators
            if (isinstance(left, ast.Name) and left.id == "wtype"
                    and isinstance(ops[0], ast.Eq)
                    and isinstance(comps[0], ast.Constant) and comps[0].value == 5):
                self.fail("wtype == 5 guard is back — thunderstorm warnings are being "
                          "dropped again (see CLAUDE.md v2.17.0)")


class TestDailyOutlook(unittest.TestCase):
    """v2.30: the five-day strip's day BOUNDARY is itself data.

    `fetch_daily` is async + does HTTP, so this asserts on its parsed body — the same
    narrow technique as the warning test above, pinning the one property that breaks
    silently. Asked in UTC (what every other call in this file uses), a Salzburg day
    would start at 02:00 local and each row would bucket two hours of the previous
    evening. Nothing would error; the strip would just be wrong by two hours forever.
    """

    def _fn(self):
        with open(os.path.join(HERE, "main.py"), encoding="utf-8") as fh:
            src = fh.read()
        return next(n for n in ast.parse(src).body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and n.name == "fetch_daily")

    def test_day_boundaries_are_local(self):
        consts = [n.value for n in ast.walk(self._fn())
                  if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        self.assertIn("Europe/Vienna", consts,
                      "fetch_daily must ask Open-Meteo for Europe/Vienna days — a UTC "
                      "day boundary shifts every row two hours (see CLAUDE.md v2.30)")
        self.assertNotIn("UTC", consts)

    def test_fetches_one_day_beyond_what_is_shown(self):
        # The last visible row needs a real next-midnight to bucket against rather
        # than assuming 24 h, which is wrong on the two DST days a year.
        self.assertEqual(NS["DAILY_FORECAST_DAYS"], 6)

    def test_daylight_bounds_requested(self):
        # v2.30.1: without sunrise/sunset the strip offered "best window Wed
        # 00:00-19:00" on a 22 mm thunderstorm day — arithmetically true, unusable,
        # and able to outrank a genuinely good afternoon. gaps.bestWindow silently
        # falls back to considering the whole day when these are missing, so the
        # regression would be invisible rather than loud.
        params = [n.value for n in ast.walk(self._fn())
                  if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        joined = ",".join(params)
        self.assertIn("sunrise", joined)
        self.assertIn("sunset", joined)

    def test_hourly_series_rides_along(self):
        # The day shape and the dry window both come from the hourly series. If it
        # ever stops being requested the strip silently loses both and shows flat rows.
        consts = [n.value for n in ast.walk(self._fn())
                  if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        self.assertIn("precipitation", consts)

    def test_daily_fetch_is_throttled_not_per_cycle(self):
        # v2.36.1 incident: fetch_daily was called every 5-min run_cycle (288/day)
        # for data that barely changes hour to hour, and that volume is what
        # exhausted Open-Meteo's own daily request quota live — a 429 that then
        # blanked the Coming days tab until the next UTC day with no retry.
        # Floor of 30 min keeps this a throttle, not effectively disabled; ceiling
        # of 4 h keeps the outlook from going stale enough to miss a day boundary.
        self.assertGreaterEqual(NS["DAILY_TTL_S"], 1800)
        self.assertLessEqual(NS["DAILY_TTL_S"], 4 * 3600)


class TestAmbientSnapshot(unittest.TestCase):
    """v2.45.0: /api/ambient must never serve a half-built snapshot.

    run_cycle used to assign the bare Open-Meteo points (fresh ts, no ground/nowcast)
    at the top of the cycle and attach ground + nowcast only after ~13 awaited upstream
    calls. Caught live 2026-09-24: one fetch had neither field, the next had both.
    Clients fell back to per-IP calls, and when the gauge call failed the NOW lane was
    left with Open-Meteo's preceding-hour value — a false WAIT in the dry.
    """

    def _assign_lines(self, fn, key, subscript_of):
        lines = []
        for node in ast.walk(fn):
            if not isinstance(node, ast.Assign):
                continue
            for tgt in node.targets:
                if (isinstance(tgt, ast.Subscript) and isinstance(tgt.value, ast.Name)
                        and tgt.value.id == subscript_of
                        and isinstance(tgt.slice, ast.Constant) and tgt.slice.value == key):
                    lines.append(node.lineno)
        return lines

    def test_points_swapped_in_once_after_enrichment(self):
        fn = _main_fn("run_cycle")
        points = self._assign_lines(fn, "points", "_ambient")
        ts = self._assign_lines(fn, "ts", "_ambient")
        ground = self._assign_lines(fn, "ground", "pt")
        nowcast = self._assign_lines(fn, "nowcast", "pt")
        self.assertEqual(len(points), 1, "_ambient['points'] must be assigned exactly once "
                         "per cycle — an early assignment serves a half-built snapshot")
        self.assertEqual(len(ts), 1)
        self.assertTrue(ground and nowcast)
        self.assertGreater(points[0], max(ground + nowcast),
                           "points must be swapped in AFTER ground/nowcast are attached")
        self.assertGreater(ts[0], max(ground + nowcast),
                           "a fresh ts must not be stamped on a snapshot still being built")

    def test_ground_carries_its_own_timestamp(self):
        fn = _main_fn("run_cycle")
        self.assertTrue(self._assign_lines(fn, "ground_ts", "pt"),
                        "ground_ts must be served next to ground so its age is visible")


def _call_lines(fn, name):
    return [n.lineno for n in ast.walk(fn)
            if isinstance(n, ast.Call) and getattr(n.func, "id", getattr(n.func, "attr", None)) == name]


class TestGridStandsInForPoints(unittest.TestCase):
    """v2.46.1: one grid call replaces the 11 per-point nowcast calls (verified live:
    the per-point series IS the nearest grid cell, every value and timestamp)."""

    GRID = {"times": [100, 1000], "cells": [
        {"lat": 47.800, "lon": 13.040, "precips": [0.1, 0.2]},
        {"lat": 47.809, "lon": 13.040, "precips": [0.5, 0.6]},
        {"lat": 47.800, "lon": 13.053, "precips": [0.9, 1.0]},
    ]}

    def test_picks_the_nearest_cell(self):
        f = NS["_grid_timeline"]
        self.assertEqual(f(self.GRID, 47.8085, 13.041), ([100, 1000], [0.5, 0.6]))
        self.assertEqual(f(self.GRID, 47.8001, 13.052), ([100, 1000], [0.9, 1.0]))

    def test_outside_the_grid_is_none_not_a_far_cell(self):
        self.assertIsNone(NS["_grid_timeline"](self.GRID, 47.90, 13.04))

    def test_no_grid_is_none(self):
        f = NS["_grid_timeline"]
        for g in (None, {}, {"times": [], "cells": []}, {"times": [1], "cells": []}):
            self.assertIsNone(f(g, 47.8, 13.04))

    def test_returns_copies(self):
        times, precips = NS["_grid_timeline"](self.GRID, 47.8, 13.04)
        precips.append(9)
        self.assertEqual(self.GRID["cells"][0]["precips"], [0.1, 0.2])

    def test_grid_is_read_before_the_per_point_loop(self):
        fn = _main_fn("run_cycle")
        grid = _call_lines(fn, "fetch_nowcast_grid")
        point = _call_lines(fn, "_fetch_timeline_sourced")
        self.assertEqual(len(grid), 1)
        self.assertLess(grid[0], min(point),
                        "the grid must seed the per-point cache before the per-point loop "
                        "runs, or all 11 GeoSphere calls come back")


class TestCycleCadence(unittest.TestCase):
    """v2.46.1: a flat sleep(300) after a ~150 s cycle made the real cadence ~7½ min."""

    def test_fixed_ticks(self):
        self.assertEqual(NS["CYCLE_S"], 300)
        self.assertGreater(NS["CYCLE_MIN_GAP_S"], 0)
        fn = _main_fn("scheduler")
        for node in ast.walk(fn):
            if (isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "sleep"
                    and node.args and isinstance(node.args[0], ast.Constant)):
                self.fail("scheduler sleeps a constant again — the wait must count from "
                          "the cycle's START (CYCLE_S - elapsed)")

    def test_nowcast_cache_spans_a_cycle_but_not_two(self):
        # Push check runs ~150 s into the cycle; the next cycle starts 300 s after this
        # one did, and its seeding may itself come up to ~45 s after its start.
        self.assertGreaterEqual(NS["_NOWCAST_TTL"], 180)
        self.assertLessEqual(NS["_NOWCAST_TTL"], 250)


class TestRestoreAmbient(unittest.TestCase):
    """v2.46.1: the snapshot is saved complete (after enrichment) and a restart serves
    it at once — but never a stale gauge reading or timeline as if it were current."""

    PT = {"name": "altstadt", "temp": 15, "ground": 0.6, "ground_ts": 1000,
          "nowcast": {"times": [1], "precips": [0.1]}, "arome": {"times": [], "precips": []}}

    def test_fresh_snapshot_restores_whole(self):
        pts, ts = NS["_restore_ambient"]({"ts": 10_000, "points": [self.PT]}, 10_000 + 300)
        self.assertEqual(ts, 10_000)
        self.assertEqual(pts[0]["ground"], 0.6)
        self.assertIn("nowcast", pts[0])

    def test_stale_snapshot_drops_time_sensitive_fields_keeps_weather(self):
        now = 10_000 + NS["RESTORE_FRESH_S"] + 1
        pts, ts = NS["_restore_ambient"]({"ts": 10_000, "points": [self.PT]}, now)
        self.assertEqual(ts, 0)
        self.assertEqual(pts[0]["temp"], 15)
        for k in NS["_TIME_SENSITIVE"]:
            self.assertNotIn(k, pts[0])
        self.assertIn("ground", self.PT, "must not mutate the saved object")

    def test_legacy_bare_list_is_treated_as_stale(self):
        pts, ts = NS["_restore_ambient"]([self.PT], 10_000)
        self.assertEqual(ts, 0)
        self.assertNotIn("ground", pts[0])

    def test_nothing_usable(self):
        for saved in (None, {}, {"points": []}, "x", [None]):
            self.assertEqual(NS["_restore_ambient"](saved, 1), (None, 0), saved)

    def test_saved_after_the_swap(self):
        fn = _main_fn("run_cycle")
        save = _call_lines(fn, "save_last_good_ambient")
        swap = TestAmbientSnapshot()._assign_lines(fn, "points", "_ambient")
        self.assertEqual(len(save), 1)
        self.assertGreater(save[0], swap[0],
                           "saving before enrichment persists a snapshot with no ground/nowcast")


class TestTawesTimestamp(unittest.TestCase):
    """v2.45.0: the gauge reading's own observation time, parsed from TAWES `timestamps`."""

    def setUp(self):
        self.f = NS["_tawes_obs_ts"]

    def test_offset_form(self):
        self.assertEqual(self.f({"timestamps": ["2026-09-24T09:40+00:00"]}), 1790242800)

    def test_z_and_naive_are_utc(self):
        self.assertEqual(self.f({"timestamps": ["2026-09-24T09:40:00Z"]}), 1790242800)
        self.assertEqual(self.f({"timestamps": ["2026-09-24T09:40"]}), 1790242800)

    def test_takes_latest_when_several(self):
        self.assertEqual(self.f({"timestamps": ["2026-09-24T09:30+00:00",
                                                "2026-09-24T09:40+00:00"]}), 1790242800)

    def test_missing_or_garbage_is_none(self):
        for payload in ({}, {"timestamps": []}, {"timestamps": None},
                        {"timestamps": ["not a date"]}, None, "x"):
            self.assertIsNone(self.f(payload), payload)


class TestNowcastGrid(unittest.TestCase):
    """v2.44.0: the expanded map's time-scrubber reads a whole-area GRID from the
    same GeoSphere nowcast dataset the per-point series already uses (not a new
    instrument) — see CLAUDE.md. `_parse_grid_response` is the pure parse step,
    kept separate from the HTTP call so it's testable against a synthetic response
    without a network mock (RainViewer's own free-tier nowcast is unavailable to
    probe from here in the first place)."""

    def setUp(self):
        self.parse = NS["_parse_grid_response"]

    def _sample(self, n_times=3):
        times = [f"2026-09-18T14:{15*i:02d}:00+00:00" for i in range(n_times)]
        return {
            "timestamps": times,
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [13.045, 47.802]},
                    "properties": {"parameters": {"rr": {"name": "RR", "unit": "kg m-2",
                                                           "data": [0.0] * n_times}}},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [13.05, 47.81]},
                    "properties": {"parameters": {"rr": {"name": "RR", "unit": "kg m-2",
                                                           "data": [0.4, 1.2, 0.0][:n_times]}}},
                },
            ],
        }

    def test_bbox_covers_the_areas_towns(self):
        # Every AREAS surrounding-town dot (frontend/src/api.js) must fall inside the
        # bbox we request, or the scrubber would silently blank out for a wide pan —
        # the failure mode would look like a bug in the overlay, not an undersized box.
        south, west, north, east = (float(x) for x in NS["GRID_BBOX"].split(","))
        towns = [
            ("Hallein", 47.6835, 13.0965), ("Bad Reichenhall", 47.7247, 12.8753),
            ("Freilassing", 47.8366, 12.9699), ("Seekirchen", 47.9021, 13.1316),
            ("Oberndorf", 47.9412, 12.9384), ("Eugendorf", 47.8567, 13.1067),
        ]
        for name, lat, lon in towns:
            self.assertTrue(south <= lat <= north, f"{name} lat outside GRID_BBOX")
            self.assertTrue(west <= lon <= east, f"{name} lon outside GRID_BBOX")

    def test_parses_timestamps_and_cells(self):
        out = self.parse(self._sample())
        self.assertEqual(len(out["times"]), 3)
        self.assertEqual(len(out["cells"]), 2)
        cell = out["cells"][1]
        self.assertAlmostEqual(cell["lat"], 47.81)
        self.assertAlmostEqual(cell["lon"], 13.05)
        self.assertEqual(cell["precips"], [0.4, 1.2, 0.0])

    def test_uppercase_parameter_key_still_parses(self):
        # The OpenAPI schema's own example uses "RR" (uppercase) even though the
        # point endpoint we mirror is confirmed lowercase "rr" — don't assume either.
        sample = self._sample()
        sample["features"][0]["properties"]["parameters"] = {
            "RR": {"name": "RR", "unit": "kg m-2", "data": [0.0, 0.0, 0.0]}
        }
        out = self.parse(sample)
        self.assertEqual(len(out["cells"]), 2)  # both features still usable

    def test_empty_response_raises(self):
        with self.assertRaises(ValueError):
            self.parse({"timestamps": [], "features": []})

    def test_mismatched_length_cell_is_skipped_not_fatal(self):
        sample = self._sample()
        sample["features"][0]["properties"]["parameters"]["rr"]["data"] = [0.0]  # wrong length
        out = self.parse(sample)
        self.assertEqual(len(out["cells"]), 1)  # the other, well-formed cell survives

    def test_all_cells_malformed_raises(self):
        sample = self._sample()
        for f in sample["features"]:
            del f["geometry"]
        with self.assertRaises(ValueError):
            self.parse(sample)


class TestGaugeLocality(unittest.TestCase):
    """v2.48.0: each gauge is served with its OWN reading and position, so the browser can
    keep only the gauges near the user. Before, the city max of Freisaal and the Airport
    was stamped on every address — 0.6 mm at Itzling, 4–5 km away, while it was dry there."""

    STATIONS = [("11350", 47.7869, 13.0569), ("11150", 47.7933, 13.0036)]

    def _feat(self, rr, station=None, coords=None):
        props = {"parameters": {"RR": {"data": [rr]}}}
        if station is not None:
            props["station"] = station
        f = {"properties": props}
        if coords is not None:
            f["geometry"] = {"coordinates": coords}
        return f

    def test_matched_by_station_id(self):
        per, vals = NS["_tawes_parse"]({"features": [self._feat(0.6, "11350"), self._feat(0.0, "11150")]}, [])
        self.assertEqual(per, {"11350": 0.6, "11150": 0.0})
        self.assertEqual(sorted(vals), [0.0, 0.6])

    def test_matched_by_coordinates_when_no_station_id(self):
        feats = [self._feat(0.6, coords=[13.0570, 47.7870]), self._feat(0.1, coords=[13.0035, 47.7932])]
        per, _ = NS["_tawes_parse"]({"features": feats}, self.STATIONS)
        self.assertEqual(per, {"11350": 0.6, "11150": 0.1})

    def test_unmatched_still_counts_for_the_city_max(self):
        # A shape we can't map must not lose the reading the old city max relied on.
        per, vals = NS["_tawes_parse"]({"features": [self._feat(0.4, coords=[14.5, 48.5])]}, self.STATIONS)
        self.assertEqual(per, {})
        self.assertEqual(vals, [0.4])

    def test_garbage_is_skipped(self):
        for payload in (None, {}, {"features": None}, {"features": [{"properties": {}}]},
                        {"features": [self._feat(None, "11350")]}):
            self.assertEqual(NS["_tawes_parse"](payload, self.STATIONS), ({}, []), payload)

    def test_gauges_and_cells_join_the_same_swap(self):
        fn = _main_fn("run_cycle")
        swap = TestAmbientSnapshot()._assign_lines(fn, "points", "_ambient")[0]
        for key in ("gauges", "nowcastCells"):
            lines = TestAmbientSnapshot()._assign_lines(fn, key, "_ambient")
            self.assertEqual(len(lines), 1, key)
            self.assertLess(swap - lines[0], 8, f"{key} must be set right next to the points swap")
            self.assertLess(lines[0], swap)


class TestCityCells(unittest.TestCase):
    """v2.48.0: the browser picks its OWN 1 km cell. Served filtered per cell with the
    nearest point's probability, so at a point's location the cell IS that point's series."""

    TIMES = [1000, 1900, 2800]
    POINTS = [
        {"name": "altstadt", "lat": 47.7985, "lon": 13.0469, "ptime": [1000], "pprob": [20]},   # low prob → virga cap
        {"name": "itzling", "lat": 47.8180, "lon": 13.0350, "ptime": [1000], "pprob": [90]},
    ]

    def _grid(self):
        # 0.6: above the virga cap (0.4), below its heavy pass (0.8) — where the filter acts.
        return {"times": self.TIMES, "cells": [
            {"lat": 47.7986, "lon": 13.0470, "precips": [0.6, 0.3, 0.0]},   # at altstadt
            {"lat": 47.8181, "lon": 13.0351, "precips": [0.6, 0.3, 0.0]},   # at itzling
        ]}

    def test_cell_at_a_point_equals_that_points_filtered_series(self):
        out = NS["_city_cells"](self._grid(), self.POINTS)
        fv = NS["_filter_virga"]
        for i, pt in enumerate(self.POINTS):
            want = [int(round(x * 100)) for x in fv(self.TIMES, [0.6, 0.3, 0.0], pt["ptime"], pt["pprob"])]
            self.assertEqual([step[i] for step in out["v"]], want, pt["name"])

    def test_each_cell_uses_its_nearest_points_probability(self):
        out = NS["_city_cells"](self._grid(), self.POINTS)
        self.assertEqual(out["v"][0], [40, 60])   # step 0: capped near altstadt, not near itzling

    def test_compact_shape(self):
        out = NS["_city_cells"](self._grid(), self.POINTS)
        self.assertEqual(out["times"], self.TIMES)
        self.assertEqual(len(out["lat"]), 2)
        self.assertEqual(len(out["v"]), 3)
        self.assertTrue(all(isinstance(x, int) for step in out["v"] for x in step))

    def test_nothing_to_serve(self):
        for grid in (None, {}, {"times": [], "cells": []}, {"times": [1], "cells": []}):
            self.assertIsNone(NS["_city_cells"](grid, self.POINTS))
        self.assertIsNone(NS["_city_cells"](self._grid(), []))


class TestMapGrid(unittest.TestCase):
    """v2.47.1: the expanded map's forecast frames come from a WIDE grid resampled onto a
    regular lat/lon raster. Live report 2026-09-24: over a radar frame covering the whole
    window, the city-sized grid drew as a small rectangle. The source lattice is tilted in
    lat/lon (Lambert), and more so the further from its central meridian — at this width
    the lat/lon banding gridLattice relied on no longer holds, so every pixel takes its
    nearest source cell instead."""

    KY = 111.2

    def _lattice(self, south, west, n_east, n_north, tilt_deg=0.8, step_km=1.0, value=None):
        """A synthetic tilted ~1 km lattice (tilt above the live west-edge worst of ~0.72°).
        Each cell's value encodes its own index, so a pixel's pick can be traced back."""
        import math
        kx = self.KY * math.cos(math.radians(47.8))
        th = math.radians(tilt_deg)
        feats, cells = [], []
        for ix in range(n_east):
            for iy in range(n_north):
                e, n = ix * step_km, iy * step_km
                x, y = e * math.cos(th) - n * math.sin(th), e * math.sin(th) + n * math.cos(th)
                lat, lon = south + y / self.KY, west + x / kx
                v = value(ix, iy) if value else (ix * 1000 + iy) / 100
                cells.append((lat, lon, ix, iy))
                feats.append({"geometry": {"coordinates": [lon, lat]},
                              "properties": {"parameters": {"rr": {"data": [v, 0.0]}}}})
        data = {"timestamps": ["2026-09-24T11:30+00:00", "2026-09-24T11:45+00:00"], "features": feats}
        return data, cells

    def _raster(self, data, bbox=None):
        return NS["_grid_to_raster"](data, bbox or NS["MAP_GRID_BBOX"], NS["MAP_GRID_DLAT"],
                                     NS["MAP_GRID_DLON"], NS["MAP_GRID_MAX_KM"])

    def test_bbox_covers_a_wide_window_and_the_city_grid(self):
        s, w, n, e = (float(x) for x in NS["MAP_GRID_BBOX"].split(","))
        cs, cw, cn, ce = (float(x) for x in NS["GRID_BBOX"].split(","))
        self.assertTrue(s <= cs and w <= cw and n >= cn and e >= ce, "must contain the city grid")
        # The map can't be panned outside RadarMap's BOUNDS (maxBounds) — all of it covered.
        self.assertTrue(s <= 47.50 and w <= 12.65 and n >= 48.10 and e >= 13.65,
                        "must cover the map's whole pan area (RadarMap BOUNDS)")
        # A window wider than that is centred on it: 1900 px at the default zoom 11 spans
        # ~1.3° lon × ~0.29° lat around 13.15 E.
        self.assertGreaterEqual(min(13.15 - w, e - 13.15), 0.65)
        self.assertGreaterEqual(n - s, 0.6)
        for lat, lon in ((47.8009, 13.0448),):   # Salzburg centre, well inside on every side
            self.assertTrue(s + 0.2 < lat < n - 0.2 and w + 0.4 < lon < e - 0.4)

    def test_full_coverage_every_pixel_is_its_nearest_cell_within_reach(self):
        import math
        # Lattice origin well SW of the bbox, big enough to cover it after the tilt.
        data, cells = self._lattice(47.40, 12.22, 146, 92)
        out = self._raster(data)
        s, w, n, e = (float(x) for x in NS["MAP_GRID_BBOX"].split(","))
        rows, cols = out["rows"], out["cols"]
        self.assertEqual((rows, cols), (round((n - s) / NS["MAP_GRID_DLAT"]), round((e - w) / NS["MAP_GRID_DLON"])))
        self.assertEqual(len(out["v"]), 2)
        self.assertTrue(all(len(step) == rows * cols for step in out["v"]))
        self.assertNotIn(-1, out["v"][0], "a hole inside coverage — the v2.46.1 bug shape")
        by_idx = {(c[2], c[3]): c for c in cells}
        kx = self.KY * math.cos(math.radians((s + n) / 2))
        for r in range(0, rows, 7):
            for c in range(0, cols, 7):
                lat = n - (r + 0.5) * NS["MAP_GRID_DLAT"]
                lon = w + (c + 0.5) * NS["MAP_GRID_DLON"]
                val = out["v"][0][r * cols + c]
                src = by_idx[(val // 1000, val % 1000)]
                d = math.hypot((src[0] - lat) * self.KY, (src[1] - lon) * kx)
                self.assertLessEqual(d, NS["MAP_GRID_MAX_KM"])
                nearest = min(math.hypot((cl[0] - lat) * self.KY, (cl[1] - lon) * kx) for cl in cells
                              if abs(cl[0] - lat) < 0.03 and abs(cl[1] - lon) < 0.04)
                self.assertAlmostEqual(d, nearest, places=6)
        self.assertTrue(all(x == 0 for x in out["v"][1]))

    def test_outside_the_source_is_no_data_not_dry(self):
        # Source covers only the western half: the eastern pixels must read -1 (drawn
        # transparent), never 0 (which would claim "dry" where we have no forecast).
        data, _ = self._lattice(47.40, 12.22, 60, 92, value=lambda ix, iy: 0.0)
        out = self._raster(data)
        cols = out["cols"]
        first_row = out["v"][0][:cols]
        self.assertEqual(first_row[0], 0)
        self.assertEqual(first_row[-1], -1)

    def test_values_are_hundredths_and_missing_is_no_data(self):
        data = {"timestamps": ["2026-09-24T11:30+00:00", "2026-09-24T11:45+00:00", "2026-09-24T12:00+00:00"],
                "features": [{"geometry": {"coordinates": [13.0448, 47.8009]},
                              "properties": {"parameters": {"RR": {"data": [1.53, None, -999.0]}}}}]}
        out = self._raster(data)
        s, w, n, e = (float(x) for x in NS["MAP_GRID_BBOX"].split(","))
        r = int((n - 47.8009) / NS["MAP_GRID_DLAT"])
        c = int((13.0448 - w) / NS["MAP_GRID_DLON"])
        i = r * out["cols"] + c
        self.assertEqual([out["v"][k][i] for k in range(3)], [153, -1, -1])
        self.assertEqual(out["times"], [1790249400, 1790250300, 1790251200])

    def test_bounds_frame_the_raster(self):
        data, _ = self._lattice(47.40, 12.12, 10, 10)
        out = self._raster(data)
        (bs, bw), (bn, be) = out["bounds"]
        self.assertAlmostEqual(bn - bs, out["rows"] * NS["MAP_GRID_DLAT"], places=4)
        self.assertAlmostEqual(be - bw, out["cols"] * NS["MAP_GRID_DLON"], places=4)

    def test_unusable_response_raises(self):
        for data in ({"timestamps": [], "features": []},
                     {"timestamps": ["2026-09-24T11:30+00:00"], "features": [{"geometry": {}}]}):
            with self.assertRaises(ValueError):
                self._raster(data)

    def test_error_names_the_http_status(self):
        class Resp:
            status_code = 429
        class E(Exception):
            response = Resp()
        self.assertIn("429", NS["_grid_error"](E("Too Many Requests")))
        self.assertTrue(NS["_grid_error"](ValueError("x")).startswith("ValueError"))

    def test_map_grid_is_fetched_after_the_swap_and_not_served_on_ambient(self):
        fn = _main_fn("run_cycle")
        swap = TestAmbientSnapshot()._assign_lines(fn, "points", "_ambient")
        fetch = _call_lines(fn, "fetch_map_grid")
        self.assertEqual(len(fetch), 1)
        self.assertGreater(fetch[0], swap[0],
                           "the map's large request must never delay the verdict snapshot")
        self.assertFalse(TestAmbientSnapshot()._assign_lines(fn, "nowcastGrid", "_ambient"),
                         "the grid is served on /api/nowcast-grid, not on the every-client /api/ambient")


class TestPushContract(unittest.TestCase):
    def test_majority_agreement(self):
        # Push notifications need ≥3 of 11 grid points to agree (no single-point alarms).
        self.assertEqual(NS["MIN_PUSH_AGREEMENT"], 3)


class TestPushSameRulesAsApp(unittest.TestCase):
    """v2.49.0: pushes run on the app's rules. The audit found the push path using the
    city-wide gauge max at all 11 points, raw 10-min gauge sums, the unfiltered radar,
    30-min gaps and no downpour type."""

    NOW = 1_790_250_000
    FREISAAL = {"id": "11350", "lat": 47.7911, "lon": 13.0542}
    AIRPORT  = {"id": "11150", "lat": 47.7894, "lon": 13.0086}
    NONNTAL_PT = {"name": "nonntal", "lat": 47.7883, "lon": 13.0553}
    ITZLING_PT = {"name": "itzling", "lat": 47.8268, "lon": 13.0436}

    def series(self, vals, start_off=0):
        return [self.NOW + start_off + 900 * i for i in range(len(vals))], list(vals)

    def test_thresholds_match_the_frontend(self):
        # Anti-drift: the push path must use the SAME numbers as gaps.js.
        import re
        src = open(os.path.join(HERE, "..", "frontend", "src", "gaps.js"), encoding="utf-8").read()
        js = {m.group(1): float(m.group(2)) for m in re.finditer(r"export const (\w+)\s*=\s*([\d.]+)\b(?!\s*\*)", src)}
        self.assertEqual(NS["LIGHT_MAX"], js["LIGHT_MAX"])
        self.assertEqual(NS["DOWNPOUR_MM"], js["DOWNPOUR_MM"])
        self.assertEqual(NS["GO_MIN_SLOTS"], js["GO_MIN_SLOTS"])
        self.assertEqual(NS["GAUGE_SLOT_SCALE"], js["GAUGE_SLOT_SCALE"])
        self.assertEqual(NS["PUSH_GAUGE_KM"], js["GAUGE_OWN_KM"])
        self.assertEqual(NS["PUSH_GAUGE_MAX_AGE_S"], js["GAUGE_MAX_AGE_MIN"] * 60)
        self.assertEqual(NS["DOWNPOUR_PUSH_MIN"], js["GO_MIN_WINDOW"])
        self.assertEqual(NS["DRY_THRESHOLD"], js["DRY_THRESHOLD"])
        self.assertIn("export const LOOK_AHEAD = 3 * 3600", src)
        self.assertEqual(NS["LOOK_AHEAD_S"], 3 * 3600)

    def test_gauge_counts_only_near_it(self):
        # THE AUDIT CASE: a shower over Freisaal (0.6 mm/10 min) is "raining" at Nonntal,
        # not at Itzling 4 km away, where the point's own radar reads dry.
        gauges = [{**self.FREISAAL, "rr": 0.6, "ts": self.NOW - 900}, {**self.AIRPORT, "rr": 0.0, "ts": self.NOW - 900}]
        t, p = self.series([0.0] * 12)
        near, from_gauge = NS["_point_now"](self.NONNTAL_PT, gauges, t, p, self.NOW)
        far, far_gauge = NS["_point_now"](self.ITZLING_PT, gauges, t, p, self.NOW)
        self.assertAlmostEqual(near, 0.9)   # on the 15-min scale
        self.assertTrue(from_gauge)
        self.assertEqual((far, far_gauge), (0.0, False))

    def test_a_stale_gauge_is_ignored(self):
        gauges = [{**self.FREISAAL, "rr": 0.6, "ts": self.NOW - 3 * 3600}]
        t, p = self.series([0.0] * 12)
        self.assertEqual(NS["_point_now"](self.NONNTAL_PT, gauges, t, p, self.NOW), (0.0, False))

    def test_gauge_unit_fix(self):
        # 0.4 mm/10 min is 0.6 on the slot scale: moderate rain, not "light drizzle".
        self.assertAlmostEqual(NS["_gauge_slot"](0.4), 0.6)
        self.assertEqual(NS["_gauge_slot"](0.05), 0.05)   # below the line: untouched
        t, p = self.series([0.6] * 12)
        ev = NS["_analyze_point"](t, p, self.NOW, NS["_gauge_slot"](0.4))
        raining = [e for e in ev if e["type"] == "raining"][0]
        self.assertGreaterEqual(raining["now"], NS["LIGHT_MAX"])

    def test_drizzle_only_afternoon_is_not_a_rain_push(self):
        t, p = self.series([0.0, 0.2, 0.3, 0.25, 0.3, 0.2, 0.3, 0.25, 0.3, 0.2, 0.3, 0.2])
        types = [e["type"] for e in NS["_analyze_point"](t, p, self.NOW, 0.0)]
        self.assertNotIn("rain_incoming", types)

    def test_rain_that_builds_still_pushes(self):
        t, p = self.series([0.0, 0.2, 0.3, 0.6, 0.8, 0.7])
        ev = NS["_analyze_point"](t, p, self.NOW, 0.0)
        self.assertIn("rain_incoming", [e["type"] for e in ev])

    def test_gap_needs_the_apps_45_minutes(self):
        two = self.series([0.6, 0.0, 0.0, 0.6, 0.6, 0.6])
        three = self.series([0.6, 0.0, 0.0, 0.0, 0.6, 0.6])
        self.assertNotIn("gap", [e["type"] for e in NS["_analyze_point"](*two, self.NOW - 1, 0.6)])
        self.assertIn("gap", [e["type"] for e in NS["_analyze_point"](*three, self.NOW - 1, 0.6)])

    def test_downpour_within_45_min_wet_or_dry(self):
        t, p = self.series([0.0, 0.3, 2.0, 0.5])
        dry = NS["_analyze_point"](t, p, self.NOW, 0.0)
        wet = NS["_analyze_point"](t, p, self.NOW, 0.6)
        for ev in (dry, wet):
            dp = [e for e in ev if e["type"] == "downpour"]
            self.assertEqual(len(dp), 1)
            self.assertEqual(dp[0]["in_min"], 30)
        late = self.series([0.0, 0.0, 0.0, 0.0, 2.0])   # 60 min out
        self.assertNotIn("downpour", [e["type"] for e in NS["_analyze_point"](*late, self.NOW, 0.0)])

    def test_push_events_votes_per_point(self):
        pts = []
        for i in range(4):
            t, p = self.series([0.0, 0.0, 1.8, 0.4])
            pts.append({"name": f"p{i}", "lat": 47.80 + i * 0.02, "lon": 13.04, "nowcast": {"times": t, "precips": p}})
        by_type, any_wet = NS["_push_events"](pts, [], self.NOW)
        self.assertEqual(len(by_type["downpour"]), 4)
        self.assertFalse(any_wet)

    def test_once_per_event_not_once_per_day(self):
        f = NS["_may_fire"]
        self.assertTrue(f(None, None, True))                          # never fired
        self.assertFalse(f(1000, None, True))                          # fired today, no dry spell since
        self.assertTrue(f(1000, 2000, True))                           # a 2-h dry spell since → new event
        self.assertFalse(f(1000, 500, True))                           # dry spell was BEFORE it fired
        self.assertTrue(f(1000, None, False))                          # a new day
        self.assertEqual(NS["DRY_RESET_S"], 2 * 3600)
        self.assertEqual(NS["DOWNPOUR_COOLDOWN_S"], 3600)


class TestFormingDetector(unittest.TestCase):
    """Convective-initiation watch (v1.3.0): several points flipping dry→wet in one
    cycle + real CAPE = radar-CONFIRMED formation. Observation, never speculation."""

    def setUp(self):
        self.f = NS["_detect_forming"]

    def test_thresholds_contract(self):
        self.assertEqual(NS["FORMING_MIN_POINTS"], 3)
        self.assertEqual(NS["FORMING_CAPE_MIN"], 300)

    def test_initiation_detected(self):
        # 3 points newly wet under CAPE 400 → event (count reaches the fire line).
        prev = {"a": False, "b": False, "c": False, "d": True}
        cur  = {"a": True,  "b": True,  "c": True,  "d": True}
        self.assertEqual(self.f(prev, cur, 400), 3)

    def test_stable_air_never_fires(self):
        # Same flips but CAPE 100 → drift/advection, not initiation.
        prev = {"a": False, "b": False, "c": False}
        cur  = {"a": True,  "b": True,  "c": True}
        self.assertEqual(self.f(prev, cur, 100), 0)
        self.assertEqual(self.f(prev, cur, None), 0)

    def test_already_wet_points_do_not_count(self):
        # Ongoing rain is not initiation — only dry→wet flips count.
        prev = {"a": True, "b": True, "c": False}
        cur  = {"a": True, "b": True, "c": True}
        self.assertEqual(self.f(prev, cur, 400), 1)


class TestAreaWatch(unittest.TestCase):
    """v2.4 city-scale wet/dry direction + trend — the 'which way is it moving' layer."""

    def setUp(self):
        self.f = NS["_area_watch"]
        # Simplified Salzburg-like grid: two west points, two east points, one centre.
        self.coords = {
            "w1": (47.80, 12.98), "w2": (47.79, 12.99),
            "c":  (47.80, 13.04),
            "e1": (47.80, 13.09), "e2": (47.81, 13.10),
        }

    def test_west_wet_east_dry_reports_west(self):
        wet = {"w1": True, "w2": True, "c": False, "e1": False, "e2": False}
        aw = self.f(None, wet, self.coords)
        self.assertEqual(aw["sector"], "w")
        self.assertEqual(aw["count"], 2)

    def test_east_wet_reports_east(self):
        wet = {"w1": False, "w2": False, "c": False, "e1": True, "e2": True}
        self.assertEqual(self.f(None, wet, self.coords)["sector"], "e")

    def test_all_dry_or_all_wet_reports_nothing(self):
        self.assertIsNone(self.f(None, {k: False for k in self.coords}, self.coords))
        self.assertIsNone(self.f(None, {k: True for k in self.coords}, self.coords))

    def test_trend_spreading_and_clearing(self):
        wet = {"w1": True, "w2": True, "c": True, "e1": False, "e2": False}
        self.assertEqual(self.f(2, wet, self.coords)["trend"], "spreading")  # 2 → 3
        self.assertEqual(self.f(4, wet, self.coords)["trend"], "clearing")   # 4 → 3
        self.assertEqual(self.f(3, wet, self.coords)["trend"], "steady")
        self.assertEqual(self.f(None, wet, self.coords)["trend"], "steady")  # first cycle


class TestDeaccumulate(unittest.TestCase):
    """v2.7 AROME support: accumulated rr_acc series → per-interval amounts.
    Negatives clamp to 0 (a new model base time can reset the accumulator)."""

    def setUp(self):
        self.f = NS["_deaccumulate"]

    def test_basic_diff(self):
        self.assertEqual(self.f([0.0, 0.5, 0.5, 2.0]), [0.0, 0.5, 0.0, 1.5])

    def test_accumulator_reset_clamps_to_zero(self):
        # 3.0 → 0.2 would diff to -2.8; per-interval rain can't be negative.
        self.assertEqual(self.f([1.0, 3.0, 0.2, 0.4]),
                         [1.0, 2.0, 0.0, 0.2])

    def test_non_numeric_values_are_dry(self):
        self.assertEqual(self.f([None, 1.0, "x", 1.5]), [0.0, 1.0, 0.0, 1.5])

    def test_empty(self):
        self.assertEqual(self.f([]), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
