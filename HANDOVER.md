# HANDOVER — written 2026-07-19

Point-in-time snapshot for the next assistant/model taking over. Durable knowledge
lives elsewhere — this file only says *where*, plus what was in flight when written.
If this file is more than a few weeks old, trust CLAUDE.md and git history over it.

## Where knowledge lives (read in this order)

1. **CLAUDE.md** — the canon: architecture, data sources, the verdict decision tree,
   override precedence ladder (+ 2 documented soft spots with shelf fixes), the full
   Logic change log, and the **Operations handbook** (maintainer doctrine, API-quota
   hard rule, deploy verification, dev-machine quirks, UI contracts).
2. **`.claude/skills/`** — invocable playbooks: `release`, `verify-deploy`,
   `probe-weather`, `logic-change`. Use them; don't re-derive procedures.
3. **Claude Code project memory** (auto-loaded on the maintainer's machine) —
   user doctrine, machine environment, API exhaustion history, deploy verification.
4. **CHANGELOG.md** — user-facing release history in the house voice.
5. **`frontend/src/gaps.test.js` + `backend/test_logic.py`** — the executable
   contract. 149 + 20 tests. Every past incident is pinned as a named test.

## State when written

- **v2.9.0 live** (commit 768be30, tagged): the iOS round — RainRibbon frozen-drift
  fix (float accumulator; iOS rounds scrollLeft), scrollable main column (banner
  stacks no longer lock the page), logo → landing view, dvh shell/sheets,
  AbortSignal.timeout polyfill for iOS ≤ 15. Zero rain-logic changes.
- **v2.8.0** before it: dual-key phantom-trace guard (`tracePhantom`) — the
  doctrine template for any future suppression logic.
- All tests green; CI ("Logic integrity guard") green; deploy verified via sw.js
  stamp `gemma-raus-202607180927`.

## In flight / watchpoints

- **iOS fixes await real-device confirmation** from the maintainer's iPhone:
  does the ribbon drift now? (If not: check iOS Reduce Motion first — the
  auto-drift no-op under it is by design.) Does the page scroll under stacked
  banners? Does the logo return to the landing page?
- **2026-07-18 rain band event**: radar (INCA + RainViewer motion extrapolation)
  beat wetter.com's model track — drizzle arrived in Salzburg on the radar's
  schedule (~13:45) after wetter.com said it would miss the city. A later INCA
  run softened the heavy 4+ mm slots to traces (band decaying over the Alpine
  ridge). Outcome of the full afternoon unverified — if the maintainer reports
  back, log any lesson in CLAUDE.md if it changes doctrine; otherwise let it go.
- **No open bugs known.** Two threshold-tweak proposals were withdrawn after live
  data validated current behaviour (details in the memory `user-doctrine` and the
  probe-weather skill's "artifacts that are NOT bugs" list) — don't reopen them
  without a concrete mis-decision report.

## The two soft spots on the shelf (from CLAUDE.md — symptoms to watch for)

1. "GEMMA RAUS while I'm still getting wet" → gapNow vs wet gauge; shelf fix:
   require the gap to be ≥1 slot old when the gauge is wet.
2. "GO ANYWAY light drizzle that's actually steady moderate rain" → the
   0.5–1.5 mm low-confidence band; shelf fix: `VIRGA_HEAVY_PASS` 1.5 → 0.8.

Apply the shelf fix when a report matches; don't invent new mechanisms.

## How to work with the maintainer

Voice-transcript reports (expect phonetic mangling), evidence over assurance
(probe safely, show numbers), leads forgiven / lags never, keep-them-inside bias,
warm changelog voice, and the bar for logic changes is "absolutely better" —
not "plausibly nicer".
