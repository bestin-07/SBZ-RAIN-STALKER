# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone in Salzburg, Austria (city + immediate surroundings, ~50 km radius) who is about to step outside — walking, cycling, commuting, deciding whether to bring an umbrella or leave the bike at home — and needs a fast, trustworthy answer in the next few seconds of looking at their phone. Mostly a PWA installed on a phone home screen, opened for a two-second glance, not a sit-down session. No account, no persistent identity beyond an anonymous localStorage "story." German (Austrian dialect: "Gemma Raus" = "let's go outside!") as the primary voice, English as a full parallel translation — not a formal register, a friend telling you whether to grab a jacket.

## Product Purpose

Gemma Raus answers exactly one question: *when can I go outside without getting wet, right now, in this exact spot in Salzburg?* It is deliberately not a general weather app and does not try to mirror the exact weather outside for its own sake — it exists to let a user make a fast decision about the near future (next ~3 hours). Success is a correct, calm verdict — GEMMA RAUS (go) / PASST SCHON (light rain, go anyway) / WAIT N MIN / BLEIB DRIN (stay in) — that never sends someone into rain it could have warned them about, and never keeps someone inside longer than the weather actually requires. Free, no account, no tracking, installable as a home-screen app.

## Positioning

Generic weather apps run one national/global model at city-block resolution and treat every location and every minute the same. Gemma Raus is built entirely around one Salzburg-specific structural fact: within 15 km of the city there are only 2 active physical rain gauges (Freisaal, Airport), so *no single instrument is trustworthy alone*. The product's real mechanism — and what a competitor could not truthfully copy without doing the same work — is a two-lane blend with a strict, audited override precedence ladder: the **NOW lane** trusts the ground (physical TAWES gauges + RainViewer pixel sampling at the user's exact GPS), the **NEXT lane** trusts the GeoSphere 1 km/15-min radar nowcast for countdowns, and a documented, test-pinned precedence chain (ground magnitude → drizzle surfacing → gapNow → downpour override → wording softeners) decides what the single headline says when the instruments disagree. Every past misfire is recorded as a live incident with root cause and a regression test, so the decision logic itself is the asset, not the UI chrome around it. Doctrine: "leads forgiven, lags never" — an early warning is acceptable, a late one is a product failure — and "better someone stays inside than gets sent into rain."

## Operating Context

- Used outdoors or about-to-go-outdoors, in bright sunlight, often one-handed, often with poor mobile signal (rural/CGNAT mobile networks) — the app must degrade gracefully when APIs 429 or GPS is slow.
- Alpine convective weather: storms can fire and intensify within 15-20 minutes from a clear sky, faster and more locally than flatland weather; every design decision (thresholds, gauge scaling, virga filtering, storm CAPE banners) is calibrated for this environment and documented as Salzburg/Alpine-specific, not portable to other regions without recalibration.
- Refreshes every 5 minutes automatically, plus manual pull-to-refresh; a per-minute on-device ticker decrements countdowns between refreshes so numbers never freeze or jump.
- Installed PWA on phones (iOS and Android) is the primary real-world context, not desktop browsing — though a desktop reading column exists.
- The maintainer (sole developer) reports live incidents by voice transcript from real usage (expect phonetic mangling of place/source names) and expects each report to be investigated against live data before any logic change, never patched speculatively.

## Capabilities and Constraints

**Core capability:** hyper-local (GPS-exact) dry-window detection for the next 3 hours, blending 6 real-time data sources (Open-Meteo ICON-EU, GeoSphere TAWES ground stations, GeoSphere 1km/15min radar nowcast, RainViewer pixel-level radar sampling, GeoSphere AROME model, official GeoSphere/ZAMG severe weather warnings) behind one clear verdict, plus a 5-day outlook (best dry window, day shapes) that is explicitly advisory-only and never overrides the 3-hour verdict.

