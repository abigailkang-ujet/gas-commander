# Phase 2 — Python Workflows Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to trigger `workflow_dispatch` GitHub Actions workflows on demand for Python-stack projects, and view their run history + logs, inside gas-commander.

**Architecture:** A new pure-Node module `workflows.js` wraps the `gh` CLI (run through a login shell so PATH resolves under GUI-launched Electron). Four IPC handlers in `main.js` expose it; `preload.js` bridges them onto `window.api`. The renderer gains a sidebar Workflows section, a third main-panel `Workflows` tab (runs list + log viewer), and a `▶ Run now` button on Python Mission Control cards. All three surfaces are shown only when the active project's `stack === 'python'`.

**Tech Stack:** Electron 33 (main + contextIsolated preload + vanilla-JS renderer), Node `child_process.execSync`, GitHub CLI (`gh` 2.92.0, authed with `workflow` scope).

**Testing note (project override):** gas-commander has **no automated test framework** — the spec's Testing section defines a manual verification matrix, and the project (instruction priority: project > skill) does not use TDD. This plan therefore replaces red-green TDD with: (a) Node smoke-checks for the pure-Node `workflows.js` (it can be exercised directly against the real esl repo), and (b) app-launch + the manual matrix (Task 12) for UI. Each task still ends with an explicit verification step and a commit.

