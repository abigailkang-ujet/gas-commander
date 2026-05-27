# Phase 2 — Python Workflows Panel Design

**Date:** 2026-05-27
**Owner:** Abigail Kang
**Scope:** Phase 2 of a 5-phase upgrade. Python (esl-jira-notion-sync) only. Forge / Apps Script unchanged.

---

## Why

Phase 1 made gas-commander a glanceable status surface for 5 projects. Phase 2 adds the first **mutating** action: triggering scheduled GitHub Actions workflows on demand for Python-stack projects, and viewing their run history + logs inside gas-commander.

Original Phase 2 scope (per Phase 1's roadmap) included Forge deploy too. Dropped after re-scoping with the user: Forge work is currently driven via the Claude prompt bar inside gas-commander, so a "Deploy to Forge" button only saves one Claude turn — marginal value. Apps Script deploy is already handled by Phase 1's B1–B4 flow. Python workflow triggering is the one operation that has real "code-free, Claude-free" value: the user wants to manually re-run a sync without involving anyone.

## Phase relationships

| Phase | What | Status |
|---|---|---|
| 1 | Multi-stack Registry + Mission Control (read-only) | ✅ shipped 2026-05-26 |
| **2** | **Python Workflows Panel (this spec)** | **active** |
| 3 | Notion vs Jira drift check (skill panel) | later |
| 4 | Daily/Weekly portfolio snapshot for Slack | later |
| 5 | JIRA issue bulk ops | last |

---

## Scope

### In scope

1. **Sidebar Workflows section** — replaces the (otherwise hidden) Deploy section when the selected project has `stack === 'python'`. Lists every workflow in the project's `.github/workflows/` that has `workflow_dispatch:` enabled, with a `▶ Run` button per workflow. Plus a `📜 View runs & logs` link that switches to the Workflows main-panel tab (no trigger).
2. **Main-panel `Workflows` tab** — third tab next to Output / Preview, shown only when the active project has `stack === 'python'`. Two regions:
   - **Recent runs** — last 10 runs across all workflows. Status icon + workflow name + relative time + duration + run number. Click a row to load that run's log.
   - **Selected run log** — below the runs list. Whole log fetched via `gh run view <id> --log`. Static (no streaming).
3. **Mission Control card** — Python card gets a small `▶ Run now` button below the existing rows. Click triggers BOTH workflows sequentially (sync.yml first, then daily_compare.yml — per user's confirmed preference). Card refreshes after.
4. **Refresh model** — Manual `↻` button in the tab. Plus one auto-refresh ~2 seconds after a trigger, to surface the just-created run.
5. **Workflow discovery** — generalized: any project with `stack === 'python'` and any `.yml` under `.github/workflows/` that contains `workflow_dispatch:` is supported. esl-jira-notion-sync has 2 (`sync.yml`, `daily_compare.yml`), but the code is not hardcoded to those.

### Out of scope (deferred or never)

- Real-time log streaming (`gh run watch`). Logs are fetched once on click.
- Run cancel / retry buttons.
- Log search / filter / collapsible sections.
- Workflow YAML editing in the UI (continue via Claude prompt bar).
- Forge deploy automation.
- Production environment Forge deploy.
- Per-workflow input arguments (`gh workflow run` supports them via `-F key=value`; not needed for our two workflows which take no inputs).

---

## Architecture

### Process layout (unchanged)

Same Electron main + preload + renderer split as Phase 1. New code:

| File | Change |
|---|---|
| `workflows.js` | **new** — `listWorkflows(projectPath)` discovers dispatchable workflows; `listRuns(projectPath, limit)`; `runWorkflow(projectPath, file)`; `viewRunLog(projectPath, runId)`. Each function returns a uniform `{ ok, data, err }` shape. Pure Node module, no Electron deps. |
| `main.js` | Add IPC handlers: `workflows:list`, `workflows:runs`, `workflows:trigger`, `workflows:log`. Six lines each, wrapping `workflows.js`. |
| `preload.js` | Bridge the four new IPC channels on `window.api`: `workflowsList`, `workflowsRuns`, `workflowsTrigger`, `workflowsLog`. |
| `renderer/index.html` | Add `Workflows` tab button to the tab bar. Add `#workflowsPanel` div parallel to `#outputPanel` and `#previewPanel`. Add `▶ Run now` button template for the Mission Control card (Python-only). |
| `renderer/app.js` | New `renderWorkflows()` function. Tab-switch logic extended for `'workflows'`. Sidebar Workflows section render. Card-level `▶ Run now` button + handler. |
| `renderer/styles.css` | Run-row styles, log monospaced block, in-flight spinner on run buttons. |

`health.js` is **not** changed in this phase. The existing `findWorkflowWithSchedule` is duplicated in shape inside `workflows.js` because `workflows.js` needs every dispatchable workflow (not just scheduled ones), and the two concerns happen to overlap but aren't identical.

### Data flow — trigger

```
User clicks ▶ Run on a workflow row (sidebar OR card OR tab)
  → renderer calls window.api.workflowsTrigger(projectPath, workflowFile)
  → main.js IPC handler runs: gh workflow run <file>  (in projectPath as cwd)
  → on success, renderer schedules setTimeout(refreshWorkflowsTab, 2000)
  → user sees in_progress row appear in the tab list
```

### Data flow — log view

```
User clicks a run row in Workflows tab
  → renderer calls window.api.workflowsLog(projectPath, runId)
  → main.js IPC handler runs: gh run view <runId> --log
  → returns full log as text (could be 10s of KB)
  → renderer renders inside <pre> below the runs list
```

---

## Data model

### `workflows.js` function contracts

```js
// All return { ok: boolean, data | err }

// listWorkflows: discovers .github/workflows/*.yml with workflow_dispatch trigger
// Returns: { ok: true, data: [{ file, name, hasSchedule }] }
//   file = filename only (e.g. 'sync.yml')
//   name = workflow `name:` field, or filename if missing
//   hasSchedule = true if `schedule:` appears in the YAML
listWorkflows(projectPath)

// listRuns: returns last `limit` runs (default 10) across all workflows
// Returns: { ok: true, data: [{ id, workflowName, displayTitle, status, conclusion, createdAt, durationSec }] }
//   gh CLI: gh run list --limit=N --json status,conclusion,createdAt,databaseId,workflowName,displayTitle,updatedAt
//   durationSec is computed (updatedAt - createdAt for completed; null for in_progress)
listRuns(projectPath, limit = 10)

// runWorkflow: triggers via workflow_dispatch
// Returns: { ok: true } or { ok: false, err: '<message>' }
//   gh CLI: gh workflow run <file>  (gh exits non-zero on auth/no-dispatch error)
runWorkflow(projectPath, workflowFile)

// viewRunLog: full log of a run as text
// Returns: { ok: true, data: <string> } or { ok: false, err }
//   gh CLI: gh run view <id> --log
viewRunLog(projectPath, runId)
```

### Sidebar Workflows section markup (renderer-side)

```html
<div class="sidebar-section" id="workflowsSection" style="display:none">
  <div class="section-label">Workflows</div>
  <div id="workflowsList"></div>   <!-- one button per workflow -->
  <button class="workflows-tab-link" id="workflowsTabLink">📜 View runs & logs</button>
</div>
```

`workflowsList` is populated per project (only for `stack === 'python'`). Each button has `data-workflow-file="sync.yml"` and an inline status indicator (`▶` → `…` while in flight → back to `▶`).

### Workflows tab markup (main panel)

```html
<div class="workflows-panel" id="workflowsPanel">
  <div class="workflows-header">
    <div class="workflows-title">Workflows</div>
    <button class="refresh-btn" id="workflowsRefreshBtn">↻ Refresh</button>
  </div>
  <div class="workflows-runs" id="workflowsRuns"></div>      <!-- recent runs list -->
  <div class="workflows-log-header" id="workflowsLogHeader" style="display:none"></div>
  <pre class="workflows-log" id="workflowsLog" style="display:none"></pre>
</div>
```

### Recent runs row format

`<div class="run-row" data-id="<id>">`:

```
[icon]  sync.yml   2h ago   1m 32s   #4231
```

- icon: ✅ (success) / ❌ (failure / cancelled / timed_out) / 🟡 (in_progress, queued) / ⚪ (skipped, neutral)
- workflowName from `displayTitle` or `workflowName` field
- relative time via existing `ago()` helper in health.js (exported already)
- duration: format as `Xs` / `Xm Ys` / `—` if in_progress
- `#<id>` is the runNumber (smaller, dim)
- click: load log into the `<pre>` below + scroll into view

### Card `▶ Run now` button (Phase 2 addition to Mission Control)

For cards whose card.stack === 'python', append a small button to the card body (after the 3 rows):

```html
<button class="mc-run-now" data-workflows="sync.yml,daily_compare.yml">▶ Run now</button>
```

Click triggers each workflow file in sequence (first one returns → second one is called). Button disabled + shows `…` until both complete. Card auto-refreshes after.

---

## UI behavior details

### Tab show/hide
The Workflows tab is shown only when activeProject.stack === 'python'. When a non-Python project is selected, the tab is hidden (not just disabled). `showView` already handles this kind of conditional UI; this is one more if-branch.

### Sidebar section show/hide
Same rule. `renderProjects` / `selectProject` extends to show/hide `#workflowsSection` based on stack.

### Mission Control card `▶ Run now`
Only on Python cards. Phase 1's `renderOverview` extended to inject this button when stack matches.

### Refresh behavior
Three triggers fetch the runs list:
1. First time the Workflows tab is shown for a project (lazy load).
2. Manual `↻ Refresh` button.
3. ~2 seconds after a workflow trigger completes successfully. (`setTimeout` based; not real-time.)

No background polling. The user understands runs may be stale until they click Refresh — consistent with Mission Control's design.

### Log viewing
Click a run row → log fetched and shown below. Log can be large (10-100 KB typical, sometimes more). Rendered inside a `<pre>` with `max-height: 50vh; overflow: auto;`. No syntax highlighting in Phase 2.

While the log fetch is in flight, the row shows `…` next to its icon and the log area says "Loading log…".

---

## Error handling

| Failure | UX |
|---|---|
| `gh` not installed | Show inline message in Workflows tab + sidebar section: "Install gh CLI: `brew install gh && gh auth login`". No buttons functional. Mission Control card's `▶ Run now` is hidden. |
| `gh` not authenticated | Same as above. The trigger button shows a one-line auth-error message inline. |
| `gh workflow run` fails (network, permission) | Button row shows `❌ trigger failed: <message>`. No state change. |
| `gh run list` fails | Tab shows error banner, refresh button still available. |
| `gh run view <id> --log` fails | Log area shows `❌ Failed to load log: <error>`. List remains usable. |
| Workflow has no `workflow_dispatch:` | Skipped during discovery (not listed). Empty list → "No dispatchable workflows in this project." |

All `gh` calls timeout-bounded at 30 seconds. Log fetches at 60 seconds.

---

## Testing

No automated test framework, consistent with the rest of gas-commander. Manual verification matrix (executed at the end of Phase 2):

1. **`gh` not installed** — uninstall gh briefly (or rename binary), reload app, open Python project → confirm sidebar + tab show install instructions. Re-install.
2. **List workflows** — confirm `sync.yml` and `daily_compare.yml` appear in sidebar with `▶` buttons.
3. **Trigger sync.yml from sidebar** — click `▶`, see `…`, in ~5s see a new in_progress run appear in the tab list. Wait ~2 min for it to complete (sync.yml runtime). Refresh → status flips to ✅.
4. **Trigger via card `▶ Run now`** — sequential trigger of both workflows. Both runs appear, both complete.
5. **View log of a successful run** — click a ✅ row, log appears below within 5s.
6. **View log of a failed run** — click a ❌ row, log appears and shows the stack trace / error.
7. **Tab show/hide** — switch to esl-timeline (GAS), confirm Workflows tab disappears. Switch back, confirm it returns.
8. **No-workflow project** — register a Python project without scheduled workflows (or with workflows lacking `workflow_dispatch:`), confirm "No dispatchable workflows" message.

---

## Non-goals reminder

Phase 2 does **not** add real-time log streaming, run cancellation, workflow editing, or generalized "run any CLI command from gas-commander". The Workflows panel is a thin gh-CLI wrapper with one purpose: manually trigger and inspect GitHub Actions workflows on demand, without leaving the app.
