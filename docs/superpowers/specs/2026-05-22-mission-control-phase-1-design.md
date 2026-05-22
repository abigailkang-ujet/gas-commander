# Mission Control — Phase 1 Design

**Date:** 2026-05-22
**Owner:** Abigail Kang
**Scope:** Phase 1 of a 5-phase upgrade. This document specifies Phase 1 only.

---

## Why

Current `gas-commander` is essentially a CLI wrapper: pick a project, run a Claude skill, watch streaming output. It does not answer the daily PM question "is anything broken across my projects right now?", and it only knows about 2 of the 5 projects the user actively maintains. Phase 1 turns the app into a glanceable health surface for the full portfolio, on a foundation that later phases can extend.

## Phase relationships (context only)

| Phase | What | Status |
|---|---|---|
| **1** | **Multi-stack Registry + Mission Control (read-only)** | this spec |
| 2 | Per-stack Deploy Automation (1-click Apps Script / Forge / Python deploy) | next |
| 3 | Notion vs Jira drift check (skill panel) | later |
| 4 | Daily / Weekly portfolio snapshot (Slack-ready) | later |
| 5 | JIRA issue bulk operations | last (mutation risk) |

Each later phase is its own spec + plan + impl cycle.

---

## Scope

### In scope

1. Replace the hardcoded `PROJECT_REGISTRY` in `main.js` with a data-driven registry stored as JSON in the user data directory.
2. Add three currently missing projects to the default registry: `jira-portfolio-plugin`, `esl-jira-notion-sync`, `gas-commander` itself.
3. Auto-detect each project's stack (Apps Script / Forge / Python / Electron) from filesystem markers.
4. New **Overview** view in the main panel showing a 5-card health grid.
5. New sidebar entry `📊 Overview` at the top; selecting it activates Overview. The same view is shown by default when no project is selected.
6. **+ Add Project** button at the bottom of the project list in the sidebar; opens a small dialog (path picker + auto-detected stack + display name + color).
7. Refresh model: **on open + manual `↻ Refresh` button** in the Overview header. No background polling.
8. Per-stack health signals as defined below.

### Explicitly out of scope (deferred to later phases)

- Any mutating action from the Overview view (no Deploy/Re-run/etc. buttons on cards) — read-only.
- Notion API calls / row-count deltas — handled in Phase 3.
- Auto-scan of `~/Desktop` for new projects.
- Slack export.
- Cron-time editing / GitHub Actions trigger.
- Per-project settings UI beyond Add/Remove.

---

## Architecture

### Process layout (unchanged)

Electron main process (`main.js`) owns project state and shell-outs. Renderer (`renderer/app.js`, `renderer/index.html`, `renderer/styles.css`) owns UI. IPC bridges them via `preload.js`. Phase 1 adds new IPC channels but doesn't change the process model.

### New / changed components

| Component | Change |
|---|---|
| `main.js` | Remove hardcoded `PROJECT_REGISTRY`. Load registry from `<userData>/projects.json` on startup; ship a `projects.default.json` seed alongside the app. Add IPC handlers: `registry:list`, `registry:add`, `registry:remove`, `health:snapshot`, `health:refresh`. |
| `main.js` (new module: `health.js`) | One health-probe function per stack: `probeAppsScript(project)`, `probeForge(project)`, `probePython(project)`, `probeElectron(project)`. Each returns `{ rows: [{label, value, level}], dotLevel, errors }`. |
| `main.js` (new module: `stackDetect.js`) | `detectStack(projectPath) → 'gas' | 'forge' | 'python' | 'electron' | 'unknown'`. Pure function over filesystem. |
| `preload.js` | Expose the new IPC channels on `window.gc`. |
| `renderer/index.html` | Add Overview view shell in main panel; sidebar entry. |
| `renderer/app.js` | Add `currentView` state (`'overview' | 'project'`). Wire sidebar Overview click, Add Project dialog, Refresh button, card rendering. |
| `renderer/styles.css` | Mission Control grid + card styles (Standard density, per the wireframe). |
| `docs/superpowers/specs/...` | This file. |

No new npm dependencies.

### Data flow (refresh)