**Key design decisions locked in during brainstorming:**
- The Mission Control card `▶ Run now` triggers **every discovered dispatchable workflow** for that project, in filename order. Because Task 0 deletes `daily_compare.yml`, `sync.yml` becomes the only one — so the card runs `sync.yml` only, with no filename hardcoding. This stays general for future Python projects.
- The sidebar + Workflows tab list **all** dispatchable workflows generically (anything under `.github/workflows/*.yml` containing `workflow_dispatch:`).
- `gh` is invoked via `bash -lc` (matching `main.js`'s `runClaude`) so `/opt/homebrew/bin` is on PATH — GUI-launched Electron on macOS does not inherit the interactive-shell PATH.

**Paths referenced:**
- gas-commander repo: `/Users/ab/Desktop/gas-commander`
- esl Python project (separate repo `esl-jira-notion-sync`): `/Users/ab/Desktop/jira-notion-sync`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `workflows.js` | gh-CLI wrapper: discover dispatchable workflows, list runs, trigger, fetch log, check gh availability. Pure Node, no Electron deps. | **new** |
| `main.js` | Register 5 IPC handlers wrapping `workflows.js`; add `stack` to `discover-projects` output; add `path` to `health:snapshot` cards. | modify |
| `preload.js` | Bridge 5 new IPC channels onto `window.api`. | modify |
| `renderer/index.html` | Add hidden `Workflows` tab button, `#workflowsPanel`, sidebar `#workflowsSection`. | modify |
| `renderer/styles.css` | Styles for run rows, log `<pre>`, sidebar workflow buttons, gh-install message, card run-now button. | modify |
| `renderer/app.js` | DOM refs; extend `switchTab`/`showView`/`selectProject` for the workflows tab + stack gating; `renderWorkflowsSection`, `triggerWorkflow`, `loadWorkflowRuns`, `loadRunLog`, card `▶ Run now`. | modify |
| `~/Desktop/jira-notion-sync/.github/workflows/daily_compare.yml` | Removed (no longer needed; makes `sync.yml` the sole dispatchable workflow). | **delete (other repo)** |

---

## Task 0: Delete `daily_compare.yml` from the esl repo

**Rationale:** User confirmed `daily_compare.yml` is no longer needed. Removing it makes `sync.yml` the only dispatchable (and only scheduled) workflow, so the generalized discovery code resolves the card/tab/sidebar to `sync.yml` with zero special-casing. This is a change in the **separate** `esl-jira-notion-sync` repo, not gas-commander. It is recoverable via git history.

**Files:**
- Delete: `/Users/ab/Desktop/jira-notion-sync/.github/workflows/daily_compare.yml`

- [ ] **Step 1: Confirm current workflow state**

Run:
```bash
ls -1 /Users/ab/Desktop/jira-notion-sync/.github/workflows
```
Expected: lists `daily_compare.yml` and `sync.yml`.

- [ ] **Step 2: Remove the file and commit in the esl repo**

```bash
cd /Users/ab/Desktop/jira-notion-sync
git rm .github/workflows/daily_compare.yml
git commit -m "Remove daily_compare workflow (superseded; sync.yml is the sole on-demand workflow)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push (the daily scheduled compare job stops after this)**

```bash
cd /Users/ab/Desktop/jira-notion-sync
git push
```
Expected: push succeeds. Verify only `sync.yml` remains:
```bash
ls -1 /Users/ab/Desktop/jira-notion-sync/.github/workflows
```
Expected: `sync.yml` only.

---

## Task 1: `workflows.js` — `checkGh` + `listWorkflows`

**Files:**
- Create: `/Users/ab/Desktop/gas-commander/workflows.js`

- [ ] **Step 1: Create `workflows.js` with the gh runner, `checkGh`, and `listWorkflows`**

```js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Run a `gh` command through a login shell so the user's PATH (notably
// /opt/homebrew/bin) is available. GUI-launched Electron on macOS does NOT
// inherit the interactive-shell PATH, so a bare execSync('gh ...') can fail
// with "command not found" even when gh is installed. main.js's runClaude
// uses the same `bash -lc` trick for exactly this reason.
// Returns { ok: true, out } or { ok: false, err }.
function gh(args, opts) {
  const cmd = 'gh ' + args;
  try {
    const out = execSync('bash -lc ' + JSON.stringify(cmd),
      Object.assign({ stdio: 'pipe', timeout: 30000 }, opts)).toString();
    return { ok: true, out: out };
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    return { ok: false, err: msg };
  }
}

// checkGh: is gh installed and authenticated?
// Returns { ok: true, data: { installed, authed } }.
function checkGh() {
  const ver = gh('--version', {});
  if (!ver.ok) return { ok: true, data: { installed: false, authed: false } };
  // `gh auth status` exits 0 when logged in, non-zero otherwise.
  const auth = gh('auth status', {});
  return { ok: true, data: { installed: true, authed: auth.ok } };
}

// listWorkflows: discover .github/workflows/*.yml that have a workflow_dispatch trigger.
// File-based (no gh needed). Returns { ok: true, data: [{ file, name, hasSchedule }] }
//   file = filename only (e.g. 'sync.yml')
//   name = workflow `name:` field, or filename if absent
//   hasSchedule = true if `schedule:` appears in the YAML
function listWorkflows(projectPath) {
  const dir = path.join(projectPath, '.github', 'workflows');
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return { ok: true, data: [] }; }
  const out = [];
  for (const f of entries.sort()) {
    if (!/\.ya?ml$/.test(f)) continue;
    let content;
    try { content = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
    if (!content.includes('workflow_dispatch:')) continue;
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    out.push({
      file: f,
      name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : f,
      hasSchedule: content.includes('schedule:')
    });
  }
  return { ok: true, data: out };
}

module.exports = { checkGh, listWorkflows };
```

- [ ] **Step 2: Smoke-test against the real esl repo**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node -e "const w=require('./workflows'); console.log('gh:', JSON.stringify(w.checkGh().data)); console.log('wf:', JSON.stringify(w.listWorkflows('/Users/ab/Desktop/jira-notion-sync').data));"
```
Expected (after Task 0): `gh: {"installed":true,"authed":true}` and `wf: [{"file":"sync.yml","name":"Jira → Notion Sync (ESL)","hasSchedule":true}]`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add workflows.js
git commit -m "Add workflows.js: gh runner, checkGh, listWorkflows"
```

---

## Task 2: `workflows.js` — `listRuns`, `runWorkflow`, `viewRunLog`

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/workflows.js`

- [ ] **Step 1: Add the three gh-backed functions and export them**

Add these three functions immediately **before** the `module.exports` line:

```js
// listRuns: last `limit` runs across all workflows.
// Returns { ok: true, data: [{ id, number, workflowName, status, conclusion, createdAt, durationSec }] }
//   durationSec = (updatedAt - createdAt) for completed runs, else null.
function listRuns(projectPath, limit) {
  limit = limit || 10;
  const fields = 'status,conclusion,createdAt,updatedAt,databaseId,number,workflowName,displayTitle';
  const r = gh('run list --limit=' + limit + ' --json ' + fields, { cwd: projectPath });
  if (!r.ok) return { ok: false, err: r.err };
  let arr;
  try { arr = JSON.parse(r.out); } catch (e) { return { ok: false, err: 'parse error: ' + e.message }; }
  const data = arr.map(function(run) {
    let durationSec = null;
    if (run.status === 'completed' && run.createdAt && run.updatedAt) {
      const ms = new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime();
      durationSec = Math.max(0, Math.round(ms / 1000));
    }
    return {
      id: run.databaseId,
      number: run.number,
      workflowName: run.displayTitle || run.workflowName || '',
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt,
      durationSec: durationSec
    };
  });
  return { ok: true, data: data };
}

// runWorkflow: trigger a workflow_dispatch run.
// Returns { ok: true } or { ok: false, err }.
function runWorkflow(projectPath, workflowFile) {
  const r = gh('workflow run ' + JSON.stringify(workflowFile), { cwd: projectPath });
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true };
}

// viewRunLog: full log of a run as text (can be 10s of KB → 60s timeout).
// Returns { ok: true, data: <string> } or { ok: false, err }.
function viewRunLog(projectPath, runId) {
  const r = gh('run view ' + JSON.stringify(String(runId)) + ' --log',
    { cwd: projectPath, timeout: 60000 });
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true, data: r.out };
}
```

- [ ] **Step 2: Replace the exports line**

Change:
```js
module.exports = { checkGh, listWorkflows };
```
to:
```js
module.exports = { checkGh, listWorkflows, listRuns, runWorkflow, viewRunLog };
```

- [ ] **Step 3: Smoke-test `listRuns` against the esl repo (read-only — does NOT trigger anything)**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node -e "const w=require('./workflows'); const r=w.listRuns('/Users/ab/Desktop/jira-notion-sync',3); console.log(JSON.stringify(r,null,2));"
```
Expected: `{ "ok": true, "data": [ ... ] }` with up to 3 run objects, each having `id`, `number`, `workflowName`, `status`, `conclusion`, `createdAt`, `durationSec`. (`runWorkflow`/`viewRunLog` are verified later via the app in Task 12 to avoid spurious triggers.)

- [ ] **Step 4: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add workflows.js
git commit -m "workflows.js: add listRuns, runWorkflow, viewRunLog"
```

---

## Task 3: `main.js` — IPC handlers + `stack` on discover + `path` on snapshot

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/main.js`

- [ ] **Step 1: Require `workflows.js`**

Find (near line 41):
```js
const health = require('./health');
```
Add immediately after it:
```js
const workflows = require('./workflows');
```

- [ ] **Step 2: Add `stack` to each project in `discover-projects`**

In the `discover-projects` handler, find the `projects.push({ ... })` block (around line 156):
```js
    projects.push({
      id: c.id,
      name: c.name,
      path: fullPath,
      color: c.color,
      liveUrl: liveUrl,
      skills: skills,
      gitInfo: gitInfo
    });
```
Replace with (adds `stack` so the renderer can gate Workflows UI; mirrors `health:snapshot`'s stack logic):
```js
    projects.push({
      id: c.id,
      name: c.name,
      path: fullPath,
      color: c.color,
      liveUrl: liveUrl,
      skills: skills,
      gitInfo: gitInfo,
      stack: c.stackOverride || stackDetect.detectStack(fullPath)
    });
```

- [ ] **Step 3: Add `path` to `health:snapshot` cards (so the card `▶ Run now` knows the project path)**

In the `health:snapshot` handler, the success `resolve({ ... })` block (around line 203):
```js
        resolve({
          id: p.id,
          name: p.name,
          color: p.color,
          stack: p.stackOverride || stackDetect.detectStack(p.path),
          card: health.probe(p)
        });
```
Replace with:
```js
        resolve({
          id: p.id,
          name: p.name,
          path: p.path,
          color: p.color,
          stack: p.stackOverride || stackDetect.detectStack(p.path),
          card: health.probe(p)
        });
```
And the error `resolve({ ... })` block immediately below it (around line 213):
```js
        resolve({
          id: p.id,
          name: p.name,
          color: p.color,
          stack: 'unknown',
          card: { rows: [], dotLevel: 'red', errors: [err.message] }
        });
```
Replace with:
```js
        resolve({
          id: p.id,
          name: p.name,
          path: p.path,
          color: p.color,
          stack: 'unknown',
          card: { rows: [], dotLevel: 'red', errors: [err.message] }
        });
```

- [ ] **Step 4: Add the 5 workflow IPC handlers**

Find the `dialog:pickDirectory` handler (around line 225) and add the following block immediately **after** its closing `});`:

```js
// --- Workflows IPC (Phase 2) ---
ipcMain.handle('workflows:check', async () => {
  return workflows.checkGh();
});

