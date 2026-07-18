---
name: logic-change
description: Mandatory checklist before changing any rain-verdict logic (gaps.js, the App.jsx blend, backend virga/push filters, thresholds). Use whenever a change could alter what verdict, countdown, or wording a user sees.
---

# Changing rain logic — the contract

The verdict logic is an executable contract with a documented precedence ladder.
Changes that "seem obviously right" have caused the worst regressions (v1.1.4:
the virga filter silently hid real downpours — a user got soaked).

## Before writing code

1. Read CLAUDE.md top-to-bottom: core philosophy, Signal Blending, the override
   precedence ladder ("strict one-way ladder"), the two documented SOFT SPOTS,
   and the full Logic change log. If a user report matches a soft-spot symptom,
   apply the shelf fix listed there — do NOT invent a new mechanism.
2. Check the maintainer's doctrine: **leads forgiven, lags never** — any new
   suppression/guard must prove it cannot delay a warning. Dual-key design
   (v2.8.0 `tracePhantom`) is the template: suppress only when TWO independent
   instruments corroborate absence, and never suppress when a witness is unavailable.
3. Run both suites GREEN first: `cd frontend; npm test` and
   `python backend/test_logic.py` (no pytest module on this machine).

## Design rules that must survive your change

- Never let the (lagging) model veto heavy radar echo (≥1.5 mm always passes).
- Never claim a confident all-clear that any of our own sources contradicts.
- Suppression-only guards touch WORDING/trace tiers only — real slots, downpour
  warnings, approach lanes, countdowns, and verdict states never consult them.
- The countdown promise: whenever rain is involved, exactly ONE stable countdown
  is on screen (see CLAUDE.md table). Don't add jitter or false precision.
- Radar owns NOW+3 h; ground gauges own "am I wet"; models own confidence/wording.

## After writing code

4. Add contract tests pinning the new behaviour INCLUDING the release scenario
   (the "user scenario" test) and the incident that motivated it.
5. Both suites + `npm run build` green.
6. CLAUDE.md Logic change log entry (newest first: incident, rule, guards, why
   no lag risk) AND a CHANGELOG entry — together, same commit, never silently.
7. MINOR version bump minimum. Ship via the `release` skill; verify via
   `verify-deploy`.

## Decline gracefully

If the request is a marginal tweak without a concrete mis-decision report
(e.g. "+0.01 to a threshold"), probe live data first (`probe-weather` skill).
Twice, apparent false alarms proved to be correct leads within the hour. The
bar is "absolutely better", not "plausibly nicer".
