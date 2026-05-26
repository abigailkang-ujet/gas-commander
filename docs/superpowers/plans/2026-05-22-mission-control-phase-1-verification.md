# Mission Control — Phase 1 Verification

**Date:** 2026-05-26
**Phase 1 commits:** 6d5af7d (spec) → 04d0b17 (T11 final impl) on `main`

## Headless checks (run via `node -e` smokes)

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Stack detection on 5 real paths | PARTIAL (4/5) | jira-portfolio-plugin Desktop copy doesn't exist yet; detectStack returns 'unknown' as graceful degrade. Will resolve on next app launch when sync-projects auto-clones it. |
| 2 | Apps Script Live URL probe (esl-timeline, Programs-dashboard) | PASS | Both return 302 OK, dot green. |
| 3 | probeAppsScript null/unreachable branches (code trace) | PASS | not-configured → warn, unreachable → bad, code≥400 → bad. |
| 4 | Forge probe — `forge install list --product jira` on jpp home copy | PASS | Returns v5 (correct App version), level ok. Dot yellow because git dirty. |
| 5 | Python probe — `gh` CLI not installed (degraded path) | PASS | Last cron: "gh not installed" (bad), Next run: "—" (neutral), dotLevel red, errors=['gh CLI missing']. |
| 11 | gas-commander self entry — grey-dot lock | PASS | Git row reports warn (dirty), dotLevel forced to grey. |

**Headless score: 5/6 PASS, 1 PARTIAL (expected behavior — not a bug)**

## GUI-dependent checks (manual verification on next app reload)

These require launching gas-commander (Cmd+R if already running) and clicking through the UI:

| # | Check | What to verify |
|---|---|---|
| 6 | Refresh button | Click ↻ Refresh — button disables + shows … during fetch, restores text on completion. lastRefreshed timestamp updates. |
| 7 | First-open snapshot | App launches → Mission Control populates cards within ~1–2s without manual interaction. |
| 8 | Add Project happy path | Click + Add Project → Browse picks a folder → stack auto-detected → Save adds card to grid. |
| 9 | Add Project with junk path | Path that doesn't match any stack heuristic → detected = "unknown" → Save still works → card appears (warn). |
| 10 | Remove from registry | Right-click a non-self card → confirm dialog → card disappears + registry file no longer contains it. |
| 12 | Restart app | Close + reopen → Overview re-fetches automatically on first launch (not cached from prior session). |

## Pre-existing items observed but not addressed (out of Phase 1 scope)

- jira-portfolio-plugin Desktop copy is missing on this laptop (user's actual work copy lives at `/Users/ab/jira-portfolio-plugin`). The auto-clone on next gas-commander launch will create the Desktop mirror. Mission Control will then read from the mirror (current registry path).
- `var(--text-primary)` referenced in `renderDeployPreview` inline styles (renderer/app.js lines 543, 567) — the codebase actually defines `--text`. Visual fallback is browser default. Not introduced by Phase 1.

## Next phase

Phase 2 — Per-stack Deploy Automation. The deploy dialog hotfix (B1/B2) is the foundation; Phase 2 adds Forge + Python (GH workflow trigger) deploy paths and unified UX.