ipcMain.handle('workflows:list', async (_, projectPath) => {
  return workflows.listWorkflows(projectPath);
});

ipcMain.handle('workflows:runs', async (_, { projectPath, limit }) => {
  return workflows.listRuns(projectPath, limit);
});

ipcMain.handle('workflows:trigger', async (_, { projectPath, file }) => {
  return workflows.runWorkflow(projectPath, file);
});

ipcMain.handle('workflows:log', async (_, { projectPath, runId }) => {
  return workflows.viewRunLog(projectPath, runId);
});
```

- [ ] **Step 5: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node -e "require('./main.js')" 2>&1 | head -5 || true
```
Expected: it will error on Electron `app` APIs (that's fine — it means the file parsed and ran past `require`). It must NOT print a `SyntaxError`. If you see `SyntaxError`, fix it before continuing.

- [ ] **Step 6: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add main.js
git commit -m "main.js: workflows IPC handlers; stack on discover, path on snapshot"
```

---

## Task 4: `preload.js` — bridge the 5 channels

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/preload.js`

- [ ] **Step 1: Add the workflow bridge methods**

Find the Mission Control block at the end of the `exposeInMainWorld` object (around line 42):
```js
  // Mission Control
  registryList: () => ipcRenderer.invoke('registry:list'),
  registryAdd: (project) => ipcRenderer.invoke('registry:add', project),
  registryRemove: (id) => ipcRenderer.invoke('registry:remove', id),
  registryDetectStack: (path) => ipcRenderer.invoke('registry:detectStack', path),
  healthSnapshot: () => ipcRenderer.invoke('health:snapshot'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory')
});
```
Replace with (note the added comma after `pickDirectory`):
```js
  // Mission Control
  registryList: () => ipcRenderer.invoke('registry:list'),
  registryAdd: (project) => ipcRenderer.invoke('registry:add', project),
  registryRemove: (id) => ipcRenderer.invoke('registry:remove', id),
  registryDetectStack: (path) => ipcRenderer.invoke('registry:detectStack', path),
  healthSnapshot: () => ipcRenderer.invoke('health:snapshot'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  // Workflows (Phase 2)
  workflowsCheck: () => ipcRenderer.invoke('workflows:check'),
  workflowsList: (projectPath) => ipcRenderer.invoke('workflows:list', projectPath),
  workflowsRuns: (projectPath, limit) => ipcRenderer.invoke('workflows:runs', { projectPath, limit }),
  workflowsTrigger: (projectPath, file) => ipcRenderer.invoke('workflows:trigger', { projectPath, file }),
  workflowsLog: (projectPath, runId) => ipcRenderer.invoke('workflows:log', { projectPath, runId })
});
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node --check preload.js && echo "preload.js OK"
```
Expected: `preload.js OK`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add preload.js
git commit -m "preload.js: bridge workflows IPC channels"
```

---

## Task 5: `renderer/index.html` — tab button, panel, sidebar section

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/index.html`

- [ ] **Step 1: Add the hidden `Workflows` tab button**

Find the tab bar (around line 88):
```html
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="output">Output</button>
        <button class="tab-btn" data-tab="preview">Preview</button>
        <div class="tab-spacer"></div>
        <button class="stop-btn" id="stopBtn">Stop</button>
      </div>
```
Replace with:
```html
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="output">Output</button>
        <button class="tab-btn" data-tab="preview">Preview</button>
        <button class="tab-btn" data-tab="workflows" id="workflowsTabBtn" style="display:none">Workflows</button>
        <div class="tab-spacer"></div>
        <button class="stop-btn" id="stopBtn">Stop</button>
      </div>
```

- [ ] **Step 2: Add the `#workflowsPanel` div**

Find the Preview panel block (around line 105):
```html
      <!-- Preview -->
      <div class="preview-panel" id="previewPanel">
        <div class="preview-toolbar">
          <input type="text" class="preview-url" id="previewUrl" readonly>
          <button class="preview-refresh-btn" id="previewRefresh">Reload</button>
        </div>
        <webview id="previewWebview" class="preview-webview" src="about:blank"></webview>
      </div>
```
Add the following block immediately **after** that closing `</div>`:
```html
      <!-- Workflows -->
      <div class="workflows-panel" id="workflowsPanel">
        <div class="workflows-header">
          <div class="workflows-title">Workflows</div>
          <button class="refresh-btn" id="workflowsRefreshBtn">&#x21BB; Refresh</button>
        </div>
        <div class="workflows-runs" id="workflowsRuns"></div>
        <div class="workflows-log-header" id="workflowsLogHeader" style="display:none"></div>
        <pre class="workflows-log" id="workflowsLog" style="display:none"></pre>
      </div>
```

- [ ] **Step 3: Add the sidebar `#workflowsSection`**

Find the Deploy sidebar section (around line 35):
```html
      <div class="sidebar-section" id="deploySection" style="display:none">
        <div class="section-label">Deploy</div>
        <button class="deploy-btn" id="deployBtn">
          <span class="skill-icon">&#x1F680;</span>
          <span>Deploy to Apps Script</span>
        </button>
      </div>
```
Add the following block immediately **after** that closing `</div>`:
```html
      <div class="sidebar-section" id="workflowsSection" style="display:none">
        <div class="section-label">Workflows</div>
        <div id="workflowsList"></div>
        <button class="workflows-tab-link" id="workflowsTabLink">&#x1F4DC; View runs &amp; logs</button>
      </div>
```

- [ ] **Step 4: Verify markup loads (visual)**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
npm start
```
Expected: app launches with no console errors about missing elements. The Workflows tab is NOT visible yet (display:none, wired in Task 7+). Close the app.

- [ ] **Step 5: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/index.html
git commit -m "index.html: add Workflows tab, panel, and sidebar section"
```

---

## Task 6: `renderer/styles.css` — workflow styles

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/styles.css`

- [ ] **Step 1: Append the Phase 2 styles to the end of the file**

Append this block at the very end of `renderer/styles.css`:

```css
/* === Phase 2: Workflows === */

/* Sidebar workflow buttons */
#workflowsList { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.workflow-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-primary); font-size: 13px; cursor: pointer;
}
.workflow-btn:hover:not(:disabled) { background: rgba(255,255,255,0.04); }
.workflow-btn:disabled { opacity: 0.6; cursor: default; }
.wf-run-icon { width: 14px; display: inline-block; text-align: center; }
.workflows-tab-link {
  width: 100%; text-align: left; padding: 6px 10px;
  background: transparent; border: none; color: var(--text-dim);
  font-size: 12px; cursor: pointer;
}
.workflows-tab-link:hover { color: var(--text-primary); }
.wf-install { font-size: 12px; color: var(--text-muted); line-height: 1.6; }
.wf-install code { color: var(--accent-blue); }
.wf-empty { font-size: 12px; color: var(--text-dim); padding: 8px 2px; }
.wf-error { font-size: 12px; color: var(--accent-red); padding: 6px 2px; }

