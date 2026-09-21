# Changelog

All notable, user- or logic-affecting changes to Gemma Raus. Newest first.
Versioning is [SemVer](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change or a full re-architecture.
- **MINOR** — a new feature or a behavioural change to the rain logic.
- **PATCH** — a bug fix or copy/UI tweak with no logic change.

Each release is tagged in git as `vMAJOR.MINOR.PATCH`. To roll back, redeploy the
previous tag (see CLAUDE.md → **Versioning & rollback**).

---

## [2.44.2] - 2026-09-21 - Gemma Raus just got better: the slider's out of the crosshair's way, and dry reads as dry instead of blank 🎯

*Two more live reports, same day: the slider pill was overlapping the "center on me" button, and dry stretches on the new overlay still looked like nothing was there.*

**What happened**

The slider sat close to the bottom-right corner, the same corner the recenter button lives in — on some screens they crowded each other. Separately, a genuinely dry forecast (which is most of the time) was drawn so faintly on the new overlay that it was easy to mistake for "not working" rather than "correctly showing dry."

**What's new for you**

- **The slider moved up**, clear of the recenter button, so both are easy to tap.
- **A small tick mark on the slider track now shows exactly where "now" is** — drag past it to see the forecast.
- **Dry areas on the overlay are a touch more visible now** — still clearly fainter than real rain, but no longer looking like nothing rendered.
- A small colored dot next to the time label now matches whether you're looking at measured radar or the forecast.

**Nothing about the verdict changed.**

---

## [2.44.1] - 2026-09-21 - Gemma Raus just got better: the future overlay actually shows up now, and the slider's easier to grab 🎚️

*Two reports on the map slider within days of it shipping: "I don't see anything on the map" while scrubbing forward, and the map rendering incorrectly on some iPhones.*

**What happened**

We checked the live data first rather than guessing: the future forecast was genuinely there, just genuinely dry everywhere at that moment — and drawn as hundreds of nearly-transparent little circles, a dry forecast looked identical to nothing rendering at all. Separately, painting all those circles is exactly the kind of extra work that can trip up older iPhone browsers, which lines up with the rendering report.

**What's new for you**

- **The future overlay is now one smooth, soft-edged wash of color** instead of hundreds of tiny separate dots — much easier to actually see, and it should also be kinder to older iPhones.
- **A dry forecast still looks faint** — that's honest, not a bug — but it no longer looks broken.
- **The slider is bigger and easier to drag**, with a proper thumb you can actually grab, and the time label next to it is larger and easier to read at a glance.

**Nothing about the verdict changed.** Purely how the same trusted forecast is drawn.

---

## [2.44.0] - 2026-09-18 - Gemma Raus just got better: the map can now show you the future 🗺️

*The map's radar loop only ever showed the last 40 minutes — RainViewer, the free radar service it uses, quietly stopped sending forecast frames at all. You could watch rain arrive on the headline countdown, but never actually see it approaching on the map itself.*

**What happened**

The radar animation on the map has always cycled through a handful of past frames. It used to also splice in a few minutes of RainViewer's own short forecast — but that free forecast feed has gone quiet (we checked live: zero frames, consistently), so lately the loop was showing pure history and nothing ahead. Meanwhile the app's own weather brain already reads a real 3-hour rain forecast for the whole city, every 5 minutes — it just wasn't drawn on the map yet.

**What's new for you**

- **Tap the map to expand it, and a time slider appears along the bottom.** Drag it left for the last ~40 minutes of real radar history, or right past "now" into a genuine 3-hour-ahead forecast — the same trusted forecast that already drives the headline above, now painted across the whole map as soft colored patches instead of just a single number.
- A small label above the slider always says exactly what you're looking at — "Radar 14:32" for the past, or "Nowcast 15:15 · +45 min" for the future.
- The small map you see before tapping is untouched — same quick auto-looping radar reel as always. The slider only shows up once you've expanded the map, so nothing changes until you actually want to look ahead.

**Nothing about the verdict changed.** This is a new way to LOOK at data the app already trusts — `getStatus`, every threshold, and the countdown on the headline are all byte-identical.

---

## [2.43.0] - 2026-09-18 - Gemma Raus just got better: the ribbon now knows what kind of dry it is ☀️

*A dry tile has always just been a flat line — no matter if it's a clear afternoon or a grey overcast one. It looked the same either way, and the storm tiles couldn't tell you if heavy weather meant lightning, hail, or just wind.*

**What happened**

Every dry tile on today's ribbon drew the exact same plain line, whether the sky outside was blue or solid grey — and every storm tile drew the same generic cloud-and-bolt, whether it was a thunderstorm, hail, or a gale. Nothing distinguished them, so the ribbon told you *when* it was dry or stormy but never quite *what to expect*.

**What's new for you**

- **Dry tiles now show a filled sun, moon, or cloud** — sun during the day, moon at night, and a plain cloud on a grey, overcast dry stretch. The day/night split follows the real sunrise and sunset for today, so a dry evening naturally drifts from sun to moon as you scroll the ribbon forward.
- **Storm tiles are now specific**: a lightning bolt for a thunderstorm, a cloud with hail for a thunderstorm carrying hail, and the familiar cloud-and-bolt for general severe weather when the exact type isn't known.
- Rain and drizzle tiles are untouched — same blue drops, same "more drops for heavier rain" read as before.

**Nothing about the verdict changed.** This only changes which icon a dry or storm tile draws — `getStatus`, every threshold and every countdown are byte-identical.

---

## [2.42.2] - 2026-09-18 - Gemma Raus just got better: a capital D 🔤

*Spotted from a live screenshot within minutes of the last release: "dry for a good while, take your time" as the biggest text on screen, lowercase d and all.*

**What happened**

The rotating sub-line phrases ("dry for hours, take your time" and its variants) are written lowercase-first on purpose — that's the app's established casual voice for sub-lines everywhere. Since 2.41.x, the dry state promotes one of those phrases into the HEADLINE slot instead of repeating the brand name — and a headline that starts lowercase just reads like a typo, even though the sentence itself is fine as a sub-line.

**What's new for you**

- **The promoted GO headline now always starts with a capital letter.** Every other sub-line, in every other state and language, is untouched — this only affects the one spot where a sub-line phrase is standing in as the headline.

**Nothing about the verdict changed.** One capitalized letter at the render site; the underlying text and every threshold are untouched.

---

## [2.42.1] - 2026-09-18 - Gemma Raus just got better: the guide button is back 🔧

*Same-day fix, reported within the hour: the 44px touch-target pass made the header's icon row too wide on a narrow phone, and the guide ("?") button quietly ran off the edge of the screen.*

**What happened**

v2.42.0 grew every header icon button to a proper 44×44px touch target — five buttons, all a little wider than before. On a narrow phone that pushed the row past the edge of the screen, and since nothing in that row wraps or scrolls, the last button (the guide/"?" button) rendered off-screen and unreachable. Separately, once the guide's status legend was visible next to the app's real headline behaviour, it was clear the two had drifted apart: the guide still paired an all-caps colored badge with a separate grey sentence, but the real GO-state headline is now a single colored sentence (see 2.41.x), so the badge+description format no longer matched what the app actually shows. And the new guide sentences (English) weren't capitalized — readable, but sloppy next to the rest of the panel, which is.

**What's new for you**

- **The manual refresh button is gone.** It was a fifth button doing the same job pull-to-refresh (the swipe-down gesture) already does — pull-to-refresh itself is completely untouched and works exactly as before. Removing the duplicate also frees up the room the guide button needed.
- **The guide's four status examples are now one colored sentence each**, not a badge plus a separate grey line — matching how the real headline reads on screen, still fully color-coded per state.
- **The new guide sentences now start with a capital letter**, in English, like the rest of the panel.

**Nothing about the verdict changed.** Header layout, a guide-panel legend, and a copy fix — `getStatus`, every threshold and every countdown are untouched.

---

## [2.42.0] - 2026-09-18 - Gemma Raus just got better: easier to read, easier to reach, easier to install 🧭

*A pass through the main screen with fresh eyes — a few things were saying the same thing twice, a few things were too small to tap, and the "install this" nag had gotten annoying.*

**What happened**

The dry state used to say "dry" four times in a row (a giant "GEMMA RAUS" repeating the header's own name, a tagline, a "Radar frei" chip, and a "Trocken" line) — noisy, and it buried the one line that actually mattered. The radar time on the map just showed a clock ("Radar 15:10") with no sense of how old that reading actually was. A few small caps labels ("Boden 0.0 mm", "SICHERHEIT", the dry-window bracket) were quietly failing contrast guidelines, and the header's icon buttons and the "Add to home screen" strip were sized for a mouse, not a thumb. And that install strip nagged on every single visit with no way to dismiss it for good.

**What's new for you**

- **Less repetition on the home screen.** The dry-state headline is now the one line that actually says something ("dry for hours, take your time") instead of repeating the app's own name; the redundant "Radar frei"/"Trocken" restatements are gone.
- **The radar time now tells you its age**, not just its clock time — "radar 12 min ago" instead of a bare timestamp — and turns muted with a note if the reading (or the feed itself) has gone stale.
- **All clock times are 24-hour, everywhere**, including a spot that had been quietly rendering in 12-hour AM/PM.
- **The confidence bars now carry a visible number** ("4/5") and reach screen readers properly, not just a row of decorative dashes.
- **Header buttons and the map popup are easier to tap and to read** — every icon button now has a proper touch-sized hit area, small caps labels are brighter, and a map popup can no longer render clipped off-screen. Escape closes it and hands focus back where you were.
- **The "install this app" nudge is now a proper one-time popup**, closable and remembered — it won't nag you again once dismissed. If you change your mind later, there's now a small, device-aware "Install app" button right in the guide (☰ → the install section).
- **The in-app guide's "how to use this" section got a rewrite** — same information, much shorter and plainer, so a first-time visitor can skim it in seconds. The technical bits (data sources, how ground vs. radar readings are blended, the disclaimer) are untouched.

**Nothing about the verdict changed.** This release is display, layout, accessibility and copy only — `getStatus`, every threshold, and every countdown are byte-identical.

---

## [2.41.6] - 2026-09-18 - Gemma Raus just got better: the source icon actually looks like radar now 📡

*Same-day fix — the first pass didn't look like what it was supposed to.*

**What happened**

v2.41.5 added a little icon next to the "Radar"/"Forecast model" label, but the shapes were wrong: the radar glyph read as a wifi signal, and the model glyph read as four separate app icons rather than a grid. Caught immediately and redrawn against the same reference.

**What's new for you**

- **Radar is now an actual radar-scope circle** with a sweeping beam and a centre blip.
- **The model icon is now one connected grid** with a contour line running through it, instead of four floating squares.

**Nothing about the verdict changed.** Two redrawn icons; every threshold, countdown and state is untouched.

---

## [2.41.5] - 2026-09-18 - Gemma Raus just got better: the chart now shows you which instrument is talking 📡

*A small addition, asked for directly: make it obvious at a glance whether you're looking at radar or a forecast model.*

**What happened**

The scrub readout already told you in words whether a moment was "Radar" or a "Forecast model" — but a word takes a beat longer to read than a shape, and the two instruments genuinely work differently: radar sweeps outward from a dish, a model computes rain over a grid. Nothing wrong, just an easy thing to make faster to read.

**What's new for you**

- **A small icon now sits next to the source label**, switching automatically as you scrub the chart: radiating arcs for radar, a small grid for the forecast model.
- Purely a glance-speed aid — the text label is still there and still says the same thing.

**Nothing about the verdict changed.** One decorative icon next to a label; every threshold, countdown and state is untouched.

---

## [2.41.4] - 2026-09-18 - Gemma Raus just got better: you can finally scroll all the way to the end 🏁

*A real bug: the last stretch of the chart existed, but nothing could scroll it into view.*

**What happened**

The chart's "now" line sits fixed a little left of centre while the tiles scroll under it — but the browser only lets you scroll until there's nothing left to reveal, and there wasn't enough room reserved after the last tile for it to ever actually reach that line. You could see the last few hours of the 12-hour chart, but never scroll far enough to bring them fully into place.

**What's new for you**

- **You can now scroll (or press End) all the way to the last tile**, with room to bring it right up to the "now" line, on any screen size.
- **The dry tiles' own outline is a shade lighter in dark mode**, matching the visible outline dashed forecast tiles already had.

**Nothing about the verdict changed.** Scroll range and one border colour.

---

## [2.41.3] - 2026-09-18 - Gemma Raus just got better: a fourth guide tile, and the dark-mode borders are back 🌓

*Two more rounds of same-day screenshot feedback.*

**What happened**

The in-app guide explained three of the four things a tile can show you — measured, predicted, sources disagree — but not the small "drizzle possible" corner marker, the one thing a reader would actually see and have nowhere to look up. Separately, fixing the boxed panel's dark-mode contrast a moment ago had a side effect nobody caught until a screenshot showed it: the tiles' own thin outline almost vanished into the new panel colour, and the scroll fade — which reveals that same panel colour — got harder to see along with it.

**What's new for you**

- **The guide now shows a fourth example tile**, the drizzle marker, using the exact same wording as the chip on the real chart.
- **Dark mode's tile outlines are visible again**, and the panel itself sits at a shade that doesn't erase them.
- **The scroll fade is crisper** — solid right up to near the edge, then a shorter, sharper cut, instead of a long, hard-to-notice taper.

**Nothing about the verdict changed.** Colour, contrast and one guide illustration — the chart's decisions are untouched.

---

## [2.41.2] - 2026-09-18 - Gemma Raus just got better: three polish fixes from your own screenshots 🔧

*Same-day follow-up, off a light-mode/dark-mode comparison.*

**What happened**

Three small things stood out once the new chart was actually on screen: the little "drizzle possible" dot looked like a stray blurred blob floating above a tile rather than something that belonged to it; the boxed panel barely stood out from the background in dark mode, which also made the right-edge scroll fade nearly invisible; and the dry-window label's underline sat close enough to the tiles below it to visually clip into them.

**What's new for you**

- **The drizzle marker is now a small, solid badge** in the tile's corner — same idea as the "sources disagree" ring, just a different corner, so the two can never collide.
- **The chart's boxed panel has real contrast now**, especially in dark mode — a new, more deliberate elevation shade instead of the subtler one shared with popups. The scroll fade reads much more clearly against it.
- **More breathing room above the tiles**, so the dry-window label's underline no longer sits on top of the icons.

**Nothing about the verdict changed.** All three are spacing and colour only.

---

## [2.41.1] - 2026-09-18 - Gemma Raus just got better: the new rain chart icons are actually visible now 🙈

*A live screenshot, minutes after v2.41.0 shipped, caught the tiles rendering empty.*

**What happened**

The icon tiles from v2.41.0 shipped with a real rendering bug: the little rain/drizzle/storm glyphs were never told to actually draw a visible line, so every tile rendered as a blank box — no icon, just an empty shape. The automated tests didn't catch it because they check the underlying markup, not what a browser actually paints, so it took an eyes-on comparison against the design mockup to spot.

**What's new for you**

- **The tile icons draw correctly now** — dry, drizzle, rain and storm all show their glyph, solid and white on a measured radar tile, outlined in colour on a forecast tile, exactly as designed.

**Nothing about the verdict changed.** A pure rendering fix to the chart shipped an hour earlier.

---

## [2.41.0] - 2026-09-18 - Gemma Raus just got better: the rain chart is icon tiles now, and confidence tells the truth on a dry day 🌦️

*A redesigned rain chart, and a genuine bug fix hiding underneath it.*

**What happened**

The rain chart's gradient shape was replaced with something closer to a standard weather app: a row of small icon tiles, one per time slot, that fill in solid when radar has actually measured the rain and outline in a dashed style when it's the forecast model's best guess for later. A small ring on a tile means the two sources — radar and the forecast model — disagree there, instead of two different squiggly markers doing that job before.

While rebuilding it, a real bug turned up: the little "confidence" bar next to the chart was reading the model's *chance of rain* as if it were confidence in general — so on a completely dry, highly predictable day, it showed the lowest bar possible, every time. A 3% chance of rain when the forecast says "dry" is about as confident a forecast as you can get; the bar now reads it that way.

**What's new for you**

- **The rain chart is now icon tiles** — solid and filled where it's measured, dashed and outlined where it's predicted — sitting inside its own clearly bordered panel so it reads as one object on the screen, not loose chart ink.
- **The chart's right-edge "there's more, scroll →" fade is more obvious now**, and it no longer nudges itself sideways after a few seconds of you not touching it — the fade alone tells you it scrolls, so nothing moves without your say-so.
- **The "confidence" reading is fixed.** A calm, dry forecast now correctly shows high confidence instead of always bottoming out — worth knowing if you've ever wondered why it looked unsure on an obviously settled day.
- **The dry stretch label moved above the chart**, and the in-app guide was rewritten to match — two sources, radar and forecast model, in three short lines instead of a chart diagram.

**Nothing about GEMMA RAUS / WAIT / BLEIB DRIN changed.** This is the chart's own presentation and one readout number — every threshold behind the actual verdict is untouched.

---

## [2.40.0] - 2026-09-17 - Gemma Raus just got better: quieter for accessibility, and steadier at the edges 🩹

*A cross-device compatibility pass — mostly things you'll never notice, which is the point.*

**What happened**

A full audit of how the app behaves across phones and browsers turned up a few small rough edges: the map's grow/shrink animation and the relocate spinner kept moving even for people who've told their phone to reduce motion, and on a notched phone held sideways, the header could sit right up against — or under — the camera cutout. Neither was ever reported by name; they were the kind of thing that just makes an app feel slightly less considered on the device it happens to catch out.

**What's new for you**

- **If you've turned on "Reduce Motion"** (iOS Accessibility, or the equivalent Android setting), the map's tap-to-expand and the relocate button's spinner now respect it — they settle instantly instead of animating.
- **On a notched phone held sideways**, the header no longer risks sitting under the camera cutout — it now leaves proper room on both sides.
- **A new hidden diagnostic mode** (`?debug=1` on the end of the URL) adds a small on-screen log for anyone helping track down a "the app keeps reloading itself" report — it's invisible unless you ask for it.

**Also, behind the scenes:** a Playwright test suite now checks the manifest, theme/status-bar sync, reduced-motion handling and a few other cross-browser details automatically on every future change.

**Nothing about the verdict changed.** Every fix here is animation, layout or diagnostics — what the app decides about the rain is byte-identical.

---

## [2.39.6] - 2026-09-17 - Gemma Raus just got better: a hint that the chart keeps going 👉

*A small, standing cue that the rain chart scrolls, not just a one-time nudge.*

**What happened**

The rain chart already gives a quick wiggle the first time you open the app, teaching you it can be dragged sideways — but that only plays once. After that, its right edge looked flush and complete, with nothing suggesting there was more to see.

**What's new for you**

- **The chart's right edge now shows a soft fade**, with the next bar peeking through half-cut-off — a quiet, standing hint that there's more ahead if you scroll. It fades away on its own once you've actually reached the end, so it never promises more than is really there.

**Nothing about the verdict changed.** Purely how the chart presents itself — what the app decides is untouched.

---

## [2.39.5] - 2026-09-17 - Gemma Raus just got better: the German hour marks stopped overlapping 🕐

*A small locale bug, caught from a screenshot.*

**What happened**

The little "00 · 12 · 18 · 24" hour markers above the Coming days rows overlapped into a garbled mess — but only in German. The cause: German's own way of writing an hour adds the word "Uhr" ("16 Uhr" instead of just "16"), and the markers were laid out assuming a short, bare number in every language.

**What's new for you**

- **The hour markers above the Coming days rows are clean in both languages now** — just the numbers, no overlap.

**Nothing about the verdict changed.** A formatting fix to a row that only orients the eye — what the app decides is untouched.

---

## [2.39.4] - 2026-09-17 - Gemma Raus just got better: a cleaner Coming days tab 🧹

*A small trim, on request: one line that wasn't earning its place.*

**What happened**

The Coming days tab had a "best window: Wed 14:00–18:00" line naming the longest dry stretch coming up. It wasn't necessary — the five-day rows below it already show the same thing visually, in colour, and the line was just repeating that in words.

**What's new for you**

- **The "best window" line is gone** from the top of the Coming days tab. The day rows underneath are untouched — the shape, colours, temperatures, and rain chances still tell you everything you need, just without a sentence restating it.
- The in-app guide's explanation of that line is gone with it, so the help panel doesn't describe something that's no longer on screen.

**Nothing about the verdict changed.** This only touches the five-day outlook's own header text — what the app decides about right now is untouched.

---

## [2.39.3] - 2026-09-17 - Gemma Raus just got better: the confidence bar is back, and the expanded map finally has room to breathe 🗺️

*A same-day follow-up: one visual call reversed after a closer look, plus a real bug the ring's replacement never caused but happened to be sitting next to.*

**What happened**

The confidence dial from earlier today didn't stick — back to the row of blocks, now with a small "confidence" word next to it so it's clear what it's showing. Separately, a screenshot caught the expanded map cutting off a location popup at the edge of the screen: the map only ever grew to the middle of the screen, and a popup near the bottom of that shorter box had nowhere to move to stay on screen.

**What's new for you**

- **Confidence is a row of blocks again**, with a small "confidence" label so it reads clearly even without the dial's motion.
- **The "Radar" / "Forecast model" word in the scrub readout is darker and a size larger** — it was getting lost next to everything else on that row.
- **The expanded map now grows all the way up to just under the tabs**, instead of stopping halfway down the screen. Popups near the map's edges now have the room they need to stay fully on screen.

**Nothing about the verdict changed.** Every bit of this is presentation — what the app decides is untouched.

---

## [2.39.2] - 2026-09-17 - Gemma Raus just got better: a quieter ribbon, with confidence as a dial instead of a paragraph 🎯

*A pass on the scrub readout, off a set of marked-up screenshots: too many words saying the same thing twice.*

**What happened**

The little readout you get when you tap or drag the rain ribbon had drifted into repeating itself. A pinned row above the chart spelled out "RADAR · NEXT 2½ H ⋯ FORECAST · MODEL", while the readout right below it was already telling you the same thing — which instrument, how sure — as you dragged across the chart. And "forecast model, dry" was naming the exact same thing the line right underneath it already said in one word: "Dry".

**What's new for you**

- **The pinned "RADAR · NEXT X H / FORECAST · MODEL" row is gone.** The readout's own source line already tells you which instrument you're looking at as you drag, and the chart itself still visually separates measured (solid fill) from estimated (dashed outline) — nothing was lost, just said once instead of twice.
- **A small confidence dial replaces the row of blocks.** It fills and empties smoothly as you scrub across the ribbon — full for radar, a touch lower for an unconfirmed trace echo, lower still for a forecast estimate, and lower again if the two forecast models disagree.
- **The source line is down to two words** — "Radar" or "Forecast model" — instead of a sentence explaining how sure it is. That nuance now lives in the dial.
- **Fixed "forecast model, dry"** repeating the "Dry" status right below it.

**Nothing about the verdict changed.** This only touches how the ribbon's scrub readout presents itself — what counts as rain, a break, or a warning is untouched.

---

## [2.39.1] - 2026-09-17 - Gemma Raus just got better: the next 2½ hours are in sharper focus 🔍

*A follow-up pass on yesterday's chart, plus a subtle bug caught by testing every possible "now" rather than trusting one.*

**What happened**

The chart's radar section — the part backed by real, measured readings — was drawing at the same 30-minute resolution as the forecast section, which just estimates. That threw away real detail exactly where the app has the most to show. Separately, the "now" marker was resting on the start of its own 15-minute window rather than the actual moment, which could read as a few minutes behind. And while testing the fix, a genuine edge case turned up: at one particular moment, a slice of data right at the boundary between "measured" and "estimated" could silently vanish from the chart entirely.

**What's new for you**

- **The next ~2½ hours now show in 15-minute steps** instead of 30 — the measured part of the chart is more detailed, because it can be. The forecast portion beyond that stays at 30 minutes, since a model's hourly estimate doesn't get more true by drawing it more often.
- **The "now" marker sits on the actual moment**, not just the start of the nearest quarter-hour.
- **Fixed a rare case** where a moment right at the edge of the measured section could disappear from the chart instead of being drawn.
- The scrub readout (tap or drag the chart to see any point) is now two tidy rows instead of three.

**Nothing about the verdict changed.** All of this is how the chart reads — what counts as rain, a break, or a warning is untouched.

---

## [2.39.0] - 2026-09-17 - Gemma Raus just got better: tap the map to fill the screen, and the ribbon's time-marker finally holds still 🗺️

*A batch of interface fixes and two small features, tested live before shipping — including one fix for a feature that shipped, then genuinely didn't do anything, caught by actually clicking it rather than assuming the code was right.*

**What happened**

The rain ribbon's little time-marker — the line that's supposed to always mark "the moment you're looking at" — turned out to be a passenger on its own scroll container: drag the ribbon and it drifted along with the chart instead of staying put on screen, and on a long drag it could scroll fully out of view. It also sat flush against the very left edge, reading more like "the start of the chart" than a point on a longer timeline. Separately, tapping the town map to make it bigger was wired up and genuinely did nothing — the map already filled all the space it had down to the bottom of the screen, so growing "downward" landed it in the exact same spot. And the little "cloudy, 16°" glance at the top was saying much the same thing as a banner sitting right below it.

**What's new for you**

- **Tap the map to grow it.** It smoothly expands to around half the screen — tap the ✕, tap anywhere still visible above it, or just press your phone's back button, and it shrinks back down.
- **The ribbon's time-marker finally stays put.** It's now genuinely fixed on screen while you drag the chart underneath it, never drifts and never disappears, and it no longer sits jammed against the left edge.
- **The ribbon nudges itself forward** on its own if you leave it alone for a few seconds — touch it and it stops immediately, so it never fights you.
- **One redundant banner retired.** "Cloudy but dry" is gone — the sky glance and the headline already cover it between them. That same sky glance is also hidden while you're on the five-day outlook tab, since it's a right-now reading with nothing to say about Friday.

**Nothing about the verdict changed.** Every bit of this is what the app shows you and how you interact with it — not what it decides.

---

## [2.38.1] - 2026-09-17 - Gemma Raus just got better: the slider works on desktop now, and it never fibs about "light rain" 🩹

*A handful of real reports on yesterday's ribbon redesign, fixed the same day.*

**What happened**

A few rough edges showed up fast once real people were dragging the new ribbon around. On a wide desktop browser window it just... didn't scroll — turned out there was nothing to scroll, since the ribbon's own content could be narrower than a really wide window. The little time-cursor could drift out of sync with "now" after a background refresh landed while you weren't looking. And sharpest of all: the slider's own reading called a 0.15mm drop "Light rain" while the big headline above it still said GEMMA RAUS — which, fair question, looked like a contradiction. It wasn't a wrong verdict: the app has always treated anything under 0.2mm as still fine to go, on purpose, but the ribbon's new reading hadn't been told that.

**What's new for you**

- **The ribbon drags properly on desktop now**, no matter how wide your window is.
- **The time-cursor stays honest** — it re-homes to "now" every time fresh data comes in, not just when you tap the button.
- **The slider's own reading agrees with the headline.** A faint 0.1–0.2mm reading now says "barely a drizzle" instead of overselling it as light rain — the same line the app was already drawing, just not repeated correctly in the new spot.
- Readout moved above the chart, "back to now" moved down next to the ribbon it actually resets, the drizzle legend dot finally has its colour, and the ribbon now stops precisely at the 12-hour mark it claims to cover.

**Nothing about the verdict changed.** Every fix here is the display catching up to what the app already decided — not a new decision.

---

## [2.38.0] - 2026-09-17 - Gemma Raus just got better: drag the ribbon, and faint drizzle finally looks like faint drizzle 🌫️

*A design pass on today's chart, worked through against a few mocked-up directions before picking one.*

**What's new for you**

- **The rain ribbon is a slider now.** Drag it (or swipe on your phone), and a small readout follows your finger — the time, "dry" or "faint drizzle possible" or whatever's there, and how sure we are about it. Let go near the start and a "back to now" button snaps it home. First time you open it, it gives itself a little nudge so you notice it moves.
- **Faint drizzle finally looks like faint drizzle.** It used to get a couple of extra pixels of height on the chart — barely visible, and easy to mistake for the start of real rain. Now it gets its own soft, drifting marker instead, so a trace of drizzle can never be confused with confirmed rain just because the bar got slightly taller.
- **A confidence readout**, right in the new slider panel: full marks over the radar's own next couple of hours (it's measuring, not guessing), and an honest lower reading further out, or when the two forecast models don't agree with each other.
- **Less repeating itself.** The chart used to sometimes say "dry" three ways at once — a sentence floating over it, a bracket underneath it, and the shape itself. Now the bracket carries the plain "still dry" claim, and the floating sentence only shows up when it has something new to add, like rain expected later.
- **A little breathing room back** on the big headline, which had grown wide enough to nearly touch both edges of the screen.

**Nothing about the verdict changed.** Same thresholds, same countdowns, same decision — this is what it looks like and what you can do with it, not what it decides.

---

## [2.37.2] - 2026-09-16 - Gemma Raus just got better: dry stays dry-coloured, and the key is back 🩹

*Two more real reports, same day.*

**What happened**

The chart's colour key — the little swatch explaining the blue-to-red scale — didn't make it into the shipped chart, even though it was part of the design that was approved. And separately: a genuinely dry stretch was still picking up a faint blue tint from the colour scale, so a spot the chart (and the "dry for X" note underneath it) was calling dry could still look like it was showing a touch of rain.

**What's new for you**

- **The colour key is back**, right where the design had it.
- **Dry reads as dry now** — a plain neutral tone, not a faint blue. The scale only kicks in once there's real rain to show.

**Nothing about the verdict changed.**

---

## [2.37.1] - 2026-09-16 - Gemma Raus just got better: fewer circles, and the page holds still sideways 🩹

*Two real reports from v2.37.0, live within the hour.*

**What happened**

The skyline chart's new markers — flagging where the model expects more than radar sees, or where the two forecast models argue — were drawn one per matching 30-minute slot. Live data showed several slots in a row often trip the same flag together, so a genuinely uncertain stretch drew a whole row of little circles instead of one clear flag — busier and harder to read than the mockup it was built from. Separately, yesterday's browser-bar fix (v2.36.8/.9) traded away a bit of sideways containment it didn't mean to: the page could be nudged a little to the right, which it never used to do.

**What's new for you**

- **One marker per stretch, not one per slot.** When several slots in a row agree that something's off, that whole stretch now gets a single marker at its strongest point, instead of a chain of circles down the line.
- **The page holds still sideways again.** No more accidental nudge to the right.

**Nothing about the verdict changed.**

---

## [2.37.0] - 2026-09-16 - Gemma Raus just got better: today's chart is a skyline now, and one more scroll gap is closed 🌤️

*A design pass on today's rain chart, worked through against a few mocked-up options before picking one — plus a follow-up to yesterday's scroll fix.*

**What's new for you**

- **Today's rain chart is a filled shape now, not a row of bars.** The idea is the same — taller means heavier rain, dry is dry — but it reads as one continuous line instead of a strip of boxes, and colour now runs smoothly from blue (light rain) to red (a real storm) instead of a fixed five-colour key.
- **Dry no longer has a colour.** The old gold baseline tile — which got confusing where it overlapped the model's own guess for later hours — is gone. A dry stretch is just... nothing drawn, with a small line underneath naming how long it lasts.
- **Two things the chart couldn't say before, it says now.** When the weather model expects more rain at a spot than radar is currently measuring — still within the part we trust most — a small dashed marker breaks up through the shape to flag it, instead of that disagreement staying invisible. And when the two forecast models argue with each other further out, that gets its own marker too, distinct from the first.
- **One more scroll gap, closed.** Yesterday's fix (v2.36.8) covered the whole screen coming up short. This covers a narrower case: when an extra warning banner stacks on top of an already-busy screen, the very bottom of the page could still get clipped with no way to reach it. It's reachable now — a safety net, same as before, invisible on every ordinary day.

**Nothing about the verdict changed.** Same thresholds, same countdowns, same decision — this is what it looks like, not what it decides.

---

## [2.36.8] - 2026-09-16 - Gemma Raus just got better: nothing gets stuck behind your browser's own bar 🧾

*A real gap left over from removing the page scroll.*

**What happened**

On some mobile browsers (in a regular tab, not the installed app), the very bottom of the screen was hidden behind the browser's own toolbar — and because the app deliberately doesn't scroll, there was no way to reach it.

**What's new for you**

- **The app now measures the real visible space more reliably**, using the same signal the browser itself uses for things like the on-screen keyboard, instead of trusting a CSS setting alone.
- **As a safety net, the app can now be scrolled** if a browser's own chrome still doesn't leave the space we expect. On a device where everything already fit, this changes nothing — there's simply nothing to scroll.

**Nothing about the verdict changed.**

---

## [2.36.7] - 2026-09-16 - Gemma Raus just got better: the headline never wraps again 🧾

*A real bug from yesterday's font change, fixed properly.*

**What happened**

The new headline font (Archivo) is wider than the old one, and both the small "GEMMA RAUS" logo in the header and the big headline could wrap onto two lines once real content was on screen — something that must never happen, whatever the wording, whatever the language, whatever the screen size.

**What's new for you**

- **The headline and logo now shrink to fit instead of wrapping.** Both watch their own available space and scale down just enough to stay on one line — this works for any status text ("GEMMA RAUS", "BLEIB DRIN", a countdown with any number) at any phone width, not just the strings we tested against.

**Nothing about the verdict changed.** Purely visual sizing — what the headline says is untouched.

---

## [2.36.6] - 2026-09-16 - Gemma Raus just got better: three follow-up fixes from the same screenshots 🧾

*A closer look at yesterday's changes turned up a few rough edges.*

**What's new for you**

- **The chart caption no longer drifts.** The line separating "measured" from "estimated" on the chart could sit slightly off from the actual boundary even without scrolling. It now reads from the exact same numbers the chart itself draws with, so the two can't disagree.
- **Coming days is tidier.** The extra room this tab gained recently was showing up as a few odd, uneven gaps between days instead of just bigger rows. Rows are now sized generously and consistently, with any leftover space left as one clean space at the bottom instead of scattered through the list.
- **Your location's map popup is better centered.** It used to sit high in the map box, since the popup opens above the pin and the pin was placed dead center. The map now nudges down slightly so pin and popup read as one centered group.

**Looked into, not changed:** the phone status bar icons some of you are still seeing rendered awkwardly. Everything on our end is already configured correctly for both themes — this looks like a case where the phone froze that color at the moment the app was added to the home screen. If you're seeing this, try removing the Gemma Raus icon and adding it again; let us know if it's still off afterward.

**Nothing about the verdict changed.** All three are positioning and layout only.

---

## [2.36.5] - 2026-09-16 - Gemma Raus just got better: a new headline face 🧾

*A brand-level swap, chosen off a side-by-side comparison.*

**What's new for you**

- **The big headline font changed** — "GEMMA RAUS", status badges and panel titles now use Archivo (a wider, heavier cut) instead of Space Grotesk. Everything else — the mono body text you see everywhere else in the app — is unchanged.

**Nothing about the verdict changed.** Purely a typeface swap.

---

## [2.36.4] - 2026-09-16 - Gemma Raus just got better: the chart caption keeps up with the chart 🧾

*A follow-up screenshot review turned up two small things.*

**What's new for you**

- **The "RADAR · FORECAST" label above the chart now lines up with the actual chart.** It used to just sit there — radar on the left, forecast on the right, split evenly no matter what the bars underneath actually showed. Now it tracks exactly where the measured part ends and the estimated part begins, and slides along as you scroll the chart sideways.
- **Tightened two gaps around the main headline** that were larger than they needed to be — a little more of the screen is now given to content instead of empty space.

**Nothing about the verdict changed.** Both are purely positioning and spacing — what counts as rain, a break, or a warning is untouched.

---

## [2.36.3] - 2026-09-16 - Gemma Raus just got better: grey means "estimate", and Coming days finally fills the screen 🧾

*Two small honesty-and-space fixes on the chart and the outlook tab.*

**What's new for you**

- **The forecast side of the chart is grey now, not just faded blue.** Radar bars — what's actually falling right now — keep their full colour. Bars past that point, which come from the weather model instead of radar, are pulled toward grey: a clearer way of saying "this is a different kind of reading, not just a fainter one." A contested bar (where our two weather models disagree) still gets a dashed edge — now in its true colour, poking through the grey.
- **Coming days no longer sits in the top third of the screen.** The five-day outlook used to leave most of the phone screen empty below it. The rows now stretch to fill the space, with bigger icons, bars and text — easier to read at a glance, especially on mobile.

**Nothing about the verdict changed.** Both are purely how the chart and the outlook tab look — what counts as rain, a break, or a warning is untouched.

---

## [2.36.2] - 2026-09-16 - Gemma Raus just got better: a dashed edge now means one thing 🧾

*A small honesty fix on the radar chart.*

**What happened**

On the chart's forecast side, every bar used to get a dashed outline — a tight dash when our two weather models agreed, a looser one when they didn't. On screen those two dashes looked almost the same, so the outline stopped telling anyone anything.

**What's new for you**

- **A dashed bar now means one specific thing: the two models disagree there.** An ordinary forecast bar is just a little dimmer than a radar bar — quieter on the eye, and it still says "less certain than radar" without needing a border to say it twice.
- **One fewer legend chip.** The "forecast" label is gone from under the chart — the heading above it already says "FORECAST · MODEL", so the chip was repeating itself. The "models disagree" chip now shows an actual dashed swatch instead of just text.
- Guide updated to match what's actually on screen.

**Nothing about the verdict changed.** Purely how the forecast bars are drawn — what counts as rain, a break, or a warning is untouched.

---

## [2.36.1] - 2026-09-16 - Gemma Raus just got better: one screen, and a fixed outlook 🧾

*Two things found the same day the tabs shipped.*

**What happened**

The five-day outlook went blank with no explanation. Turned out Open-Meteo — the outside service that supplies it — had cut us off for the day: we were asking it for that forecast every five minutes, 288 times a day, for numbers that barely change hour to hour. Nothing else about the app was affected; the radar chart, the ground reading, the verdict — all fine.

**What's new for you**

- **The app no longer scrolls.** Everything now fits one screen, always. On a day with several weather banners stacked up, the map gets smaller to make room instead of the page growing a scrollbar — it'll still show enough to read, just less of it.
- **The five-day outlook won't go dark again.** It's now asked for about once an hour instead of every five minutes — comfortably inside what the weather service allows — and the last good answer is saved, so a restart on our end can't blank it either.

**Nothing about the verdict changed.** Both fixes are about how often we ask for data and how the screen lays itself out — not what the app tells you.

---

## [2.36.0] - 2026-09-16 - Gemma Raus just got better: today and the outlook, split apart 📑

*A design pass, worked out with users before it shipped.*

**What's new for you**

- **Today and the outlook now live behind two tabs.** The rain chart and the five-day forecast used to sit stacked on top of each other, so the picture for the next few hours and the picture for the weekend read as one long scroll. **Today** now holds the radar chart and the map; **Coming days** holds the outlook. Nothing about either one changed — they're just no longer competing for the same glance.
- **The rain chart lost its colour key.** It used to explain five shades — dry, light, moderate, heavy, storm — in small print underneath. The bar's own height already said how heavy the rain was, so the key was repeating the picture in words. It's down to two rain colours now, and the height still does the talking.
- **The five-day outlook finally says *when*.** Each day drew a shape for its 24 hours with nothing marking the hours themselves, so "rain in the colored part" didn't tell you if that meant morning or evening. A small 00–24 scale now sits above the five days, shared across all of them, so a wet stretch reads as a time of day, not just a smear of colour.
- **Today's sky facts sit in their own little capsule** — the cloud icon, condition, temperature and wind — instead of floating loose above the headline.

**Nothing about the verdict changed.** Every threshold, countdown, and decision this app makes is untouched — this release only changes what's drawn and how it's grouped on screen.

---

## [2.35.1] - 2026-09-15 - Gemma Raus just got better: readable in daylight 🔆

*A few spots that only looked right at night.*

**What happened**

A handful of coloured elements — the "buy me a coffee" button, the notification bell once you've turned it on, the "you're outside Salzburg" banner, and the low-contrast tail end of a couple of other messages — were quietly using the app's *dark-theme* colours even when your phone was in light mode. On the light cream background that gold and blue washed out to barely-there, the same problem the rest of the app already solved by darkening its colours for daylight. These five spots had slipped through that fix.

**What's new for you**

- The donate button, the notification bell, and a couple of banner messages now read clearly in light mode, matching the same darkened palette the rest of the app already uses.
- Nothing else changed — same verdicts, same countdowns, same everything. Just easier to read in the sun.

**Nothing about the verdict changed.** This is a display-only fix; every threshold, countdown, and decision is untouched.

---

## [2.35.0] - 2026-09-15 - Gemma Raus just got better: a calmer screen, and the colours explain themselves 🎚️

*Same information. Fewer things to read before you get your answer.*

**What's new for you**

- **One weather alert at a time.** On a stormy evening Gemma Raus could stack six full-width warnings above the headline — thunderstorm in the region, storm cells forming, high storm potential, strong wind, an official rain warning, rain spreading from the west. Every one of them true, and together a wall you had to scroll past to find out whether you could go outside. Now you see the most serious one, with a **"+5 more"** next to it. Tap it and they all open. Nothing is hidden and nothing is decided for you — the serious ones simply go first.
- **The colours under the chart are explained again — but only the ones you can see.** A dry afternoon shows a single gold swatch. A stormy one shows the full scale, from gold through to orange. Two lines of small print underneath are gone; the chart now names its two halves in one line above it instead — *RADAR · NEXT 2½ H  ———  FORECAST · MODEL* — and that line stays put when you swipe the chart sideways, which the old one did not.
- **A dry afternoon finally looks like an answer.** A flat gold line is honest and looks exactly like a chart that failed to load. There's now a small bracket under the dry stretch with its length on it — *DRY · 3 H* — so you can see at a glance how long you've got. It stops where our radar stops, because past that we're guessing, and it marks that with an arrow rather than pretending.
- **Temperature and sky moved up next to the verdict.** They had a strip of their own, directly above a line that often said something similar. Same numbers, one less band across your screen.
- **The chart is a little shorter**, and on a computer the app uses the **whole window** again instead of a narrow column pinned to one side.

**Nothing about the verdict changed.** Every threshold, every countdown, the decision tree and the notifications are untouched — this release only changes what is on screen and how much of it there is at once.

---

## [2.34.0] - 2026-09-15 - Gemma Raus just got better: the chart holds still, and never says "0 hours" 🧭

*Five things in one message, all of them fair.*

**What's new for you**

- **The rain chart no longer scrolls by itself.** It drifted forward so you'd notice there were twelve hours to see — but it moved the bars out from under you mid-glance, and that is annoying on an app whose whole job is a two-second look. Swipe it when you want more; otherwise it stays exactly where you left it.
- **"The first 0 h are radar" is gone.** When live radar isn't reaching us — it happens, usually a rate limit on a busy mobile network — the chart quietly falls back to the forecast model. It was still introducing itself as radar, with a span of zero hours. It now says plainly: *no live radar right now — everything here is a forecast.* And with no data at all it says nothing rather than describing a chart it hasn't drawn.
- **The status bar icons, properly this time.** Last release fixed the colour of the strip at the top of an installed app. The clock and wifi icons on it were still wrong in light mode — because your phone picks their contrast from the *scheme* the app declares, not its colour, and Gemma Raus was still declaring "dark" to anyone whose **phone** was in dark mode, however cream the app on screen was. It now declares what it is actually showing.
- **Desktop sits on the left.** The reading column from last release was floating in the middle of wide screens. It's now anchored to the left edge, where the header already was, and the spare scrollbar next to it is gone.
- **The imprint moved to the bottom.** It's a legal footer, so it now sits below the close button next to the version number, instead of standing between you and the way out of the guide.

**Nothing about the verdict changed.** Every threshold, countdown and decision is untouched — this release only affects what is drawn and how it is labelled.

---

## [2.33.0] - 2026-09-15 - Gemma Raus just got better: honest radar hours, readable status bar 📶

*Two reports: "how is it next 5½ h on radar — did it jump from 2½?" and "in the installed app the top bar is dark and I can't see my wifi and signal icons."*

**What happened**

**The radar hours.** Our radar source normally reaches about 3 hours ahead. Today it started sending **six** hours for a couple of spots in the city while still sending three for the rest — so the chart announced "radar, next 5½ h" at one address and "2½ h" a street away, and drew six hours of it as solid, measured-looking bars.

Radar that far out is an extrapolation, not an observation. Gemma Raus itself never looks past three hours when deciding what to tell you — so the chart was claiming a confidence the app doesn't act on. The radar part of the chart is now capped at three hours no matter how much the source sends. Nothing is hidden: the extra hours are still drawn, just in the forecast half where they belong.

**The status bar.** In the installed app the strip at the top of your phone — clock, wifi, battery — was painted near-black while the app itself is cream. Your phone picks the colour of those icons to contrast with what the app declares, so it was contrasting them against a colour that wasn't actually on screen, and they vanished.

The app had been declaring a dark colour since before it had a light theme at all, and nobody had noticed because it only shows once the app is installed. It now tells your phone the real colour, and updates it the moment you switch between light and dark.

---

## [2.32.0] - 2026-09-15 - Gemma Raus just got better: today is a proper tile, and the desktop finally breathes 🗓

*Two asks: "can we lose the boring rain ribbon and make today look like the day rows, only bigger" — and, from a 1900px screenshot, "it needs a margin to be readable."*

**What's new for you**

- **Today is now a tile, not a strip.** The same bars, the same colours — given real height, with its own **TODAY** heading, sitting directly above the coming days so the whole outlook reads as one block instead of two unrelated charts.
- **The colour key is gone from under the chart.** It took two lines to say something the guide can say better, and it was most of what made the block look busy. It lives in the guide now, under **?**.
- **It now says out loud which part is measured.** Under the tile: *the first 2½ hours are radar — what is actually falling. everything after that, and every one of the days below, is a forecast.* The coming-days heading says "forecast" too. That distinction was always drawn in the chart; now it is also written down.
- **Today appears once.** It used to be both the chart and the first row of the five-day list — the same day, described twice, by two different instruments at two different resolutions. The list now starts tomorrow.
- **On a desktop the app sits in a column.** Full-screen it ran edge to edge: a rain chart two thousand pixels wide, and temperatures sitting a foot away from the day they belonged to. Now it centres, with space either side. On a phone nothing changes at all.

**What did NOT change**

The forecast, the verdict, the countdowns, and the chart itself — the bars, the dashed forecast zone, the faint drizzle stubs and the boundary line are all drawn exactly as before, just taller.

---

## [2.31.0] - 2026-09-15 - Gemma Raus just got better: installed apps update themselves 🔄

*After yesterday's blank-screen bug: if a release ever goes wrong again, the fix has to reach the app on your home screen without you doing anything.*

**What's new for you**

- **The installed app now keeps itself current.** It checks for a new version when you open it, whenever you come back to it, and every quarter of an hour it stays open. If it finds one, it loads it. Until now it only checked when you switched back to the tab — so an app left sitting on a home screen could stay on old code for a long time, which is exactly the wrong thing to happen during a bad release.
- **It no longer depends on one mechanism.** There is now a second check that works even if the app's background updater has got stuck, something iOS in particular has a history of. If a reload doesn't fix the mismatch it stops trying rather than trapping you in a refresh loop.
- **An imprint.** Under Support, next to the contact address, as Austrian law asks for.
- The support line no longer carries a name — it just says what it is.

**Also checked over**

A full pass over which browser features the app relies on, against what older iPhones and Android phones actually have. Two things were tightened: notifications could fail awkwardly on a few locked-down Android browsers, and a dry window ending at midnight could have been written as "24:00" instead of "00:00" on some phones.

---

## [2.30.2] - 2026-09-15 - Gemma Raus just got better: the guide explains the new screen 📖

*Following the two new blocks: the guide still described the old layout, and the source line under the status was missing half of what it meant to say.*

**What's new for you**

- **The guide is up to date.** Open it with the **?** button and you'll find three new sections: what the line at the very top is, what "ground" and "radar" under the status actually mean, and how to read the five-day strip — including a little drawn example of a day, with its dry window marked.
- **The source line shows its numbers again.** It was meant to read "radar 2.6 mm" and was only saying "radar", because the name I gave that piece of text was already taken by the data-sources list further down. Both now say what they were written to say.

**Behind the scenes**

Nothing about the forecast or the verdict changed. The naming clash was the sort of thing that fails silently — no error, no warning, the wrong text just quietly wins — so there's now a check that refuses to let two pieces of text share a name, and another that makes sure German and English always carry exactly the same set.

---

## [2.30.1] - 2026-09-15 - Gemma Raus just got better: the blank screen is gone, and "best window" now means daylight ☀️

*Reported within minutes of the 2.30.0 deploy: "I can't see anything on the screen — the landing page is fine, the weather page is blank."*

**What happened**

A mistake of mine, and a bad one. The rain ribbon reads a piece of forecast data that doesn't exist yet during the split second before your first reading arrives. Every other line in that part of the app is written to expect that; the one line I added yesterday was not. So it failed on the very first draw — and when that happens the whole page goes blank rather than showing a broken ribbon. It hit everyone, on every device, and clearing your cache would not have helped.

It's fixed, and there is now a test that draws every one of the new blocks with nothing in them at all — the state the app is in for a moment every single time you open it.

**Also fixed: "best window" was offering you the middle of the night**

The five-day strip went live yesterday, and the first real forecast showed up two problems with it at once:

- A day that was dry from start to finish was described as **"00:00-00:00"** — a whole dry day printed as if it were no time at all.
- Worse, dry hours in the middle of the night counted towards the window. Night is dry far more often than daytime, so a day that rained 22 mm in the evening could be offered as an eleven-hour opportunity, and beat a genuinely clear day later in the week.

Windows are now measured **between sunrise and sunset**, so what you're offered is time you could actually use — and it adjusts itself through the year rather than assuming summer. When two days offer the same amount of daylight, the drier day wins; if they're equally dry, the sooner one does, because a tenth of a millimetre isn't worth waiting a day for.

---

## [2.30.0] — 2026-09-15 — Gemma Raus just got better: it finally tells you what the sky is doing 🌤️

*From a design pass on the main screen: "can we show something cleaner, more weather-based — the weather code, the coming days?"*

**What happened**

Gemma Raus has always known more than it let on. The temperature, the wind and what kind of sky is over you were already coming down with every refresh — but the only way any of it reached you was inside the little sentence under the headline. And that sentence is deliberately quiet whenever rain is anywhere in the picture, because "perfect day, get out there" underneath a rain countdown reads as broken.

Which meant that on exactly the days you open the app most, it showed you no temperature at all.

The other gap was simpler: the app answers "can I go outside" for the next three hours, brilliantly. Ask it about tomorrow, or the weekend, and it had nothing — so you went and checked something else, and then trusted that something else for the next three hours too.

**What's new for you**

- **A sky line, right under the header.** A drawn weather icon, what the sky is doing in a word, the temperature and the wind. Always in the same place, whatever the verdict says. The advice you already got ("grab a jacket", "hold onto your hat") hasn't gone anywhere — it just doesn't have to carry the facts any more.
- **Five days, at the bottom.** Each day gets its icon, its shape — a little bar for every two hours, coloured exactly like the rain ribbon above, so a wet afternoon looks wet in both places — its chance of rain, and its high and low.
- **"Best window".** The longest dry stretch in the coming days, with the day and the hours named. It's a *plan*, not a verdict: something to aim your Saturday at. If there isn't a proper dry stretch, it says so instead of inventing one.
- **A line that says where the verdict came from.** Under the headline: what the ground gauge reads, what the radar reads over your head, and when. When Gemma Raus says GO ANYWAY while your gauge says dry, you can now see exactly that, instead of wondering which of you is wrong.
- **The rain ribbon got its space back.** The colour key used to take two full lines listing six things. It's now one small scale, and the extra labels only appear when there's actually something on the chart they explain.

**What did NOT change**

The verdict. Not one threshold, not one rule, not one countdown. Everything above is the app showing you what it already knew — the decision about the next three hours is made exactly as it was yesterday, by the same radar and the same two rain gauges.

---

## [2.29.1] — 2026-09-15 — Gemma Raus just got better: the map stopped nagging you for an API key 🗺️

*Reported from a screenshot: "API KEY REQUIRED" stamped diagonally across the whole map, over and over.*

**What happened**

The free map tiles we've used since the start quietly changed their terms — they now ask for a sign-up key we never had. Instead of failing outright, the map kept loading tiles that just had that message printed on them, so nothing in our own monitoring noticed anything was wrong.

**What's new for you**

- **The base map is back to normal**, now served from a different free provider that doesn't require a key.
- Everything else on the map — the radar overlay, the town dots, the recenter button — was untouched and unaffected.

---

## [2.29.0] — 2026-08-21 — Gemma Raus just got better: it can tell a drizzle from a downpour ⛈️

*Reported mid-storm, and fairly: "suddenly it started raining and we lagged — it still says go anyways."*

**What happened**

A shower came over the city fast. The airport went from calm and dry to 29-knot gusts and rain in half an hour. Gemma Raus kept saying **PASST SCHON — just a light drizzle, go anyway**, while you were getting soaked.

Two of the three things the app uses to answer *"am I getting wet right now?"* are always a little late by nature. The rain gauges are tipping buckets — they have to physically fill before they report anything, and they were still reading 0.0 a full eight minutes after the rain started. The radar forecast is an extrapolation that is published about twenty minutes behind real time, so its "right now" slot still showed dry.

The third one — the live radar picture — *did* see it, immediately and clearly. But we were only checking **whether** there was rain on the radar, never **how hard**. Every echo, from the faintest mist to a thunderstorm core, was recorded as the same small number. And that number happened to sit exactly in the middle of the "light drizzle, go anyway" range.

So the one instrument that was not late was being quoted as saying "drizzle" no matter what it actually saw.

**What's new for you**

- **The radar picture now reports intensity, not just presence.** Heavy rain overhead reads as heavy rain.
- **A heavy downpour can no longer be filed as "light drizzle".** When the radar shows genuinely heavy rain sitting on you and the gauges have not caught up yet, the app now says so — and the verdict can reach **BLEIB DRIN** instead of waving you out the door.
- **On the storm that prompted this, it would have caught the rain about ten minutes earlier** — before the gauge felt a drop.
- **Light rain is completely unaffected.** We replayed the whole afternoon frame by frame: every earlier, genuinely-light passage still reads exactly as it did before. Only the downpour changed.

*Two independent checks have to agree before this fires — the rain must be heavy **and** cover a wide area — so a lone speck of radar clutter still cannot keep you indoors. A clear sky remains an absolute veto, exactly as before.*

---

## [2.28.0] — 2026-08-20 — Gemma Raus just got better: "15 km away" now means 15 km away 📏

*Reported on a sunny morning: "it's already raining to the northwest (~15 km)" while Salzburg was clear. The rain was real — a band closing from Waging am See at about 27 km/h. The distance was not.*

**What happened**

Gemma Raus watches a ring of points around you for rain that has not arrived yet. That ring was supposed to sit 15 km out. It was actually sitting at 10.7 km — the maths behind it used the size of a radar pixel at the equator, and pixels get smaller the further north you go. At Salzburg's latitude they are about a third smaller than assumed.

**What's new for you**

- **The ring now really is 15 km.** You get a little more warning of rain that is on its way but not yet overhead, and the distance in the message is honest.
- **One of the phrasings was overclaiming.** It sometimes said "nothing heading your way yet" — but that alert fires when rain is nearby *without a known arrival time*, which is not the same as it standing still. On the morning this came up it was heading straight for the city. It now says "no arrival time yet".
- **The crossed-out activity icons are visible again.** They were being faded so far that only the red rings showed. The icon underneath now reads clearly.

*More warning, sooner — which also means the motorbike icon crosses out a little earlier than before.*

## [2.27.0] — 2026-08-19 — Gemma Raus just got better: the icons tell you what is off 🚫

*A perfect day now shows nothing at all. That is the whole idea.*

**What happened**

The little row of emoji under the headline used to advertise what you could do - a walker, a runner and a swimmer on a nice day. Pleasant, but it told you what you could already see for yourself, and on the days that actually needed care it said nothing useful.

**What is new for you**

- **The row now shows what the weather has taken away**, each icon struck through with a red ring. Thunderstorm: swimming, running and cycling are out. Snow: the bike is out. Rain, or rain within the next half hour: the motorbike is out.
- **An empty row is the good news.** On a clear day nothing appears there at all - nothing has been taken from you.
- **The picnic basket is the quiet clever one.** It stays crossed after the rain stops, because the grass is still wet. It is the only icon you will see on an otherwise perfect-looking afternoon that has just had a shower.
- **Nothing shown at night**, and during bleib drin only genuine hazards - you already know you are staying in, so a wall of crosses would just be noise.
- **Screen readers now say "no swimming"** instead of reading out a bare emoji, in your own language. The old labels were English-only regardless of the setting.

*The jacket and scarf advice has not gone anywhere - it lives in the line of text underneath, where it always was.*

## [2.26.0] — 2026-08-18 — Gemma Raus just got better: it can tell you when it lets up 🌦

*"It's kind of a gap now - and it makes me sad that we can't see that coming and tell people."*

**What happened**

Gemma Raus knew the word for *dry* and the word for *raining*, and nothing in between. A "break" meant the rain stopping completely. So on an afternoon that went from a downpour to two and a half hours of light drizzle - the sort you walk through without thinking - it counted zero breaks and told you there was no break in sight.

The forecast was right there on the ribbon the whole time. The app simply had no way to say *"much lighter soon"*.

**What's new for you**

- **"Down to a drizzle in about 20 minutes."** When the radar shows the rain dropping to something you could walk in - and staying there for at least three quarters of an hour - Gemma Raus now tells you when, instead of a flat "no break in sight".
- **Thunderstorms stop hiding the timing.** During a storm you used to get "thunder and lightning, stay put" and nothing else. The storm still comes first, because that is a safety thing and not a question of how hard it is raining - but you now also get when the rain is due to ease.
- **It is still bleib drin.** This tells you when to look again. It never tells you to head out into a storm.

*Checked live during the thunderstorm it came from: every neighbourhood in the city went from "rain right through the next 45 minutes" to a real number.*

## [2.25.1] — 2026-08-18 — The map can recover on its own now 🗺

*Reported from an iPhone running Gemma Raus as an installed app: sometimes the map just doesn't load at all, and stays that way.*

**What happened**

Leaflet, the map library, never retries a tile that failed to load. One failed request and that square stays empty until something makes it ask again — and nothing in the app ever did.

That matters most in exactly the situation reported. iOS suspends installed web apps aggressively, and when one wakes up its image requests can fail in the first moment before the network is properly back. Every other part of Gemma Raus recovers by itself on the five-minute refresh. The map had no such path, so a single unlucky wake-up left it blank until the app was force-quit.

**What's new for you**

- **The map redraws itself when you come back to the app.** Switching away and returning, or unlocking your phone, now prompts it to re-request anything that didn't arrive.
- **A failed tile gets a second chance.** One retry a couple of seconds later, batched so a whole screen of failures costs one attempt, not dozens.
- **One less way for the map to fail outright.** A browser feature the map setup depended on is now optional instead of required — if it's missing, the map still builds.

*Nothing about the forecast changed.*

## [2.25.0] — 2026-08-18 — Gemma Raus just got better: "the rain is ending" now has to mean it 🌤

*"Bleib drin — rain going away in about 2½ hours." It wasn't going away. It was dipping for an hour and then coming straight back.*

**What happened**

When Gemma Raus can't see a break on radar, it takes a second opinion from the weather model — so that "no break in sight" doesn't get said when the rain genuinely is about to stop. Good idea. But it only ever looked three hours ahead, and it took the last quiet patch inside that window as *the end of the rain*, without ever checking what came next.

So a stretch of quiet starting near the edge of that window got announced as the rain leaving, while the model itself had it raining again shortly afterwards — just past where the app was looking. And "quiet" was set low enough that the model's own rounding noise counted.

**What's new for you**

- **A break has to last before we'll call it the end.** At least an hour and a half of genuinely nothing, checked across the full forecast rather than stopping at an arbitrary edge. A one-hour lull between two bands of rain is a pause, not an ending, and it no longer gets to pretend otherwise.
- **If we can't see far enough to be sure, we don't promise.** Better a plain "no break in sight" than a comforting sentence that turns out to be wrong.
- **The verdict itself never changed.** It's bleib drin either way — this only removes an over-optimistic line underneath it.

*Checked against the live afternoon it came from: nearly 18 mm of rain over three hours and not one dry minute on radar. No easing claim anywhere in the city now.*

## [2.24.2] — 2026-08-18 — Ribbon guide: sized properly on desktop 🖥

- The little ribbon diagram in the help panel stretched to the full width of the panel on a big screen, blowing its tiny time and zone captions up larger than the headings around them. It's now capped at its natural size — full width on a phone, a diagram on a laptop.

## [2.24.1] — 2026-08-18 — Gemma Raus just got better: the ribbon explains itself 📖

*The rain ribbon carries a lot of information, and none of it was written down anywhere. Now the help panel shows you how to read it.*

- **A small worked example of the chart**, right in the guide, with the four things worth knowing: taller means heavier, a low flat stretch is your dry window, solid bars are radar and dashed ones are the model, and the line on the left is now.
- **Drawn, not photographed.** It's built from the same colours the real ribbon uses, so it looks right in both light and dark mode and can't quietly go out of date the way a screenshot would.

*German and English both. Nothing about the forecast itself changed.*

## [2.24.0] — 2026-08-18 — Gemma Raus just got better: a dry minute is not a dry afternoon 🚪

*It was dry outside and Gemma Raus said gemma raus. It was also going to rain, without a proper break, for the next three hours. Both of those were true, and only one of them was useful.*

**What happened**

Until now the app asked two questions about the rain ahead: how hard does it get, and how much lands on me while I'm out. Reasonable questions. But on an afternoon of light, steady, never-quite-stopping rain, both answered "not much" — no single burst heavy enough to count, not enough millimetres in the next three quarters of an hour — and the headline sent you out into it.

Nobody was asking the obvious third question: **is there actually any point starting something?**

**What's new for you**

- **If there's no proper break coming, you get bleib drin.** Gemma Raus now looks across the whole three-hour horizon for a dry stretch of at least 45 minutes. If there isn't one anywhere, it says so, even when this exact minute happens to be dry.
- **It tells you what you've actually got.** Not a bare "stay in", but *"only ~20 min dry — then rain with no usable break"*. A stay-inside verdict under a clear sky needs to explain itself.
- **A genuinely good window is still a good window.** Dry now, rain in forty minutes, clearing after? That's still gemma raus. The rule only fires when nothing usable opens up afterwards — otherwise it would be crying wolf on half the afternoons in Salzburg, which is its own way of being useless.
- **Forty-five minutes now means one thing everywhere.** It's what makes a window worth going out for, what earns a stay-inside verdict its release, and now what counts as a break. One number, one meaning.

*If the forecast goes missing, the rule stands down rather than keeping you in on no evidence.*

## [2.23.0] — 2026-08-18 — Gemma Raus just got better: the rain ribbon has a shape again 📊

*The bar chart had turned into a picket fence. Every bar roughly the same height, forty-nine of them, and the one thing you actually look for — the gap — drawn as a bump rather than a dip.*

**What happened**

The bars were scaled from nothing up to 5 mm in a straight line. But a quarter-hour of Salzburg rain is almost always somewhere between 0.1 and 1 mm, so all of it got squashed into the bottom sixth of the chart while the top three quarters sat empty, reserved for downpours that hardly ever come. A drizzle and five times as much rain looked five pixels apart.

And the faintest trace of echo — the barely-there stuff below the reporting line — was drawn at a fixed height that happened to be *taller* than genuine light rain. So during this morning's rain, the 45-minute lull in the middle of it, the bit you'd have gone out in, was the tallest thing on that stretch of the ribbon. Exactly backwards.

**What's new for you**

- **Bars are scaled by how heavy the rain actually is.** Light, moderate, heavy and storm each get a proper quarter of the chart's height, matching the colours they already had. Now a heavier hour genuinely looks heavier, and a gap looks like a gap.
- **Wisps of drizzle draw as a low hairline**, always shorter than real rain. Still there, still visible — no longer shouting over the thing next to it.
- **One bar per half hour instead of every quarter hour.** Gemma Raus never promises a break shorter than 30 minutes anyway, so the finer bars were showing detail the answer can't use. The ribbon is now half as long and far easier to take in at a glance.
- **The clock labels moved below the bars.** They used to be printed *behind* them, so a tall bar hid its own time. They also can't run off the end or collide with each other now.
- **The "now" line sits where now actually is** within the first bar, and the zone captions can't spill past the boundary they describe.

*No change to any verdict, countdown or threshold — this is purely what the chart looks like.*

## [2.22.0] — 2026-08-18 — Gemma Raus just got better: it stops changing its mind 🤞

*"Bleib drin, no break for three hours" → "passt schon, go anyway" → "bleib drin" again, all within a few minutes. Nothing outside had changed. That's not a forecast, that's a coin toss, and it's the fastest way to lose your trust.*

**What happened**

Every time the app refreshed, it worked the whole verdict out again from scratch, with no memory of what it had just told you. So when a number sat right on the line between two answers — and during steady rain, plenty of them do — a routine radar update could tip it across, and the headline would swing. Then swing back.

**What's new for you**

- **Bleib drin now has to be talked out of it.** Before the app tells you to head out, it wants a genuinely usable break: three quarters of an hour where the radar stays properly quiet — not just a lull between showers — plus the rain gauge agreeing it has actually stopped. And it wants to see that twice in a row, not once.
- **Bad news still arrives instantly.** This patience runs one way only. Rain starting, a downpour on the way, a storm warning — all of that reaches you the moment we see it, exactly as before. We'll happily keep you in a few minutes longer than strictly necessary. We won't send you out a few minutes early.
- **You get told what's happening in between.** Instead of jumping straight from *bleib drin* to *gemma raus*, you'll now see the middle: *"easing off — but no reliable gap yet"*, then *"looks like it's clearing — just confirming it holds"*. The app knows the rain is winding down before it's willing to promise you a window, and now it says so instead of sitting there looking stubborn.
- **It can't get stuck being cautious.** If the radar drops out, or leaves a faint smear that never quite clears, a calm reading on its own releases the verdict anyway. Waiting is allowed to delay good news. It is never allowed to cancel it.

*Your location never leaves your phone — this remembers a single timestamp, on your device, and forgets it if you move more than a kilometre or close the app for a while.*

## [2.21.0] — 2026-08-18 — Gemma Raus just got better: the rain gauge finally speaks the same language 🌧

*Proper, steady rain was being described to you as "just a light drizzle, go anyway". Not a close call, not a judgement you might disagree with — a unit mix-up hiding in plain sight since the beginning.*

**What happened**

Gemma Raus reads two very different instruments. The radar tells it how much rain falls in a **fifteen-minute** block. The rain gauges out at Freisaal and the airport report how much fell in the last **ten minutes**. Every threshold in the app — where drizzle ends, where "heavy" begins — was drawn for the radar's fifteen-minute blocks, and the gauge readings were being measured against them straight, without ever being converted.

So the gauges were quietly under-reported by half again. A gauge reading that actually meant *moderate rain, you will get wet* landed exactly in the middle of the band the app calls "light drizzle, go anyway".

This morning it showed. It rained across the whole city for over two hours — the airport's own weather station logged it as moderate at times — and five of the eleven neighbourhoods Gemma Raus tracks were telling you to head out.

**What's new for you**

- **A gauge reading now means what it says.** Ten-minute totals are converted onto the same scale as everything else before any verdict is made. This morning's rain reads as rain now, all across town.
- **Nothing got twitchier.** The correction only ever moves a reading *up*, and only once the gauge is properly reporting. A genuine light drizzle is still a light drizzle, and still gets a *passt schon*.
- **The faintest readings are untouched on purpose.** Right at the bottom of the scale, nudging a number upward would have switched off the drizzle-catching that finds rain the gauges are too coarse to feel. Rather not trade one blind spot for another.

*Nothing else moved: same thresholds, same states, same countdowns. One instrument was speaking in a different unit, and now it isn't.*

## [2.20.1] — 2026-08-17 — Gemma Raus spricht jetzt ordentlich Deutsch ✍️

*Die deutschen Texte waren stellenweise schlampig — kleingeschriebene Substantive, fehlende Kommas, und mit „labiler Luft" ein Fachbegriff, den außerhalb der Meteorologie kaum jemand verwendet.*

- **Groß- und Kleinschreibung durchgehend korrigiert.** Ein Teil der Texte war komplett kleingeschrieben, ein neuerer Teil korrekt — im Deutschen ist Kleinschreibung von Substantiven aber kein Stil, sondern schlicht falsch. Jetzt einheitlich richtig.
- **„labile Luft" ist raus.** Meteorologisch korrekt, im Alltag aber Fachjargon. Steht jetzt „wechselhaft" — und das Wetter „schlägt um" statt zu „kippen".
- **Kommasetzung korrigiert**, vor allem bei Nebensätzen („zeigt dir genau, wann du rausgehen kannst", „verfolgt, wie genau die Vorhersage wirklich ist").
- **Einheitliche Abkürzungen** („Min.", „Std.") und deutsche Anführungszeichen („…") statt gerader Zollzeichen.
- Kleinigkeiten: „Flughafen Salzburg" statt „Salzburg Flughafen", „Open-Meteo-Modell" mit Bindestrichen, fehlendes °C bei der Gewitter-Meldung, und „PRÜFEN" (klang wie eine Aufforderung an dich) heißt jetzt „PRÜFE …".

*English texts are unchanged. Also removed two dead translation entries that were silently overwritten by later duplicates and never rendered.*

## [2.20.0] — 2026-08-17 — Gemma Raus just got better: steady rain counts too 🌦

*Same morning, same spot: the gauge was measuring rain on you and Gemma Raus said "no rain right now". That one was simply wrong, and it's fixed.*

**What happened**

Two things, both showing up in the same five minutes in Nonntal.

The first: there's a narrow band of very light rain — around a tenth of a millimetre — where the app counted it as "not dry" for its own maths but still described it to you as *no rain right now*. Going out in it is genuinely fine, so the verdict was fair. Telling you it wasn't raining, while the gauge measured rain, was not.

The second is bigger. Gemma Raus only ever asked one question about rain ahead: *how hard is the heaviest moment?* It never asked *how much is going to land on me while I'm out?* So a sharp burst held you back, but an hour of steady light rain sailed straight through — even though you end up just as wet. That morning the radar showed 1.6 mm falling steadily across the next 45 minutes, not one moment of it heavy enough to count, and the app said go.

**What's new for you**

- **Very light drizzle is now described as drizzle**, not as "no rain". The verdict is unchanged — it's still a green light, because it genuinely is fine — but the words match what's landing on you.
- **Steady rain now counts.** If it's already raining on you and a real amount is going to keep falling through the next 45 minutes, that's BLEIB DRIN, even when no single moment is dramatic. Getting wet slowly is still getting wet.
- **A dry stretch ahead of you is still yours.** This only applies when it's already raining. If you're dry now and rain arrives in forty minutes, you have forty minutes, and Gemma Raus still says so.

## [2.19.0] — 2026-08-17 — Gemma Raus just got better: "go out" now means you have time to 🚪

*You stood in Nonntal in a light drizzle and Gemma Raus said GEMMA RAUS — while quietly noting, underneath, that heavy rain was 24 minutes away. Technically it was dry. It still wasn't a moment to head out.*

**What happened**

Gemma Raus was answering the wrong question. It was checking "is it dry right now?" — and it was, barely — when the question you're actually asking is "can I go out?" Those come apart badly when rain is close. It knew about the downpour; the radar had it clearly, and it wrote it in the small print. But the big word on the screen still said go.

Awkwardly, the app was already disagreeing with itself. The motorbike line, which asks for half an hour of dry weather before it says a ride is fine, was saying **no** at that exact moment. The right instinct was already in there, applied to bikes and not to the headline.

**What's new for you**

- **A "go out" verdict now means the window is actually usable.** If heavy rain is landing within 45 minutes, the headline says BLEIB DRIN and tells you how long you've got — instead of inviting you out and whispering a warning underneath.
- **This only triggers for real downpours, not for any rain at all.** Rain forty minutes away is true on half the afternoons here, and a warning that fires constantly is one you stop reading. It takes properly heavy rain to hold you back.
- **A genuinely long dry stretch is still a green light.** If the rain is more than 45 minutes out, or it's just light rain coming, nothing changes — you'll get GEMMA RAUS exactly as before. The dry window is still the whole point.
- **The map agrees with the headline.** The rule lives in the shared decision logic, so tapping a neighbourhood tells you the same thing as the banner.

## [2.18.1] — 2026-08-07 — Gemma Raus just got better: one thunderstorm, one message ⛈️

*Since yesterday you'd have seen the same thunderstorm announced twice — once by us, once by an official warning you had to close by hand.*

- Gemma Raus already tells you "thunderstorm in the region — conditions can change fast", from its own reading of the sky, and that note stays put on its own. The official GeoSphere thunderstorm warning was saying the same thing again right underneath, with a ✕ to dismiss. That second banner is gone.
- All other official warnings — heat, heavy rain, snow, black ice, wind, cold — are unchanged and still appear as before.
- One thing deliberately kept: if GeoSphere ever issues a **red** thunderstorm warning, the headline still switches to BLEIB DRIN, and the notification still goes out. Only the duplicate banner was removed, not the warning itself.

## [2.18.0] — 2026-08-06 — Gemma Raus just got better: the ribbon tells you how sure it is 📊

*You said the data around the 3-hour mark never looked consistent, and that the forecast should feel more confident. You were reading it correctly — the ribbon was showing you certainty it didn't have.*

**What happened**

The rain ribbon has two halves. The near part is radar: what's actually in the sky right now, tracked as it moves. The far part is a forecast from weather models. The join between them is where everything went wrong.

The label said "RADAR · NEXT 3 H". It was never three hours — radar reaches about two and a half, and that shrinks minute by minute until fresh radar arrives. So the join genuinely wandered, and you were watching it wander against a label insisting it shouldn't.

Behind the far half sit two forecast models, and we were drawing whichever of the two predicted more rain. When they agree, that's fine. When they don't, you got a single confident-looking bar covering up a real argument. During last night's storm they disagreed sharply: one had the storm ending around nine, the other was still replaying it two hours later, having never noticed it start on time. You saw the louder one, with no hint the other existed. And past six hours out there was no confidence information at all — those bars were drawn exactly as boldly as the rest, backed by nothing.

**What's new for you**

- **The radar label now tells the truth.** It says how far radar actually reaches — "NEXT 2½ H" when that's what you've got. The join stops looking like it's drifting, because it was the label drifting, not the data.
- **You can see when the models disagree.** Where both forecasts tell the same story, the bars stay solid. Where they argue, the bars go faint and finely dotted, with a "models disagree" note in the legend. The bar still shows the wetter of the two — we'd rather warn you early — but you can now tell the difference between "both models are sure" and "one of them is guessing."
- **Confidence now covers the whole chart.** We fetch twice as far ahead, so the far hours are shaded by how confident the model actually is. Fainter means less sure. And where we genuinely have no information, it no longer pretends to be a low reading.
- **A forecast that disagrees with radar is no longer hidden.** There was a threshold where the tiniest radar reading would silently erase a heavy forecast for the same moment. If the models expect much more rain than radar currently sees, you'll see that.

None of this changes the go/no-go verdict — the headline decides exactly as it did yesterday. This is the ribbon being honest about which parts of itself you should trust.

## [2.17.0] — 2026-08-06 — Gemma Raus just got better: a storm is never "passt schon" ⛈️

*You were out in Nonntal in hail and heavy rain, and Gemma Raus told you it was a light drizzle. That should never have happened, and we're sorry. It only admitted the storm once the rain gauge across town had physically filled up — long after you were already soaked.*

**What happened**

Gemma Raus has two safety rules that both exist for good reasons. One stops a distant rain gauge from being out-shouted by a weather model that's running an hour behind. The other stops the radar from painting rain that's really just moisture high in the air, never reaching the ground. Both work by quietly turning a big number into a small one.

Yesterday evening they both fired at once, on the same storm. The forecast model had only put the 7 o'clock hour at 43% likely to rain — it simply hadn't caught up with what was already happening over your head. So both rules decided the readings couldn't be trusted, and both trimmed them down to the same small value: a light drizzle. Every instrument we had was shouting — the radar, the thunderstorm reading, the second forecast model expecting up to 14 mm — and we talked all of them down to "passt schon."

**What's new for you**

- **A downpour that's actually falling now is never called a drizzle again.** The safety rule that quiets an out-of-date model still applies — but only when the radar agrees nothing is falling. When radar can see rain over your spot right now, the model's own heavy reading is taken at face value, however far behind the model has fallen.
- **Moderate rain stops being rounded down to drizzle.** The threshold at which we stop second-guessing the radar has come down. Genuinely light readings are still treated with care; real rain now comes through as real rain.
- **Official thunderstorm warnings reach you again.** When GeoSphere Austria's meteorologists issue a thunderstorm warning, you'll see it. We used to hide those, on the assumption that our own storm detector already had it covered — but ours is tuned for the extreme end, and yesterday's storm sat well below that line, so nothing reached you at all. A warning issued by a person now always outranks the silence of our own heuristic.

Everything here moves in one direction: toward telling you it's wet. You'll forgive us for warning you a bit early. You shouldn't have to forgive us for being late.

## [2.16.0] — 2026-08-04 — Gemma Raus just got better: when we're sure, we say so

- If our own data is screaming "storm" from two independent angles at once — extreme instability AND radar-confirmed initiation — the headline now says BLEIB DRIN instead of staying quietly calm underneath the warnings. Before, that combination only showed up in banners while the main headline could still read "passt schon." One dry gauge reading is no longer enough to override thunder outside when the rest of our own data already agrees.

## [2.15.0] — 2026-08-03 — Gemma Raus just got better: the storm banner stopped flickering

- Fixed the ⚡ severe storm potential banner sometimes appearing, sometimes not, across refreshes with nothing actually changing outside — it was reading instability from whichever single grid point happened to be nearest to your GPS fix, and that pick could shift between reloads. Now it reads the highest instability across the whole city grid instead, so it no longer depends on exactly which point you land on.
- Same fix carries over to the "unsettled air" wording, which was reading from the same value.

## [2.14.0] — 2026-08-01 — Gemma Raus just got better: warnings that know when to shout

**What's new for you**
- If GeoSphere Austria issues a RED warning — the serious kind — Gemma Raus now
  says so front and center: the headline itself switches to "BLEIB DRIN" until
  it's over, instead of quietly showing a calm "dry" reading underneath.
- Multiple warnings at once no longer pile up into a wall of banners — you'll
  see the top 2 most serious ones, not four stacked on top of each other.
- Thunderstorm warnings were showing twice (once from GeoSphere, once from our
  own storm radar) — dropped the duplicate, kept the one with more detail.

## [2.13.0] — 2026-07-30 — Gemma Raus just got better: official warnings

**What's new for you**
- When GeoSphere Austria issues an official warning for Salzburg — heat, storm,
  snow, black ice, thunderstorm, rain or cold — you'll now see it as a banner
  right in the app, in plain language with the level (yellow/orange/red).
- Close it once and it stays closed — but if the situation changes (a new
  warning, a different level, or the next day of a multi-day event like a
  heatwave), it shows up again so you're never left in the dark.
- If you've got notifications turned on, you'll also get a single push the
  moment a new warning becomes active — no repeats until it actually changes.

---

## [2.12.0] — 2026-07-28 — Gemma Raus just got better: refresh, properly

**What's new for you**
- The refresh button used to only update your own status — the little dots
  for the towns around you kept whatever they last read until their own timer
  caught up. One tap now refreshes everything at once.
- New: pull down from the top of the screen (right from above the rain
  ribbon) and let go to refresh, the same gesture you're used to everywhere
  else. The button is still there too — this is just another way in.

## [2.11.1] — 2026-07-28 — Gemma Raus just got better: one glance, all the icons

**What's new for you**
- All the context emoji — walk/run/swim, jacket, sunscreen, wind, and now the
  bike — sit together in one row instead of some being buried inside the
  sentence and the bike floating separately underneath. One glance tells you
  everything the moment invites.
- Still fully context-based: the row only ever shows what actually applies
  right now, and changes automatically as the weather does. A hazard note
  (thunder, snow, storm) never gets a "go do this" icon — those stay
  warnings, not invitations.

## [2.11.0] — 2026-07-28 — Gemma Raus just got better: a glance for bikers 🏍️

**What's new for you**
- A 🏍️ now shows up under the verdict whenever it's dry enough right now for a
  roughly 30-minute ride — a quick glance before you head out, separate from
  the wider "go enjoy your afternoon" weather note.
- Deliberately stricter than that note: even on a day where rain is expected
  within the next hour or two (so the "perfect day" note stays quiet), the
  bike still shows up as long as the *next 30 minutes specifically* are clear.
  Riders don't need the whole afternoon — just enough time to get there.
- Conservative on purpose: if any radar signal can't rule out rain in the next
  30 minutes (a nearby echo without a clear direction, or drizzle already
  showing on radar), the bike stays hidden rather than risk sending you out
  right before it starts.

## [2.10.1] — 2026-07-28 — Gemma Raus just got better: quieter outages, faster fixes

**Under the hood**
- Found and fixed a blind spot from today's earlier deploy: when the container
  restarts right as Open-Meteo is having a bad moment, the backend used to fail
  silently — no log line at all — and show a blank temperature/wind/12h-forecast
  until Open-Meteo recovered on its own. It never touched the GO/WAIT/STUCK
  verdict (that runs off the radar, not Open-Meteo), but the extended forecast
  and comfort notes went dark with zero trace of why.
- Failures now log the actual status code and response, so the next one is
  diagnosable in seconds instead of minutes of guessing.
- The last good snapshot is now saved to the database and restored on startup,
  so a restart that lands mid-outage no longer wipes the fallback — it keeps
  serving the last real reading instead of going blank.

## [2.10.0] — 2026-07-28 — Gemma Raus just got better: a little emoji for the mood 🏃

**What's new for you**
- The weather note under the verdict now leads with a small emoji cluster that
  matches what the moment actually invites — not decoration, a quick read:
  - 🚶🏃🏊 on a genuinely perfect day (clear, calm, comfortable) — go do any of it.
  - 🏊🧺 when it's hot enough that running isn't a good idea — swim or picnic instead.
  - 🏊🍦 on scorching days — same idea, turned up.
  - 🧥 / 🧣 on cold / freezing days — grab a layer.
  - 💨 on windy days — hold onto your hat.
- Hazard notes (snow, thunder, storm, fog) are untouched — those already carry
  urgency in the wording and didn't need decoration.

**Nothing else changed.** No rain logic, no thresholds, no verdicts touched —
this only dresses up the existing comfort notes that already showed under clear
conditions.

---

## [2.9.0] — 2026-07-18 — Gemma Raus just got better: at home on your iPhone 📱
*A round of iOS love — everything reported from an iPhone in one release, plus a proper front door.*

**What happened**
- On iOS the moving 12-hour ribbon sat frozen. Found it: iPhones round scroll
  positions to whole pixels, and our gentle drift moves less than a pixel per
  frame — so every tiny step got rounded straight back to zero. Desktop browsers
  keep fractions, which is why only iPhones froze. The ribbon now keeps its own
  precise position and only *tells* the screen where to be — it drifts on every
  device now. (If it still holds still for you: iPhone's "Reduce Motion" setting
  intentionally turns the auto-drift off — that part is by design, your finger
  still scrolls it.)
- On busy-weather days the warning banners (UV + wind + thunder + the big verdict)
  stacked taller than the screen — and the page had nowhere to scroll, so it just
  felt stuck and the map got squeezed away.

**What's new for you**
- **The page always scrolls now.** Banners can pile as high as the weather wants —
  you scroll through them, and the map always keeps a usable size at the bottom.
- **Tap GEMMA RAUS to go home.** The logo in the top-left now takes you back to
  the start page. Your saved spot isn't lost — one tap on GET MY LOCATION brings
  you right back.
- **The ribbon glides on iPhones** — and it no longer leaps to the far end when
  you return to a backgrounded tab.
- **Bottom sheets fit the *visible* screen.** The guide and privacy sheets used to
  tuck their last lines behind Safari's toolbar; they now size themselves to what
  you can actually see, and scrolling inside them no longer drags the page behind.
- **Older iPhones (iOS 15 and earlier) load again.** They're missing a browser
  timer feature every data call relied on — we now bring our own.
- The start screen scrolls on small phones instead of clipping the location-help
  text, and the iOS rubber-band no longer yanks the whole app around.

Nothing about the rain logic changed — same verdicts, same countdowns, same radar.

---

## [2.8.0] — 2026-07-17 — Gemma Raus just got better: no phantom drizzle on a cloudless day ☀️
*You looked at a perfect blue sky, the app said "drizzle possible" for three hours straight, and you asked us to cross-check. You were right.*

**What happened**
- On a cloudless 30° afternoon the radar timeline painted an identical whisper of
  drizzle across **all eleven city points** — same minute, same tiny value. Real
  drizzle never does that. We checked the live radar picture: **not a single echo
  within ~275 km**, and the airport reported zero clouds. That whisper was the
  nowcast model's own background noise, not weather.

**What's new for you**
- **Two witnesses now get a veto on "drizzle possible".** When the sky over you is
  clear AND the live radar picture is completely quiet — nothing at your pixel,
  nothing approaching, nothing in the ~15 km ring — the drizzle-possible wording
  stands down and the ribbon's trace stubs fade to a faint watermark. Blue sky
  overhead now means the app agrees with your eyes.
- **Your exact worry is the built-in safety case:** rain that's genuinely coming
  shows up on the live radar long before any cloud reaches your sky — so the veto
  releases itself the moment anything real appears, from either witness. Pop-up
  summer cells build visible towers first, which also releases it. And if the live
  radar feed is unavailable, we can't corroborate — so we never suppress.
- Nothing else changes: real rain bars, downpour warnings, approach directions and
  every countdown are untouched. This only silences the faintest tier when both
  independent instruments say it isn't there. Bonus: on a genuinely perfect day the
  friendly "go out" notes come back instead of being blocked by phantom drizzle.

**Why this direction**
- Our standing rule is "better a lead than a lag" — but this wasn't a lead, it was
  three hours of crying wolf against both instruments and your own eyes. Trust is
  the product too.

---

## [2.7.0] — 2026-07-17 — Gemma Raus just got better: two forecasts, one honest answer 🌧🌧
*You asked whether radar can see past 3 hours. It can't — nobody's can — but this is the next best thing.*

**What's new for you**
- **The forecast zone now runs on TWO models, not one.** Alongside the global
  Open-Meteo blend, we now pull GeoSphere's own AROME model — the 2.5 km Alpine
  model that **assimilates the Austrian radar network**, re-run every 3 hours.
  The rule is simple and safe: **whichever model shows rain is displayed, and the
  stronger value wins**, slot by slot. Two forecasts have to BOTH miss for the
  ribbon's forecast zone to stay wrongly blank.
- This feeds everything, not just the picture: the "radar clear so far — model
  expects rain in ~X h" second opinion, the ghost bars inside the radar zone, and
  the STUCK-side "model expects easing" line all read the combined lane, so the
  wording always matches what the ribbon paints.

**Why this direction**
- Our standing rule: you'll forgive us for painting rain that fizzles, not for a
  blank ribbon before real rain. A union of two independent models can only add
  warnings, never hide one.

**Under the hood (for the curious)**
- Backend fetches AROME (`nwp-v1-1h-2500m`) per grid point, cached 30 min (the
  model only re-runs 3-hourly) — about 22 extra GeoSphere calls/hour against the
  ~130 the nowcast already makes, far from the rate-limit incident territory. The
  precip parameter is discovered at runtime from the dataset's own metadata
  (per-interval `rr`, else accumulated `rr_acc` + de-accumulation) so a schema
  surprise degrades to "no AROME" instead of an outage.
- New pure `combineModelSeries`: per-slot max, AROME hourly totals scaled to slot
  width; an AROME timestamp is treated as the END of its accumulation hour — if
  that convention is ever wrong, rain paints an hour EARLY (a lead), never late.
- 6 + 4 new contract tests (162 total: 142 frontend + 20 backend). Fails soft
  everywhere: no AROME on the snapshot → exactly yesterday's behaviour.

---

## [2.6.0] — 2026-07-17 — Gemma Raus just got better: no more mixed messages 🧭
*Thank you for the sharp-eyed feedback on readability — three small things that each made the app say one clear thing instead of two conflicting ones.*

**What's new for you**
- **Zone band over the ribbon:** a thin labelled strip now sits above the rain bars —
  **RADAR · NEXT 3 H** over the solid look-ahead zone, **FORECAST · MODEL** over the
  dashed estimate zone. The solid→dashed switch finally explains itself; no more
  guessing where observation ends and estimate begins. (And no, nobody's radar sees
  further than ~3 h — beyond that, everyone's timeline is a model, including the big
  weather sites. We just label it honestly.)
- **No more "suspiciously perfect" under a drizzle countdown:** when ANY radar signal
  has rain in sight — drizzle ahead, echo nearby, rain approaching — the cheerful
  "go before the sky changes its mind" invitation notes now stay quiet instead of
  contradicting the countdown right below them.
- **Compass on the map:** a small N/E/S/W rose (N/O/S/W auf Deutsch) in the corner,
  so "rain approaching from the northwest" finally points somewhere you can see.

**Under the hood (for the curious)**
- The comfort-note gate (`rainSoon`) now includes every rain-in-sight trend signal
  (`downpourSoonMin`, `rvApproachMin`, `rvNearbyDir`, `traceEcho`, `traceAheadMin`),
  not just a hard `nextRainAt` within 90 min. Suppression only — it can never ADD an
  invitation, and prep notes (wind/cold) still show. Verdicts untouched.
- Ribbon canvas grew a 14 px zone band; the model-only fallback timeline draws the
  whole band as FORECAST (never claims a radar zone it doesn't have). 9 new contract
  tests (152 total: 136 + 16).

---

## [2.5.0] — 2026-07-17 — Gemma Raus just got better: it now foresees drizzle, not just rain 🔮
*Follow-up to today's drizzle incident: catching it live wasn't enough — you should have seen it coming.*

**What's new for you**
- **Drizzle countdowns:** when the radar's own timeline shows faint sub-threshold
  echo starting later ("drops on your face" level, under our 0.1 mm reporting line),
  the app now says so — *"light drizzle possible in about 30 min — radar shows the
  first faint echoes"* — instead of claiming "clear for hours".
- **Drizzle in the ribbon:** trace-level slots now draw as low translucent stubs (new
  "drizzle possible" legend entry), so the next hours never look blank while faint
  echo is on the way. An all-trace ribbon says *"only faint drizzle traces on radar —
  nothing heavier in sight"* instead of "no rain in 3h".

**Why**
- Live incident, same day as v2.4.1: while it drizzled, our nowcast *did* show the
  field continuing as 0.01 mm slots an hour ahead — the exact signal wetter.com was
  painting as "light until 13:00" — but everything below the reporting cutoff
  rendered as "nothing coming". We had the foresight and hid it.

**Under the hood (for the curious)**
- New pure `traceAheadMin(times, precips, nowSec)`: minutes until the first RUN of
  ≥2 consecutive trace slots (0 < mm < 0.1) within the 3 h radar window — a single
  0.01 noise blip can never paint drizzle on a dry day.
- New wording tier in the GO branch, radar-trace beats model-guess: approach ETA and
  nearby-watch (observed echo NOW) outrank it; it outranks the model second-opinion;
  real ≥0.1 mm countdowns are untouched; quiet at night. **No state changes** — trace
  futures are wording + ribbon only, they can never create a WAIT/STUCK.
- Verified against live data: the two still-dry grid points got "drizzle possible in
  ~13/~28 min" from the real feed. 15 new contract tests (143 total: 127 + 16).

---

## [2.4.1] — 2026-07-17 — Gemma Raus just got better: drizzle can't hide anymore 🌦
*Thank you for the live report — a real drizzle the app called "dry" is exactly the bug we care most about.*

**What happened**
- It was drizzling over Salzburg while every one of our usual sources read zero: the
  gauge (drizzle accumulates too slowly per interval), the radar nowcast's current
  slot (it lagged the fresh field by ~1 h), the model (flat 0.00 for 12 h) and the
  sky code (plain "overcast"). RainViewer's live radar tile was the **only witness**
  — echo blooming right over the city — and the v2.2.1 clutter guard vetoed it,
  because that guard required a nowcast trace as corroboration. Result: "totally
  dry" during real drizzle — the exact direction of mistake we promised to avoid.

**The fix**
- A lone stuck clutter pixel and a drizzle *field* look nothing alike on the radar
  tile. The sampler now counts wet pixels across the ~6×6 km block around your spot
  (the live incident: 24 of 25 wet; the old Nonntal clutter pixel: 1–2). Wide
  coverage (≥ 40 % of the block) now counts as corroboration on its own — RainViewer
  vouching for itself with spatial extent, under a non-clear sky.
- **All previous protections stay:** a clear sky still vetoes RV-only claims
  absolutely (sunny clutter/anaprop), a lone pixel with zero radar trace stays
  suppressed (the v2.2.1 incident replayed in tests, still dead), and the surfaced
  value stays capped to the light "GO ANYWAY — jacket" band — this can never
  manufacture a WAIT/STUCK.
- 6 new contract tests (128 total: 112 frontend + 16 backend), including a replay of
  today's exact incident. Zero extra network cost — same tile, more pixels read.

---

## [2.4.0] — 2026-07-17 — Gemma Raus just got better: it now sees which way the rain moves 🧭
*Thank you for being an early user and sharing feedback — that's exactly what makes this app better.*

**What's new for you**
- **Rain direction:** when rain is nearby, Gemma Raus now tells you *where* it is —
  "rain on the radar to the **west** — keeping an eye on it" — and when it's headed
  your way: "rain moving in **from the west** — about 20 min out".
- **City-scale picture:** a quiet new line shows where over Salzburg it's raining and
  which way it's going — "rain over the west of Salzburg — spreading" / "pulling back".
- All of this uses radar we already display — **observed** echo, not guesses.

**Under the hood (for the curious)**
- The RainViewer pixel sampler now reads an 8-point compass ring ~15 km around your
  spot **off the same tile** (zero extra network) → approach/nearby direction via a
  vector-summed dominant sector (`ringDirection`, opposite sectors cancel to "no
  coherent direction"). Direction enriches the existing approach ETA; a new
  "nearby, watching" tier fires when echo sits in a coherent sector with no arrival
  ETA yet — observed echo outranks the forecast hint, yields to trace drizzle at the
  pixel and to any arrival ETA, and stays quiet at night.
- The backend compares wet vs dry centroids across its 11 grid points each cycle
  (cos-corrected bearing) + wet-count trend → `area_watch {sector, trend}` on
  `/api/ambient`, shown as a muted banner when the grid is partially wet (fresh ≤10 min).
- 27 new contract tests (122 total: 106 frontend + 16 backend). No existing verdict
  logic changed — the new tiers only *add* information where the app used to be silent.

---

## [2.3.1] — 2026-07-17 — Human wording (confidence, not instruments) + visible forecast bars
### Changed (copy + ribbon visuals, no logic change)
- All "model" jargon replaced with plain confidence language: *"first signs: rain
  possible in about 1½ h — nothing on radar yet"* (was "model expects rain…"),
  *"should ease in about 2 h"* (was "model expects easing…"), forecast/Prognose in the
  legend and labels. Certainty is now carried by the words themselves — "first signs /
  possible / could / should" for forecast-only claims, firm phrasing for
  radar-confirmed ones — instead of asking users to know what a "model" is.
- Ghost/forecast bars in the ribbon now have a faint translucent fill (not just a
  dashed outline) — visible as real bars at a glance while staying clearly distinct
  from solid radar bars.

---

## [2.3.0] — 2026-07-17 — Acknowledge trace drizzle below our reporting cutoff
### Added (rain logic — wording only, GEMMA RAUS stays GEMMA RAUS)
- Live incident, Nonntal: it was genuinely (lightly) drizzling — every nearby grid
  point showed real, widespread radar echo of **0.01–0.06 mm**, all below our
  `DRY_THRESHOLD` (0.1 mm/15min) reporting cutoff. The app said flatly "clear for
  hours" / "rain in about 2½ h", implying total dryness when faint, real drizzle was
  happening right now. `DRY_THRESHOLD` is a reporting line, not a physical one.
- New `hasTraceEcho(rawNowSlot)`: when the radar's OWN 3h timeline is fully dry
  (`dryEndsOpen`) but its raw current-slot reading shows *any* non-zero trace below
  the cutoff, the GO sub now says so — combined with the model's own far-rain time
  when available: **"light drizzle on radar right now — steadier rain expected in
  about 2½ h"**. Standalone wording when no model rain data exists. Popup notices too.
- Policy: *better to nudge caution than stay silent about a signal we already have* —
  but this is wording-only. It does NOT flip GEMMA RAUS to GO ANYWAY (that requires
  `surfaceDrizzle`'s stricter, corroborated bar) and never touches WAIT/STUCK.
  Downpour warning and RV-approach still outrank it; night keeps the cosy drizzle
  voice instead. 10 new contract tests (95 total).

---

## [2.2.1] — 2026-07-17 — Fix the overcast-clutter bug (GO ANYWAY while genuinely dry)
### Fixed (rain logic)
- Live incident, Nonntal: gauge 0.0, radar nowcast an **exact 0.0 across the whole 3h
  window**, sky overcast (code 3) — yet a raw RainViewer pixel claimed echo, and the
  drizzle-surfacing guard (only blocking under a *clear* sky) let it through. The app
  said GO ANYWAY while it genuinely was not raining.
- `surfaceDrizzle` now requires **independent radar corroboration** for an RV-only
  claim: any non-zero nowcast trace (however small) near the pixel, not just "sky isn't
  clear". A flat, exact-zero radar reading is treated as active disagreement — real
  weather leaves *some* radar signature; a total absence, overcast or not, is clutter
  (terrain reflection off Untersberg/Gaisberg, or tile noise). "Sky unknown" no longer
  gets a free pass either. The original hyperlocal-drizzle catch this feature was built
  for is unaffected — that case already had a non-zero (near-threshold) radar trace.
  2 new / 4 updated contract tests (85 total).

---

## [2.2.0] — 2026-07-16 — Ribbon extended to 12h + mobile auto-scroll
### Added (ribbon UI)
- **Ribbon now spans 12h** (was 3h): radar covers the first ~3h as solid bars
  (unchanged, ground/radar-trusted); beyond that, the model's own 12h timeline fills
  the rest as **dashed outlined bars** — same visual language as the v2.1 ghost bars,
  so "this is an estimate, not radar precision" reads consistently across the whole
  chart. A subtle dashed divider + "model →" tag marks the handoff point. Zero extra
  API calls — the model timeline was already fetched for the ghost bars/second-opinions.
- **Auto-scroll for mobile**: the ribbon now slowly drifts forward (so all 12h become
  visible without manual scrolling), pauses briefly at the end, then rewinds quickly
  back to "now" and repeats. Self-gates to when the ribbon actually overflows the
  screen (desktop where it all fits does nothing), respects
  `prefers-reduced-motion` (disabled entirely), and pauses for 5s the instant the user
  touches/scrolls/wheels it — never fights a manual read.
- Ribbon label updated from "3h · Radar" to "12h · radar + model".

---

## [2.1.0] — 2026-07-16 — Model in the gaps: ghost bars + STUCK second-opinion
### Added (rain logic + ribbon)
- **Ghost bars:** model-only rain (radar slot dry, model slot wet) is now drawn in the
  ribbon as **dashed outlined bars** at the model's intensity, with a "model (expected)"
  legend chip — both instruments visible at a glance without faking radar precision.
  Only drawn when the solid bars are radar (in model-fallback mode the bars ARE the model).
- **STUCK second-opinion** (`modelEaseAt`): STUCK means "radar sees no break in 3 h" —
  if the model's own timeline shows the rain **ending**, the sub now says "no break on
  radar — **model expects easing in about 2 h**" (popup notice too). Wording only; the
  state and colour stay STUCK until radar confirms. Requires the model to actually show
  the rain first (a model that's dry all window contradicts the present → no claim).
  Thunderstorm wording still outranks it. Completes the design law on the STUCK side:
  *never claim what any of our own sources contradicts.* 8 new tests (83 total).

---

## [2.0.3] — 2026-07-16 — One-time trust note (owning the July 15 miss)
### Added (UI)
- A one-time, closable in-app note: *"On July 15 we missed the evening rain — we're
  sorry. The app now also cross-checks the weather model and the radar's motion, and
  warns when rain is expected even while the radar is still clear."* Shown once per
  device (localStorage `update_note_20260716`), dismissible, DE + EN. Owning the miss
  publicly + saying exactly what changed.

---

## [2.0.2] — 2026-07-16 — Map animation reaches the actual future
### Fixed (map UX)
- The radar timeline often ended in the past ("stops at 20:30 when it's 20:34"):
  RainViewer frames are 10-min quantized and generated ~5–10 min behind wall clock,
  and we kept only 2 of its 3 forecast frames — so the "future" frames were frequently
  already history. Now **all 3 forecast frames** are animated (loop reaches ~+20 min
  past wall clock) and **forecast frames dwell 2× longer**, so the loop reads
  "now → ahead" instead of a history reel. Frame set still refreshes every 5 min.

---

## [2.0.1] — 2026-07-14 — Trailing-edge fix: the model can't out-shout a reporting gauge
### Fixed (rain logic — the bogus "WAIT 50 MIN in the sun")
- Open-Meteo's `current.precipitation` is a **preceding-hour** value — after rain ends
  it stays high for up to an hour. The blend took `max(model 0.7, gauge 0.0) = 0.7` →
  a false WAIT/STUCK on every trailing edge while the sky was already clearing.
- New rule (`gaps.modelNowValue`, contract-tested): **a reporting gauge owns the NOW
  magnitude**; the hour-lagged model current is capped at the light band (**0.4**) —
  it may whisper "drizzle the gauge missed", it can never manufacture WAIT/STUCK alone.
  The 0.10-rounding guard is preserved; with no gauge at all the model passes through.
  Same cap philosophy as the virga filter. 4 new tests (75 total).

---

## [2.0.0] — 2026-07-14 — Full-frame radar approach: a real ETA, not a guess
### Changed (rain logic — refines the v1.4.0 approach guard)
- The RainViewer approach guard now samples **every** forecast frame (10-min steps,
  ~+10/+20/+30) instead of only the last one. Two wins: an **early-arriving cell
  (+10 min) is no longer missed** (previously invisible if it passed before the +30
  frame), and the verdict shows the **first-arrival ETA** — "rain approaching on radar
  — could reach you in about **10** min" — instead of a generic "~30 min".
- Tile cost unchanged in practice: every Salzburg point maps to the same z7 tile, so
  the browser caches per frame path across the live location and all dots.
- Versioned 2.0: with v1.4's model second-opinion + this, the forward view is now a
  true **multi-source architecture** (gauges → RainViewer now/approach → GeoSphere
  timeline → model second-opinion), each source used where it leads. 71 contract tests.

---

## [1.4.0] — 2026-07-14 — Fix the missed evening rain: two onset guards
**Post-mortem:** the app said dry all evening; rain came; other weather apps had it.
Root cause was architectural: the NEXT lane was **radar-nowcast-only**, and radar
extrapolation cannot see rain that doesn't exist as echo yet. For frontal/stratiform
onset the MODEL leads the radar by hours (the mirror of convection, where radar leads
the lagging model — we'd over-fit to that first lesson and discarded the model whenever
the radar answered). On top of that, GeoSphere's nowcast issues 15–25 min behind real
time, while RainViewer's frames run ~5 min behind — users could SEE the rain as blue on
our own map while the ribbon claimed dry.

### Added (rain logic — two new onset guards, radar still leads when it sees rain)
- **Model second-opinion** (`modelNextRainAt`): when the radar claims a full 3 h
  all-clear but the model's own minutely timeline shows rain, the verdict says
  "**radar clear so far — model expects rain in about X**" (minutes <90, hours ≥90),
  in the sub, the popup notice AND the ribbon dry-label. Never a confident all-clear
  the model contradicts: *better someone stays home dry.*
- **RainViewer approach guard** (`rvApproaching`): the pixel sampler now also reads the
  RainViewer FORECAST frame (~+20–30 min, observed echo motion). Pixel clear now + echo
  arriving + GeoSphere silent → "**rain approaching on radar — could reach you within
  ~30 min**". Moving echo can't be static clutter, so no clear-sky guard needed.
  Promotes what users can already see on the map into the verdict.
- Precedence: downpour warning > RV approach > model second-opinion > radar countdowns
  (a nearer GeoSphere countdown always wins over the approach guard). 9 new contract
  tests (70 frontend total).

---

## [1.3.1] — 2026-07-14 — Honest dry-ribbon label (attribution + instability)
### Changed (wording only)
- The all-dry ribbon label no longer reads as a promise. Default: "**radar sees** no
  rain in the next 3 h" (attributes the claim to the instrument). Under unstable air
  (CAPE ≥ 300): "radar sees no rain **yet — unstable air, can change fast**". CAPE
  alone gates the variant (no hour/probability filter — it's wording, not a banner).

---

## [1.3.0] — 2026-07-14 — Convective watch: CAPE flags the risk, radar confirms it
### Added (banners + one push — the verdict logic is untouched)
- **Layer 1 · "Unsettled" regime flag** (frontend, muted banner): CAPE ≥ 300 J/kg AND
  max hourly probability (next ~4 h) ≥ 50% during convective hours (11:00–20:00) →
  *"unsettled air — showers can form fast today, windows may be short."* Sets
  expectations on pop-up-shower days without contradicting GEMMA RAUS. Evidence-based
  thresholds: the soaking day (CAPE 200–570, prob 40–78%) flags; the sunny-clutter day
  (CAPE 90–330, prob 3–53%) doesn't. Suppressed when the ≥1500 storm banner is up.
- **Layer 2 · Radar-confirmed initiation** (backend): each cycle compares every grid
  point's "wet now" against the previous cycle; **≥3 points flipping dry→wet in one
  cycle + CAPE ≥ 300** = cells forming over the basin RIGHT NOW (observation, not
  speculation). Stamps `forming_ts` on `/api/ambient` → alert banner *"showers forming
  over Salzburg right now — any spot could get hit"* (visible 30 min, live-expiring) +
  a **once-per-day "forming" push** (top of the story order, daytime + pacing rules).
- 6 new frontend tests + 4 new backend tests (73 total).

---

## [1.2.1] — 2026-07-14 — Gap-confidence softener (symmetry with rain onset)
### Changed (wording only — times always kept)
- A break predicted **≥60 min out** is now spoken as "**break likely in about X min**" /
  "rain **should** end in about X min" (WAIT sub + popup notice); breaks under an hour
  stay firm. Time-based on purpose: verified nowcast skill is strong under 1 h and
  decays past it (POD ~50% at 60–90 min) — and the model's *hourly* probability stays
  high through a whole rainy spell, so a probability-based softener would have marked
  every intra-rain gap "likely" (over-softening). Mirrors the v1.2.0 far-rain rule:
  soften the wording, never delete the countdown. 3 new contract tests (55).

---

## [1.2.0] — 2026-07-14 — The countdown covers the FULL horizon (gaps-first)
### Changed (rain logic)
- **Far-out rain (≥90 min) now always gets an explicit countdown, in hours** — "GEMMA
  RAUS · rain in about 3 h". Previously the explicit countdown stopped at ~90 min:
  beyond that, low-confidence rain collapsed to a timeless "rain possible later" (and
  the reader saw the band in the ribbon with no matching words — the Nonntal 3 h case).
  Low model confidence now **softens the wording but keeps the time**: "rain possible
  in about 2 h". Rounded to the nearest half hour (1½ / 2 / 2½ / 3). Map-popup notices
  carry the same far countdown (`n_rain_far`).
- Philosophy made explicit: **the dry window is the product** — every state that knows
  when rain arrives says so, across the whole 3 h horizon. 4 new contract tests (52).

---

## [1.1.5] — 2026-07-14 — Clear-sky clutter guard (fix "sunny but PASST SCHON")
### Fixed
- On a sunny day the app showed **GO ANYWAY + light rain in the ribbon** while gauge,
  model (code 1 = sunny) and the filtered nowcast all read bone dry. The lone witness
  was the **raw RainViewer pixel** — raw radar tiles show ground clutter (mountain
  reflections, insects, anaprop) on clear days; the GeoSphere nowcast is
  clutter-filtered, RainViewer tiles are not.
- Drizzle surfacing extracted to a pure, tested function (`gaps.surfaceDrizzle`) with
  a **clear-sky clutter guard**: an RV-only echo cannot surface drizzle when the model
  says the sky is clear (code ≤ 2). Echo in the *filtered* nowcast still surfaces even
  under a clear sky (quality-controlled source), overcast/unknown sky still trusts RV
  (the real Nonntal drizzle case) — so the gauge-blind-drizzle catch is fully preserved.
- 7 new contract tests (48 total frontend).

---

## [1.1.4] — 2026-07-06 — CRITICAL: virga filter was hiding real downpours
### Fixed (regression, introduced in 1.1.0)
- The virga-filter "cap" rewrite accidentally applied to **all** low-probability echo —
  including a real 2–3 mm convective downpour. ICON-EU lags convection, so on pop-up
  shower days its probability stays <50% exactly when the radar sees a real cell: the
  filter capped the downpour to 0.4 mm → ribbon showed "light drizzle", the ≥1.5 mm
  downpour warning could never fire, and the verdict said GO ANYWAY into a soaking.
  (The backend's push analysis reads the raw timeline — that's why it correctly fired
  `rain_incoming` while the app showed dry: the app was served the filtered data.)
- **Heavy echo (≥1.5 mm) now always passes through unfiltered** — radar seeing heavy
  rain is self-evidencing; virga is light echo by nature. Light low-confidence echo is
  still capped at 0.4 (no false storms), high-probability rain untouched.

---

## [1.1.3] — 2026-07-06 — Cut GeoSphere calls ~5× (fix 429 rate-limiting)
### Fixed
- The backend made **~67 GeoSphere calls per cycle** — the forecast loop *and*
  `check_and_push` each re-fetched all 11 nowcasts, plus a ground fetch and per-row
  verification each hit TAWES (~45 identical calls, since every city point shares the
  same 2 gauges). This tripped GeoSphere's **429** (`[ground] 429 Too Many Requests`),
  occasionally starving the nowcast → an Open-Meteo fallback that lags convection.
- Added per-cycle caches: **nowcast** by point (`_NOWCAST_TTL`) and **TAWES** by
  station-id (`_TAWES_TTL`), both < the 300 s cycle. Same-cycle reuse collapses the
  load to **~12 calls/cycle** (11 nowcast + 1 TAWES) — fresh data each cycle, no 429.

_Note: investigation showed the missed-downpour report was primarily convective
nowcast limitation (a 6 pm cell isn't predictable at noon; the backend detected it only
as it arrived), not this rate-limit — but the 429 was a real reliability risk regardless._

---

## [1.1.2] — 2026-07-06 — Decouple the two upstream APIs (resilience)
### Fixed
- `/api/ambient` served **nothing** whenever the Open-Meteo call failed (e.g. its daily
  limit), because the GeoSphere ground + nowcast were attached to points that only
  existed on Open-Meteo success — so one API being down wiped the other's data, and a
  redeploy (which clears the in-memory snapshot) exposed it. Now, if Open-Meteo fails
  and there's no prior snapshot, the backend seeds a POINTS skeleton (null weather) so
  the ground + nowcast still reach clients. Clients already null-guard the weather fields.

---

## [1.1.1] — 2026-07-06 — Fix broken install-prompt icon
### Fixed
- The install popup showed a broken-image placeholder — it referenced a
  non-existent `/icon-192.png`. Pointed it at the real `/android-chrome-192x192.png`.

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