**Hard constraints:**
- All rain/radar data fetches are client-side (browser → external API directly, per-GPS) except a handful of city-scale-only fields (ambient temp/wind/CAPE/UV/daily outlook/official warnings) which the backend fetches once per 5-min cycle and shares across users to avoid per-IP rate-limit exhaustion. GPS coordinates never reach the backend.
- No user accounts, no tracking, no persistent server-side identity. LocalStorage only, disclosed in the privacy copy.
- iOS 13.4+ / equivalent-era Android is the real support floor (documented per-feature: `AbortSignal.timeout` shimmed, `ResizeObserver` guarded, `100dvh` fallback, etc.) — this is a "mostly old phones" product, not a "mostly latest phones" product.
- Geolocation must be user-gesture-triggered (Safari/Firefox suppress silent prompts), with explicit denied/blocked-state handling and a Salzburg-center fallback so the app works even without GPS.
- Scope is Salzburg city + ~50 km; beyond that the app shows a "Salzburg misses you" screen rather than serving unreliable far-away data. Geographic expansion is explicitly not a current goal.
- Free-tier constraint: RainViewer/GeoSphere/Open-Meteo public APIs are rate-limited per user IP; the architecture (client-side fetch, backend-shared ambient fields, response caching) exists specifically to stay inside those limits without a paid data plan.

**Terminology:** "NOW lane" (ground truth, is it raining on me right now) vs "NEXT lane" (radar nowcast, when does rain start/stop) is the core internal vocabulary and appears in the UI's own source-attribution line so a user can see which instrument produced the verdict.

## Brand Commitments

- **Name:** "Gemma Raus" (Austrian dialect for "let's go outside!") — not translated or renamed in English mode; only the supporting copy translates.
- **Voice:** first-person, casual, Austrian-dialect-inflected German ("passt scho", "Kapuze auf", "geh ruhig") with a warm, dry-humored English parallel — never formal-register meteorological language. Status one-liners are rotating variant pools (3 per state per language), stable per-user per-day, so repeat visits don't feel robotic. This voice also governs the CHANGELOG ("Gemma Raus just got better: ...").
- **Colour system:** a fixed 5-state palette (GO gold, light cyan, WAIT blue, STUCK dark blue, RED-warning red) shared byte-for-byte between the headline, the ribbon chart, and the day-strip legend, with a separately tuned light/dark theme pass for WCAG-AA contrast — this consistency (headline always matches its own legend swatch) is treated as load-bearing, not cosmetic.
- **Assets:** `frontend/public/logo.svg` and the existing icon set (favicons, apple-touch-icon, android-chrome, maskable, og-image) are the current, user-maintained brand assets — treat as fixed unless the user asks to replace them.
- **Fonts:** Space Grotesk (display/bold), JetBrains Mono (body/data), Inter (secondary sans) — already chosen and wired through Tailwind tokens.
- **Domain/identity:** live at gemmaraus.at; imprint names Bestin Antu as author/operator.
- Roadmap notes in the original README (native iOS/Android apps, expansion to other Austrian/European cities) are stale planning artifacts from before the product matured and are not live commitments — Salzburg-only, PWA-only is the confirmed scope.

## Evidence on Hand

No testimonials, case studies, press, or marketing claims exist or should be fabricated — the FAQ/structured-data copy in `index.html` states only mechanism and pricing (free), not social proof. The real evidentiary asset is internal: CLAUDE.md's "Logic change log" is an extensive, dated record of real live incidents (verified against live API data before any fix), each with root cause, fix, and a regression test — this is product-quality evidence for *how the decision logic behaves*, not user-facing testimonial evidence, and should not be surfaced as marketing proof.

## Product Principles

1. **One clear verdict beats more data.** Six data sources and a precedence ladder exist so the user sees one sentence, not a dashboard — new information should sharpen the verdict/countdown, never add a second competing number to read.
2. **Leads forgiven, lags never.** Any new suppression, cap, or softening rule must prove it cannot delay a warning; escalating early is an acceptable cost, escalating late is a product failure.
3. **The countdown promise is sacred.** Whenever rain is involved, exactly one stable, rounded (not falsely precise), locally-ticking countdown is on screen — jitter and re-computation noise are treated as UX bugs, not acceptable side effects of "more accurate" data.
4. **Display and verdict are separate layers.** Cosmetic/informational additions (sky line, 5-day outlook, source attribution, alert banners) must never be able to alter `getStatus`'s state machine — every display-layer release explicitly audits and states "verdict path untouched."
5. **Change logic only when absolutely better, never "plausibly nicer."** Every rain-logic change is investigated against live data first, gated by the executable test contract (both suites, before and after), and logged with reasoning — marginal tweaks are declined by default.

## Accessibility & Inclusion

WCAG 2.1 AA is the real target. Colour tokens are already tuned per-theme for AA contrast on the cream/dark backgrounds (see Brand Commitments), and interactive icons/controls carry translated `aria-label`s (e.g. the v2.27.0 activity-icon rework replaced hardcoded English titles with per-language labels). Treat any new interactive element or status colour as needing the same AA contrast check and translated labeling, not just visual polish.