```
User opens app or clicks ↻ Refresh
  → renderer sends 'health:refresh' IPC
  → main.js iterates registry
    → for each project: detectStack(path) → probe<Stack>(project)
    → probes run in parallel (Promise.all) with a per-probe timeout (5s)
  → main returns array of HealthCard objects
  → renderer renders grid; stores `lastRefreshedAt`
```

The renderer automatically requests one snapshot when Overview is first shown in a session. Switching to a project and back later does **not** re-fetch — the user uses the Refresh button. The snapshot is in-memory only; restarting the app re-triggers the first-open fetch.

---

## Data model

### Registry storage

File: `<userData>/projects.json`. Created from `projects.default.json` on first launch.

```jsonc
{
  "projects": [
    {
      "id": "esl-timeline",
      "name": "ESL Timeline",
      "color": "#3b82f6",
      "path": "/Users/ab/Desktop/esl-timeline",
      "repo": "https://github.com/abigailkang-ujet/esl-timeline.git",
      "stackOverride": null,        // optional manual override
      "settings": {
        "liveUrl": null              // auto-discovered from CLAUDE.md on first probe
      }
    }
    // ...
  ]
}
```

`gas-commander` self-entry has `stackOverride: "self"` so its dot is always neutral grey.

### Stack auto-detection (priority order)

Pure-filesystem checks, executed top to bottom; first match wins. Run inside the project dir.

| Stack | Check |
|---|---|
| **forge** | `manifest.yml` exists AND contains a `modules:` top-level key |
| **gas** (Apps Script) | `.clasp.json` OR `appsscript.json` exists, OR any `*.gs` file at root |
| **python** | `requirements.txt` exists AND `.github/workflows/*.yml` exists |
| **electron** | `package.json` exists AND `dependencies.electron` (or `devDependencies.electron`) is set |
| **unknown** | none of the above |

`stackOverride` on the project record takes precedence over auto-detection.

### Per-stack health probes

Each probe returns three rows (per the Standard density card) plus an overall dot color.

#### Apps Script (`gas`)

| Row | Source |
|---|---|
| Live URL | `liveUrl` from project record. If null, parse from `CLAUDE.md` — first match of `script\.google\.com/.+?/exec`, cached to the project record on first probe. Probed via `curl -sI -o /dev/null -w "%{http_code}" --max-time 5 <url>`. |
| Last commit | `git log -1 --format=%cr` inside `path`. |
| Git | `git status --porcelain` + `git rev-list --count @{u}..HEAD` (ahead) / `HEAD..@{u}` (behind). Shape: `clean · main` / `+2 ahead` / `dirty`. |

Dot levels: red if Live URL non-200 or git/HEAD command failed; yellow if `+N ahead` or last commit > 14 days; otherwise green.

#### Forge

| Row | Source |
|---|---|
| Install | `forge install list --product jira` text, parse the version of the matching app. (Forge CLI path: `~/.npm-global/bin/forge`; full path used if `which forge` fails.) |
| Last commit | same as gas |
| Git | same as gas |

Dot: red if `forge install list` errors out; yellow on `+N ahead` / dirty / commit > 14d; green otherwise.

#### Python + GH Actions (`python`)

| Row | Source |
|---|---|
| Last cron | `gh run list --workflow=<workflow.yml> --limit=1 --json status,conclusion,createdAt` parsed. Workflow filename auto-picked: first `.yml` in `.github/workflows/` whose contents include `schedule:`. Result shape: `FAIL 1h` / `OK 30m`. |
| Next run | Parse the `cron:` expression from that workflow; compute next fire time in user TZ. Shape: `:30`, `Mar 23 09:00`, etc. |
| Git | same as gas |

Dot: red if last conclusion is `failure` or `gh` not installed; yellow on dirty/+ahead; green otherwise.

**Prerequisite:** `gh` CLI not currently installed. The Python probe degrades gracefully: if `which gh` fails, both Last cron and Next run show `gh not installed`, the dot goes red once, and the user is shown a one-time tooltip suggesting `brew install gh && gh auth login`.

#### Electron self (`self` override)

| Row | Source |
|---|---|
| Type | static literal `Electron` |
| Last commit | `git log -1 --format=%cr` |
| Git | same as gas |

Dot: always grey. Self is informational only — never trips a yellow/red signal.

### Color thresholds (summary)

