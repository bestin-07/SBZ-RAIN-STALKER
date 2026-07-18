---
name: verify-deploy
description: Verify a Railway deploy of gemmaraus.at actually went live after a push to main. Use after every push, or when unsure which version is serving.
---

# Verifying a Gemma Raus deploy

Railway auto-deploys `main` in **~2 minutes**. The ONLY reliable liveness signal
is the service-worker cache stamp — the Dockerfile bakes the build time into it.

## The method

Wait ~2–3 min after push, then:

```powershell
$sw = (Invoke-WebRequest -UseBasicParsing "https://www.gemmaraus.at/sw.js?nocache=$(Get-Random)").Content
[regex]::Match($sw, 'gemma-raus-\d+').Value   # gemma-raus-YYYYMMDDHHMM (UTC build time)
```

If the stamp's timestamp is after your push → deployed. To verify specific code
landed, fetch `/` (cache-busted), extract `assets/index-[A-Za-z0-9_-]+\.js`, and
grep that bundle for a distinctive NEW string from your change (version number,
an aria-label, a new export name that survives minification).

## Hard-won rules (an hour was once lost to each)

- **NEVER compare the live bundle hash to a local `npm run build` hash.** Railway
  bakes different VITE_* env vars → hashes never match local, ever.
- **NEVER poll "waiting for the bundle hash to change" with a baseline captured
  after pushing** — Railway deploys so fast your baseline is already the new
  bundle; you'll wait forever and wrongly conclude the deploy is stuck.
- Don't push empty retrigger commits until the sw.js stamp proves the build
  didn't happen.
- gemmaraus.at endpoints are safe to poll (own server). The metered upstream
  weather APIs are NOT — see the probe-weather skill.
