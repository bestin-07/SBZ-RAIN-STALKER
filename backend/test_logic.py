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


class TestPushContract(unittest.TestCase):
    def test_majority_agreement(self):
        # Push notifications need ≥3 of 11 grid points to agree (no single-point alarms).
        self.assertEqual(NS["MIN_PUSH_AGREEMENT"], 3)


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
