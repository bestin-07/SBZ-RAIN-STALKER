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
})


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
        self.assertEqual(NS["VIRGA_HEAVY_PASS"], 1.5)
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

    def test_low_confidence_moderate_echo_pulled_into_light_band(self):
        # 0.8–1.2mm at 20% prob (below HEAVY_PASS) → capped to 0.4: can't paint a
        # storm or force STUCK, but still visible as light.
        out = self.f(self.times, [0.8, 1.2, 0.9, 0.6], self.ptime, self.low)
        self.assertEqual(out, [0.4, 0.4, 0.4, 0.4])

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