/* Workflows main panel */
.workflows-panel { display: none; flex-direction: column; height: 100%; overflow: auto; padding: 16px 20px; }
.workflows-panel.active { display: flex; }
.workflows-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.workflows-title { font-size: 15px; font-weight: 600; }
.workflows-runs { display: flex; flex-direction: column; gap: 2px; }

.run-row {
  display: grid;
  grid-template-columns: 24px 1fr auto auto auto;
  gap: 10px; align-items: center;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  font-size: 13px;
}
.run-row:hover { background: rgba(255,255,255,0.04); }
.run-icon { text-align: center; }
.run-name { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-time { color: var(--text-dim); font-size: 12px; }
.run-dur { color: var(--text-dim); font-size: 12px; }
.run-num { color: var(--text-dim); font-size: 11px; font-family: var(--font-mono); }

.workflows-log-header {
  margin-top: 16px; margin-bottom: 6px;
  font-size: 12px; color: var(--text-dim); font-weight: 600;
}
.workflows-log {
  background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; margin: 0;
  font-family: var(--font-mono); font-size: 11px; line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap; word-break: break-word;
  max-height: 50vh; overflow: auto;
}

/* Mission Control card run-now */
.mc-run-now {
  margin-top: 8px; width: 100%;
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-primary); font-size: 12px; cursor: pointer;
}
.mc-run-now:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
.mc-run-now:disabled { opacity: 0.7; cursor: default; }
```

- [ ] **Step 2: Verify the CSS uses only variables that exist**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
grep -oE "var\(--[a-z-]+\)" renderer/styles.css | sort -u
```
Expected: every variable listed (e.g. `var(--border)`, `var(--text-primary)`, `var(--text-dim)`, `var(--text-muted)`, `var(--accent-blue)`, `var(--accent-red)`, `var(--font-mono)`) must already be defined in the `:root` block at the top of the file. If `grep -n ':root' renderer/styles.css` shows the block, confirm each name appears there. (These are all used by existing Phase 1 code, so they should all exist.)

- [ ] **Step 3: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/styles.css
git commit -m "styles.css: Phase 2 workflow panel, run rows, log, card run-now"
```

---

## Task 7: `renderer/app.js` — DOM refs + tab/view wiring for Workflows

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/app.js`

- [ ] **Step 1: Add a module-level `ghStatus` cache near the top State block**

Find (around line 7):
```js
var lastSnapshot = null;
```
Add immediately after:
```js
var ghStatus = null;  // { installed, authed } — fetched once in init(), used to gate card Run now
```

