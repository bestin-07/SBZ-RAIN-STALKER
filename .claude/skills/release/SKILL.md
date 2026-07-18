---
name: release
description: Cut and ship a Gemma Raus release — run both test suites, bump SemVer, write the changelog in the house voice, commit/tag/push, verify live. Use for any "ship it", version bump, or release request.
---

# Cutting a Gemma Raus release

Follow in order. Never skip the test gates.

## 1. Test gates (before AND after your changes)

```powershell
cd frontend; npm test          # vitest — all must pass
cd ..; python backend/test_logic.py   # unittest — NO pytest on this machine
cd frontend; npm run build     # syntax/JSX gate
```

A failing test means your change is a bug — OR the intent changed, in which case
update the test AND add a CLAUDE.md Logic change log entry together, never silently.

## 2. Version bump (frontend/package.json "version")

- **PATCH** — bug fix / copy / UI, no logic change.
- **MINOR** — new feature OR any rain-logic behavioural change (requires a Logic
  change log entry in CLAUDE.md).
- **MAJOR** — breaking / re-architecture.

## 3. CHANGELOG.md — the house voice (mandatory style)

Title: `## [X.Y.Z] — YYYY-MM-DD — Gemma Raus just got better: <hook> <emoji>`
Then an italic one-liner acknowledging what the user experienced, then sections
**What happened** / **What's new for you**. Warm second-person prose, no dev
jargon, explain the *why*. Copy the tone of the 2.8.0/2.9.0 entries.

If the release changes any verdict/wording boundary, ALSO add a Logic change log
entry in CLAUDE.md (newest first, full doctrine: incident, rule, guards, why no
lag risk). Cosmetic/UI-only releases get NO logic-log entry.

## 4. Commit, tag, push (PowerShell 5.1 — no &&)

Write the commit message to a scratchpad file (multiline messages break inline
in PS 5.1), then:

```powershell
cd c:\projects\GemmaRaus\SBZ-RAIN-STALKER
git add -A; git status --short   # CHECK: unstage RAIN_LOGIC.md / docs/ if swept in (local-only files)
git commit -F <scratchpad-file>
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --tags      # Railway auto-deploys (~2 min)
```

End the commit message with: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`

## 5. Verify live

Use the `verify-deploy` skill (sw.js cache-stamp method). NEVER poll bundle
hashes against a local build — Railway's hashes never match local ones.

## 6. CI

GitHub Actions "Logic integrity guard" runs on push. Check anonymously:
`https://api.github.com/repos/bestin-07/SBZ-RAIN-STALKER/actions/runs?per_page=3`
(gh CLI is NOT installed). A red X = logic contract broke → roll back by tag
via Railway dashboard, then fix forward with git revert + PATCH.
