# Changelog

All notable, user- or logic-affecting changes to Gemma Raus. Newest first.
Versioning is [SemVer](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change or a full re-architecture.
- **MINOR** — a new feature or a behavioural change to the rain logic.
- **PATCH** — a bug fix or copy/UI tweak with no logic change.

Each release is tagged in git as `vMAJOR.MINOR.PATCH`. To roll back, redeploy the
previous tag (see CLAUDE.md → **Versioning & rollback**).

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