- [ ] **Step 2: Extend `switchTab` to handle the Workflows tab**

Find the `switchTab` function (around line 471):
```js
function switchTab(tabName) {
  tabBtns.forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  outputPanel.style.display = tabName === 'output' ? 'block' : 'none';
  previewPanel.style.display = tabName === 'preview' ? 'flex' : 'none';
  previewPanel.classList.toggle('active', tabName === 'preview');

  if (tabName === 'preview' && activeProject && activeProject.liveUrl) {
    var wv = document.getElementById('previewWebview');
    if (!wv.src || wv.src === 'about:blank') {
      wv.src = activeProject.liveUrl;
    }
  }
}
```
Replace with:
```js
function switchTab(tabName) {
  tabBtns.forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  outputPanel.style.display = tabName === 'output' ? 'block' : 'none';
  previewPanel.style.display = tabName === 'preview' ? 'flex' : 'none';
  previewPanel.classList.toggle('active', tabName === 'preview');

  var wfPanel = document.getElementById('workflowsPanel');
  wfPanel.style.display = tabName === 'workflows' ? 'flex' : 'none';
  wfPanel.classList.toggle('active', tabName === 'workflows');

  if (tabName === 'preview' && activeProject && activeProject.liveUrl) {
    var wv = document.getElementById('previewWebview');
    if (!wv.src || wv.src === 'about:blank') {
      wv.src = activeProject.liveUrl;
    }
  }

  // Lazy-load runs the first time the Workflows tab is shown for this project.
  if (tabName === 'workflows') {
    loadWorkflowRuns();
  }
}
```

- [ ] **Step 3: Hide the Workflows panel when entering Overview**

Find, inside `showView`, the `if (view === 'overview') {` branch where panels are hidden (around line 215):
```js
    if (previewPanelEl) {
      previewPanelEl.classList.remove('active');
      previewPanelEl.style.display = 'none';
    }
    if (tabBar) tabBar.style.display = 'none';
```
Replace with:
```js
    if (previewPanelEl) {
      previewPanelEl.classList.remove('active');
      previewPanelEl.style.display = 'none';
    }
    var wfPanelEl = document.getElementById('workflowsPanel');
    if (wfPanelEl) {
      wfPanelEl.classList.remove('active');
      wfPanelEl.style.display = 'none';
    }
    if (tabBar) tabBar.style.display = 'none';
```

- [ ] **Step 4: Fetch gh status once during init (before first overview render)**

Find the end of `init` (around line 67):
```js
  appendBubble('system', 'Ready — 프로젝트를 선택하세요');
  showView('overview');
  refreshOverview();  // populate Overview asynchronously after sync messages settle
}
```
Replace with:
```js
  appendBubble('system', 'Ready — 프로젝트를 선택하세요');
  showView('overview');
  try {
    var ghRes = await window.api.workflowsCheck();
    ghStatus = ghRes && ghRes.ok ? ghRes.data : { installed: false, authed: false };
  } catch (_) {
    ghStatus = { installed: false, authed: false };
  }
  refreshOverview();  // populate Overview asynchronously after sync messages settle
}
```

- [ ] **Step 5: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node --check renderer/app.js && echo "app.js OK"
```
Expected: `app.js OK`. (`loadWorkflowRuns` is referenced but not yet defined — that's fine for `--check`, which only validates syntax. It is added in Task 9, before any UI path calls it.)

- [ ] **Step 6: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/app.js
git commit -m "app.js: wire Workflows tab into switchTab/showView; cache gh status"
```

---

