# Changelog

All notable, user- or logic-affecting changes to Gemma Raus. Newest first.
Versioning is [SemVer](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change or a full re-architecture.
- **MINOR** — a new feature or a behavioural change to the rain logic.
- **PATCH** — a bug fix or copy/UI tweak with no logic change.

Each release is tagged in git as `vMAJOR.MINOR.PATCH`. To roll back, redeploy the
previous tag (see CLAUDE.md → **Versioning & rollback**).

---

## [1.1.0] — 2026-07-06 — Catch the drizzle the gauges miss
Policy shift toward caution: **better to keep someone in than send them into rain.**

### Changed (rain logic)
- **Surface a light drizzle when the gauge reads dry.** When a TAWES gauge reads dry
  but the radar / RainViewer see a **light** echo (0.1–0.5 mm) at your spot the sparse
  gauges miss, the verdict now shows **GO ANYWAY** instead of GEMMA RAUS. Only light
  echo surfaces — bumped into the light band, **capped so it can never become a false
  STUCK**; a genuine heavier cell keeps the ground's dry call. (`effectivePrecip`,
  loadData + computeStatusAt; `rvRainActive` suppresses the `gapNow` override.)
- **Virga filter caps instead of zeroing.** Low-confidence echo (< 50% probability) is
  now capped to ~light (0.4 mm) rather than zeroed. This stops the ribbon claiming a
  false "no rain in 3 h" over a real drizzle, while still preventing a low-confidence
  heavy echo from painting a storm / forcing STUCK.

### Trade-off (accepted)
On a genuinely dry virga day the app may occasionally say "GO ANYWAY, light drizzle"
when it's actually dry — the deliberate price of never sending someone into rain.

---

## [1.0.0] — 2026-07-06 — First public release
First version shipped to the public. Consolidates the stability + accuracy work.

### Added
- **Imminent-downpour warning** — GO / light states surface "heavy rain in ~X min"
  when the (virga-filtered) radar shows ≥1.5 mm within 30 min, so "go anyway" can't
  walk you into a convective downpour the model missed.
- **Install-as-app prompt** — one-time, closable nudge ~2 s after load for new users;
  browser-aware (Chrome/Edge install button, iOS Safari Share sheet, Android → Chrome).
- **Passive "notice" voice** for map popups (separate from the first-person banner).
- **Rain-ribbon dry/empty label** ("no rain in the next 3 h" vs "waiting for data").
- **App version** shown in the info panel.

### Changed / Fixed (rain logic & data)
- **Ground reading served from the backend** — stabilises the NOW verdict; ends the
  GO ANYWAY↔STUCK flip caused by the per-IP TAWES call failing under rate limits.
- **Nowcast served from the backend** — fixes the ribbon/verdict flip-flopping on
  mobile CGNAT (per-IP GeoSphere rate limits).
- **Virga filter** — suppresses light radar echo the model rejects (stable-day false rain).
- **Rain ribbon reads the same ground-truth as the headline** (no rain↔dry flicker).
- **Map dot you're standing in mirrors your live headline** (no transient mismatch).
- **Relocate crosshair** — spinner feedback + 10 s cooldown + 30 s cap.

_Full logic history: CLAUDE.md → **Logic change log**._