| Dot | Trigger (any one is sufficient) |
|---|---|
| 🟢 Green | All stack-specific signals nominal AND git is clean AND last commit ≤ 14d |
| 🟡 Yellow | Git ahead / dirty, **or** last commit > 14d |
| 🔴 Red | Live URL non-200, **or** last cron `failure`, **or** required external tool (`gh`/`forge`) missing/erroring |
| ⚪ Grey | Self project; or stack === `unknown` |

---

## UI

### Sidebar (changed)

Top to bottom:

1. `📊 Overview` (always visible, top of sidebar). Active style when current view is Overview.
2. `Projects` divider.
3. One row per project: status dot + name. Active style when the row's project is currently open.
4. `+ Add Project` button (dashed border, subtle styling), bottom of project list.
5. `Skills` divider — **shown only when a project is selected** (no change from today).
6. List of `.claude/commands/` skills (no change).
7. `Deploy` divider + button — **shown only when a project is selected** (no change).

Clicking `📊 Overview` sets `currentView = 'overview'` and unselects any active project visually (project still remembered for "back" purposes is **out of scope** — user re-clicks the project to return).

### Overview view (new)

Single screen replacing the main panel content when `currentView === 'overview'`.

```
┌────────────────────────────────────────────────┐
│ Mission Control            Refreshed 12s ago   │
│                            [ ↻ Refresh ]       │
├────────────────────────────────────────────────┤
│                                                │
│ ┌─card─┐ ┌─card─┐ ┌─card─┐                     │
│ │      │ │      │ │      │                     │
│ └──────┘ └──────┘ └──────┘                     │
│ ┌─card─┐ ┌─card─┐                              │
│ │      │ │      │                              │
│ └──────┘ └──────┘                              │
│                                                │
└────────────────────────────────────────────────┘
```

- Grid: `repeat(auto-fill, minmax(280px, 1fr))` so it reflows below ~960px window width.
- Card shell: see wireframe (`2026-05-22-overview-wireframe.html`). Standard density. Three rows + dot + name + small uppercase stack tag in top-right.
- Clicking anywhere on a card switches the app to that project (= same effect as clicking the project in the sidebar).
- The Refresh button disables itself while a probe is in flight and shows a small spinner inside.

### + Add Project dialog (new)

Modal opened by the sidebar `+ Add Project` button:

| Field | Behavior |
|---|---|
| Path | Text input + "Browse…" (Electron `dialog.showOpenDialog`, directories only). |
| Detected stack | Read-only, populated when path resolves. Falls back to "Unknown — pick manually" with a dropdown override. |
| Display name | Defaults to the folder basename, editable. |
| Color | Color picker, default `#9aa4b8`. |
| Cancel / Save | Save writes to `projects.json`, closes the modal, refreshes the Overview. |

Right-click a project row in the sidebar → context menu with "Remove from registry" (does not delete the folder).

---

## Error handling

- Each probe is wrapped in its own try/catch with a 5-second timeout. Errors become a card-level red dot + a single-line error row in that card; the overall app stays responsive.
- If `projects.json` is missing or unparseable on startup, fall back to `projects.default.json` and write a fresh copy. Log to a `.gas-commander-errors.log` next to `projects.json`.
- `gh` / `forge` / `clasp` missing are not fatal — the corresponding probe degrades and the dot reports red.

## Testing

There is no test framework in the project today, consistent with `esl-timeline`'s convention. Phase 1 verification is manual:

1. **Stack detection** — point `path` at each of the 5 real project dirs and confirm the detected stack matches expectation.
2. **Probe correctness** — run Overview against the live state; verify every row matches what the underlying CLI (`git status`, `curl -I`, `gh run list`, `forge install list`) reports.
3. **Refresh** — verify a snapshot loads on first open of Overview, that the manual button forces a fresh probe, and that disabling/re-enabling works during in-flight requests.
4. **Add / remove project** — round-trip a junk project through Add → appears in Overview with `unknown` stack → Remove → disappears.
5. **Degraded paths** — temporarily rename `gh` and reload to confirm the Python card goes red with a graceful message, not a crash.

---

## Non-goals reminder

The Overview is **read-only** in Phase 1. Any "Deploy" / "Re-run" / "Open URL" affordance on the card belongs to Phase 2. Implementers who feel the urge to add a button to make the demo "feel finished" should resist; the goal here is the foundation and the read.