## Task 8: `renderer/app.js` — stack gating + sidebar Workflows section

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/app.js`

- [ ] **Step 1: Gate the Workflows tab + sidebar section in `selectProject`**

Find the `selectProject` function (around line 248):
```js
function selectProject(projectId) {
  showView('project');
  activeProject = projects.find(function(p) { return p.id === projectId; });
  document.querySelectorAll('.project-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.id === projectId);
  });
  renderSkills();
  document.getElementById('deploySection').style.display = activeProject ? 'block' : 'none';
  hasSession = false;
  if (activeProject && activeProject.liveUrl) {
    previewUrl.value = activeProject.liveUrl;
  } else {
    previewUrl.value = '';
  }
  updatePromptPlaceholder();
}
```
Replace with:
```js
function selectProject(projectId) {
  showView('project');
  activeProject = projects.find(function(p) { return p.id === projectId; });
  document.querySelectorAll('.project-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.id === projectId);
  });
  renderSkills();
  document.getElementById('deploySection').style.display = activeProject ? 'block' : 'none';

  // Workflows UI is Python-only. Hide for everything else and, if the Workflows
  // tab was the active one, fall back to Output so the panel area isn't blank.
  var isPython = !!(activeProject && activeProject.stack === 'python');
  document.getElementById('workflowsTabBtn').style.display = isPython ? '' : 'none';
  if (!isPython) {
    var wfBtn = document.querySelector('.tab-btn[data-tab="workflows"]');
    if (wfBtn && wfBtn.classList.contains('active')) switchTab('output');
    document.getElementById('workflowsSection').style.display = 'none';
  }
  renderWorkflowsSection();

  hasSession = false;
  if (activeProject && activeProject.liveUrl) {
    previewUrl.value = activeProject.liveUrl;
  } else {
    previewUrl.value = '';
  }
  updatePromptPlaceholder();
}
```

- [ ] **Step 2: Add `renderWorkflowsSection` and `triggerWorkflow`**

Add these two functions immediately **after** the `selectProject` function (i.e. before `updatePromptPlaceholder`):

```js
// Populate the sidebar Workflows section for the active Python project.
async function renderWorkflowsSection() {
  var section = document.getElementById('workflowsSection');
  var listEl = document.getElementById('workflowsList');
  var tabLink = document.getElementById('workflowsTabLink');

  if (!activeProject || activeProject.stack !== 'python') {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  if (ghStatus && !ghStatus.installed) {
    listEl.innerHTML = '<div class="wf-install">Install gh CLI:<br><code>brew install gh &amp;&amp; gh auth login</code></div>';
    tabLink.style.display = 'none';
    return;
  }
  tabLink.style.display = '';

  var res = await window.api.workflowsList(activeProject.path);
  if (!res.ok || !res.data.length) {
    listEl.innerHTML = '<div class="wf-empty">No dispatchable workflows in this project.</div>';
    return;
  }
  listEl.innerHTML = res.data.map(function(w) {
    return '<button class="workflow-btn" data-workflow-file="' + escapeHtml(w.file) + '">'
      + '<span class="wf-run-icon">▶</span>'
      + '<span>' + escapeHtml(w.name) + '</span>'
    + '</button>';
  }).join('');
}

// Trigger one workflow from the sidebar. Shows in-flight state on the button,
// surfaces failures inline, and refreshes the runs tab ~2s after success.
async function triggerWorkflow(file, btnEl) {
  if (!activeProject) return;
  var iconEl = btnEl ? btnEl.querySelector('.wf-run-icon') : null;
  if (btnEl) btnEl.disabled = true;
  if (iconEl) iconEl.textContent = '…';

  var res = await window.api.workflowsTrigger(activeProject.path, file);

  if (iconEl) iconEl.textContent = '▶';
  if (btnEl) btnEl.disabled = false;

  if (!res.ok) {
    if (btnEl) {
      var err = document.createElement('div');
      err.className = 'wf-error';
      err.textContent = '❌ trigger failed: ' + (res.err || 'unknown');
      btnEl.insertAdjacentElement('afterend', err);
      setTimeout(function() { err.remove(); }, 6000);
    }
    return;
  }

  setTimeout(function() {
    if (currentView === 'project' && activeProject && activeProject.stack === 'python') {
      loadWorkflowRuns();
    }
  }, 2000);
}
```

- [ ] **Step 3: Wire the sidebar click handlers in `setupListeners`**

Find, inside `setupListeners`, the skill-list click handler (around line 497):
```js
  skillList.addEventListener('click', function(e) {
    var btn = e.target.closest('.skill-btn');
    if (btn) startSkill(btn.dataset.skill);
  });
```
Add immediately after it:
```js
  document.getElementById('workflowsList').addEventListener('click', function(e) {
    var btn = e.target.closest('.workflow-btn');
    if (btn) triggerWorkflow(btn.dataset.workflowFile, btn);
  });

  document.getElementById('workflowsTabLink').addEventListener('click', function() {
    switchTab('workflows');
  });

  document.getElementById('workflowsRefreshBtn').addEventListener('click', function() {
    loadWorkflowRuns();
  });
```

- [ ] **Step 4: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node --check renderer/app.js && echo "app.js OK"
```
Expected: `app.js OK`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/app.js
git commit -m "app.js: Python stack gating + sidebar Workflows section & triggers"
```

---

## Task 9: `renderer/app.js` — Workflows tab runs list + log viewer

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/app.js`

- [ ] **Step 1: Add the runs-list and log functions**

Add these four functions immediately **after** the `triggerWorkflow` function added in Task 8:

```js
// Icon for a run based on status/conclusion.
function runIcon(r) {
  if (r.status === 'in_progress' || r.status === 'queued') return '\u{1F7E1}'; // 🟡
  var c = r.conclusion;
  if (c === 'success') return '✅';                                        // ✅
  if (c === 'failure' || c === 'cancelled' || c === 'timed_out') return '❌'; // ❌
  return '⚪';                                                             // ⚪ (skipped/neutral)
}

// Duration formatter: "45s" / "1m 32s" / "—" for in-progress.
function formatDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return sec + 's';
  return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
}

// Load the recent runs list into the Workflows tab.
async function loadWorkflowRuns() {
  if (!activeProject || activeProject.stack !== 'python') return;
  var runsEl = document.getElementById('workflowsRuns');

  if (ghStatus && !ghStatus.installed) {
    runsEl.innerHTML = '<div class="wf-install">Install gh CLI:<br><code>brew install gh &amp;&amp; gh auth login</code></div>';
    return;
  }

  runsEl.innerHTML = '<div class="wf-empty">Loading runs…</div>';
  var res = await window.api.workflowsRuns(activeProject.path, 10);
  if (!res.ok) {
    runsEl.innerHTML = '<div class="wf-error">❌ ' + escapeHtml(res.err || 'Failed to load runs') + '</div>';
    return;
  }
  if (!res.data.length) {
    runsEl.innerHTML = '<div class="wf-empty">No runs yet.</div>';
    return;
  }
  runsEl.innerHTML = res.data.map(function(r) {
    var rel = r.createdAt ? formatAgo(new Date(r.createdAt).getTime()) + ' ago' : '—';
    return '<div class="run-row" data-id="' + escapeHtml(String(r.id)) + '">'
      + '<span class="run-icon">' + runIcon(r) + '</span>'
      + '<span class="run-name">' + escapeHtml(r.workflowName) + '</span>'
      + '<span class="run-time">' + escapeHtml(rel) + '</span>'
      + '<span class="run-dur">' + escapeHtml(formatDuration(r.durationSec)) + '</span>'
      + '<span class="run-num">#' + escapeHtml(String(r.number)) + '</span>'
    + '</div>';
  }).join('');
  runsEl.querySelectorAll('.run-row').forEach(function(row) {
    row.addEventListener('click', function() { loadRunLog(row.dataset.id, row); });
  });
}

// Fetch and render the full log for a run below the runs list.
async function loadRunLog(runId, rowEl) {
  if (!activeProject) return;
  var logEl = document.getElementById('workflowsLog');
  var hdrEl = document.getElementById('workflowsLogHeader');
  hdrEl.style.display = 'block';
  hdrEl.textContent = 'Loading log…';
  logEl.style.display = 'block';
  logEl.textContent = '';

  var iconEl = rowEl ? rowEl.querySelector('.run-icon') : null;
  var prevIcon = iconEl ? iconEl.textContent : '';
  if (iconEl) iconEl.textContent = '…';

  var res = await window.api.workflowsLog(activeProject.path, runId);

  if (iconEl) iconEl.textContent = prevIcon;

  if (!res.ok) {
    hdrEl.textContent = 'Run ' + runId;
    logEl.textContent = '❌ Failed to load log: ' + (res.err || 'unknown');
    return;
  }
  hdrEl.textContent = 'Log — run ' + runId;
  logEl.textContent = res.data || '(empty log)';
  hdrEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node --check renderer/app.js && echo "app.js OK"
```
Expected: `app.js OK`.

- [ ] **Step 3: Launch and verify the tab works end-to-end (read-only)**

```bash
cd /Users/ab/Desktop/gas-commander
npm start
```
In the app: select **ESL Sync** (Python) → the `Workflows` tab appears in the tab bar and a Workflows section appears in the sidebar with a `▶ Jira → Notion Sync (ESL)` button. Click the `Workflows` tab → recent runs load. Click a run row → its log appears in the `<pre>` below within a few seconds. Switch to a non-Python project (e.g. **ESL Timeline**) → the Workflows tab and sidebar section disappear. Close the app. (Triggering is verified in Task 12.)

- [ ] **Step 4: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/app.js
git commit -m "app.js: Workflows tab runs list + log viewer"
```

---

## Task 10: `renderer/app.js` — Mission Control card `▶ Run now`

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/renderer/app.js`

- [ ] **Step 1: Inject the run-now button into Python cards in `renderOverview`**

Find, inside `renderOverview`, the card template return (around line 115):
```js
    return '<div class="mc-card" data-id="' + escapeHtml(c.id) + '">'
      + '<div class="mc-head">'
        + '<span class="mc-dot ' + dotClass(c.card.dotLevel) + '"></span>'
        + '<span class="mc-name">' + escapeHtml(c.name) + '</span>'
        + '<span class="mc-stack">' + escapeHtml(c.stack) + '</span>'
      + '</div>'
      + rows
    + '</div>';
```
Replace with (adds the button for Python cards only, when gh is installed):
```js
    var runNow = (c.stack === 'python' && c.path && ghStatus && ghStatus.installed)
      ? '<button class="mc-run-now" data-path="' + escapeHtml(c.path) + '">▶ Run now</button>'
      : '';
    return '<div class="mc-card" data-id="' + escapeHtml(c.id) + '">'
      + '<div class="mc-head">'
        + '<span class="mc-dot ' + dotClass(c.card.dotLevel) + '"></span>'
        + '<span class="mc-name">' + escapeHtml(c.name) + '</span>'
        + '<span class="mc-stack">' + escapeHtml(c.stack) + '</span>'
      + '</div>'
      + rows
      + runNow
    + '</div>';
```

- [ ] **Step 2: Wire the run-now click handler in `renderOverview`**

Find, inside `renderOverview`, the right-click wiring block (around line 134):
```js
  // Wire right-click → remove from registry.
  overviewGrid.querySelectorAll('.mc-card').forEach(function(card) {
    card.addEventListener('contextmenu', function(e) {
```
Add the following block immediately **before** that comment line (so it sits between the click-to-open wiring and the contextmenu wiring):
```js
  // Wire card "▶ Run now". stopPropagation so it doesn't also open the project.
  overviewGrid.querySelectorAll('.mc-run-now').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      cardRunNow(btn);
    });
  });

```

- [ ] **Step 3: Add the `cardRunNow` function**

Add this function immediately **after** the `renderOverview` function (before `selectProjectFromOverview`):

```js
// Card "▶ Run now": trigger every dispatchable workflow for the project, in order.
// After daily_compare.yml was removed, that's sync.yml only — but this stays general.
async function cardRunNow(btn) {
  var projectPath = btn.dataset.path;
  if (!projectPath) return;
  btn.disabled = true;
  var prev = btn.textContent;
  btn.textContent = '… running';

  var list = await window.api.workflowsList(projectPath);
  var files = (list && list.ok ? list.data : []).map(function(w) { return w.file; });

  var failed = null;
  for (var i = 0; i < files.length; i++) {
    var res = await window.api.workflowsTrigger(projectPath, files[i]);
    if (!res || !res.ok) { failed = (res && res.err) || 'trigger failed'; break; }
  }

  btn.textContent = failed ? '❌ ' + failed.slice(0, 24) : '✅ triggered';
  setTimeout(function() {
    btn.disabled = false;
    btn.textContent = prev;
    refreshOverview();
  }, 2000);
}
```

- [ ] **Step 4: Verify the file parses**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
node --check renderer/app.js && echo "app.js OK"
```
Expected: `app.js OK`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add renderer/app.js
git commit -m "app.js: Mission Control card Run now (triggers discovered workflows)"
```

---

## Task 11: README touch-up

**Files:**
- Modify: `/Users/ab/Desktop/gas-commander/README.md`

- [ ] **Step 1: Read the README to find the Phase status / features area**

Run:
```bash
cd /Users/ab/Desktop/gas-commander
grep -n -iE "phase|feature|deploy" README.md | head -20
```

- [ ] **Step 2: Add a Phase 2 line describing the Workflows panel**

In the section that lists shipped phases/features (identified in Step 1), add a bullet such as:
```markdown
- **Workflows (Phase 2)** — For Python-stack projects, trigger `workflow_dispatch` GitHub Actions on demand from the sidebar or a Mission Control `▶ Run now` button, and view recent runs + full logs in the Workflows tab. Requires `gh` CLI installed and authenticated (`brew install gh && gh auth login`).
```
Match the surrounding markdown style (heading level, bullet character) of the existing phase entries.

- [ ] **Step 3: Commit**

```bash
cd /Users/ab/Desktop/gas-commander
git add README.md
git commit -m "Docs: document Phase 2 Workflows panel"
```

---

## Task 12: Manual verification matrix

Execute the spec's verification matrix against the running app. This task has no code; it gates "Phase 2 complete". Launch with `npm start` from `/Users/ab/Desktop/gas-commander`.

- [ ] **1. List workflows** — Select **ESL Sync**. Sidebar Workflows section shows a `▶ Jira → Notion Sync (ESL)` button (only `sync.yml` after Task 0). The `Workflows` tab button is visible.
- [ ] **2. Tab runs list** — Click the `Workflows` tab. Recent runs load (status icon + name + relative time + duration + `#number`).
- [ ] **3. View a successful run log** — Click a ✅ row. Log appears in the `<pre>` below within ~5s; the row icon briefly shows `…`.
- [ ] **4. View a failed run log** (if any ❌ exists) — Click it; log shows the error/stack trace.
- [ ] **5. Trigger from sidebar** — Click the `▶` sidebar button. Icon shows `…`, then returns to `▶`. Within ~2s an auto-refresh runs; within ~5–10s a new `in_progress` (🟡) row appears in the tab. (Optionally wait for completion, then click `↻ Refresh` → status flips to ✅.)
- [ ] **6. Trigger from Mission Control card** — Go to Overview. The **ESL Sync** card shows `▶ Run now`. Click it → button shows `… running` then `✅ triggered`, card refreshes. A new run appears in the Workflows tab.
- [ ] **7. Tab/section show-hide** — Select **ESL Timeline** (GAS). The Workflows tab and sidebar section are gone, and no card `▶ Run now` is shown for it. Re-select **ESL Sync** → both return.
- [ ] **8. gh-missing path** (optional, destructive to PATH) — Temporarily rename the gh binary (`sudo mv /opt/homebrew/bin/gh /opt/homebrew/bin/gh.bak`), restart the app, select ESL Sync → sidebar + tab show the `Install gh CLI: brew install gh && gh auth login` message and the card `▶ Run now` is hidden. Restore: `sudo mv /opt/homebrew/bin/gh.bak /opt/homebrew/bin/gh`.

- [ ] **Final: push the gas-commander branch**

```bash
cd /Users/ab/Desktop/gas-commander
git push
```

---

## Self-Review

**Spec coverage:**
- In-scope item 1 (Sidebar Workflows section, replaces Deploy for Python, `▶ Run` per workflow, `📜 View runs & logs` link) → Tasks 5, 8. (Note: the spec said the section "replaces" the Deploy section; this plan shows both for a Python project rather than hiding Deploy, since Deploy is harmless/no-op for Python and the existing code unconditionally shows `#deploySection` for any selected project. If strict replacement is wanted, add `document.getElementById('deploySection').style.display = isPython ? 'none' : 'block';` in `selectProject` — flagged for the executor.)
- In-scope item 2 (Workflows tab: recent runs + selected run log) → Tasks 5, 9.
- In-scope item 3 (card `▶ Run now`) → Task 10. Triggers all discovered workflows = `sync.yml` only after Task 0.
- In-scope item 4 (refresh model: manual `↻`, lazy first-load, ~2s post-trigger) → Tasks 7 (lazy), 8/10 (post-trigger), 8 (manual button wiring).
- In-scope item 5 (generalized discovery: any `.yml` with `workflow_dispatch:`) → Task 1 `listWorkflows`.
- Error handling table → Task 1 `checkGh` + the gh-missing branches in `renderWorkflowsSection`/`loadWorkflowRuns`, inline trigger-failure (Task 8), log-failure (Task 9), empty list (Tasks 8/9). Timeout bounds: 30s default / 60s log in Task 2.

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" placeholders; every code step shows complete code.

**Type consistency:** `workflows.js` returns `{ ok, data | err }` uniformly. `listRuns` fields (`id, number, workflowName, status, conclusion, createdAt, durationSec`) are produced in Task 2 and consumed identically in Task 9 (`runIcon`, `formatDuration`, row template). `checkGh` returns `{ ok, data: { installed, authed } }`, cached as `ghStatus` and read in Tasks 7/8/9/10 with the same `.installed`/`.authed` keys. IPC channel names match across `main.js` (Task 3), `preload.js` (Task 4), and `app.js` call sites. `data-workflow-file` (set in Task 8 sidebar template) is read via `btn.dataset.workflowFile` (same task handler).

**Deviations from the spec's architecture table (intentional, flagged):**
1. Added a 5th `workflows.js` function `checkGh` (spec listed 4) — required to satisfy the error-handling table's "show install instructions in sidebar + tab" proactively.
2. Added `stack` to `discover-projects` and `path` to `health:snapshot` cards in `main.js` — the renderer's `activeProject`/card objects lacked these, and the spec's stack-gating + card-path needs them. Minimal additive change.
3. Relative time uses the renderer's existing `formatAgo` (+ `' ago'`), not `health.js`'s `ago()` — the contextIsolated renderer cannot `require` `health.js`. Same output shape.
