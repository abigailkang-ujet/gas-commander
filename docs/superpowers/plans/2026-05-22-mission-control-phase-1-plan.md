# Mission Control — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `gas-commander` from a CLI wrapper into a portfolio-aware PM tool by adding a read-only Mission Control surface backed by a data-driven multi-stack project registry.

**Architecture:** Move project list out of `main.js` into a JSON file in the Electron `userData` dir. Add three pure modules at repo root — `stackDetect.js` (filesystem markers → stack tag), `registry.js` (load/save JSON), and `health.js` (per-stack shell-out probes returning a uniform `HealthCard` shape). Add new IPC handlers in `main.js`, bridged through `preload.js`. Renderer gains a `currentView` state, a new sidebar entry, an Overview grid, and an Add/Remove Project flow. No mutating actions in this phase.

**Tech Stack:** Electron 27.x, vanilla JS (no framework), `child_process.execSync` for shell-outs (`git`, `curl`, `gh`, `forge`). Same testing convention as the rest of the codebase: manual verification, no automated framework.

**Spec:** `docs/superpowers/specs/2026-05-22-mission-control-phase-1-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `projects.default.json` | new | Seed registry: 5 projects (esl-timeline, programs-dashboard, jpp, esl-sync, gas-commander). Shipped with the app. |
| `registry.js` | new | `loadRegistry(userDataDir)` / `saveRegistry(userDataDir, reg)` / `addProject(reg, p)` / `removeProject(reg, id)`. Pure file I/O, no Electron deps. |
| `stackDetect.js` | new | `detectStack(projectPath) → 'forge' \| 'gas' \| 'python' \| 'electron' \| 'unknown'`. Pure filesystem reads. |
| `health.js` | new | `probe(project) → HealthCard`. Dispatches by stack to `probeAppsScript` / `probeForge` / `probePython` / `probeElectron`. Shared helpers (`gitRows`, `ago`). |
| `main.js` | modify | Replace `PROJECT_REGISTRY` const with `loadRegistry(...)` call. Replace the existing `sync-projects` / `discover-projects` handlers with registry-aware versions. Add new IPC: `health:snapshot`, `registry:list`, `registry:add`, `registry:remove`, `registry:detectStack`. |
| `preload.js` | modify | Bridge the new IPC channels on `window.api` (existing bridge name — do not introduce `window.gc`). |
| `renderer/index.html` | modify | Add Overview sidebar entry, Overview view shell in main panel, Add Project modal. |
| `renderer/app.js` | modify | Add `currentView` state, sidebar Overview wiring, Overview render, Refresh button, Add Project modal flow, project removal via context menu. |
| `renderer/styles.css` | modify | Mission Control grid + card styles (Standard density per spec wireframe). |

---

## Task 1: Extract `PROJECT_REGISTRY` into a JSON file + load from `userData`

**Files:**
- Create: `projects.default.json`
- Create: `registry.js`
- Modify: `main.js` (replace const PROJECT_REGISTRY with registry load)

- [ ] **Step 1: Create `projects.default.json` with the 5 entries.**

```json
{
  "projects": [
    {
      "id": "esl-timeline",
      "name": "ESL Timeline",
      "color": "#3b82f6",
      "path": "",
      "repo": "https://github.com/abigailkang-ujet/esl-timeline.git",
      "stackOverride": null,
      "settings": { "liveUrl": null }
    },
    {
      "id": "Programs-dashboard",
      "name": "Programs Dashboard",
      "color": "#8b5cf6",
      "path": "",
      "repo": "https://github.com/abigailkang-ujet/Programs-dashboard.git",
      "stackOverride": null,
      "settings": { "liveUrl": null }
    },
    {
      "id": "jira-portfolio-plugin",
      "name": "JIRA Portfolio Plugin",
      "color": "#10b981",
      "path": "",
      "repo": "https://github.com/abigailkang-ujet/jira-portfolio-plugin.git",
      "stackOverride": null,
      "settings": { "liveUrl": null }
    },
    {
      "id": "esl-jira-notion-sync",
      "name": "ESL Sync",
      "color": "#f97316",
      "path": "",
      "repo": "https://github.com/abigailkang-ujet/esl-jira-notion-sync.git",
      "stackOverride": null,
      "settings": { "liveUrl": null }
    },
    {
      "id": "gas-commander",
      "name": "GAS Commander",
      "color": "#9aa4b8",
      "path": "",
      "repo": "https://github.com/abigailkang-ujet/gas-commander.git",
      "stackOverride": "self",
      "settings": { "liveUrl": null }
    }
  ]
}
```

`path: ""` resolves to `~/Desktop/<id>` at load time when blank.

- [ ] **Step 2: Create `registry.js`.**

```js
const fs = require('fs');
const path = require('path');
const os = require('os');

const REGISTRY_FILENAME = 'projects.json';

function defaultsPath() {
  return path.join(__dirname, 'projects.default.json');
}

function registryFilePath(userDataDir) {
  return path.join(userDataDir, REGISTRY_FILENAME);
}

function resolvePath(p, id) {
  if (p && p.trim()) return p;
  return path.join(os.homedir(), 'Desktop', id);
}

function loadRegistry(userDataDir) {
  const file = registryFilePath(userDataDir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    // Seed from defaults on first run
    raw = fs.readFileSync(defaultsPath(), 'utf8');
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(file, raw, 'utf8');
    } catch (_) {}
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    raw = fs.readFileSync(defaultsPath(), 'utf8');
    parsed = JSON.parse(raw);
    try { fs.writeFileSync(file, raw, 'utf8'); } catch (_) {}
  }
  parsed.projects = (parsed.projects || []).map(function(p) {
    return Object.assign({}, p, { path: resolvePath(p.path, p.id) });
  });
  return parsed;
}

function saveRegistry(userDataDir, reg) {
  const file = registryFilePath(userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2), 'utf8');
}

function addProject(reg, project) {
  const exists = (reg.projects || []).some(function(p) { return p.id === project.id; });
  if (exists) throw new Error('Project id already exists: ' + project.id);
  reg.projects.push(project);
  return reg;
}

function removeProject(reg, id) {
  reg.projects = (reg.projects || []).filter(function(p) { return p.id !== id; });
  return reg;
}

module.exports = { loadRegistry, saveRegistry, addProject, removeProject };
```

- [ ] **Step 3: Modify `main.js` — replace `PROJECT_REGISTRY` const.**

Remove lines 38–53 (the `const { execSync } = require('child_process');` import stays, the `PROJECT_REGISTRY` array is gone). Replace with:

```js
const { execSync } = require('child_process');
const registry = require('./registry');

let projectRegistry = null;

function getRegistry() {
  if (!projectRegistry) {
    projectRegistry = registry.loadRegistry(app.getPath('userData'));
  }
  return projectRegistry;
}
```

Then update every reference to `PROJECT_REGISTRY` in the file (`for (const c of PROJECT_REGISTRY)` in both `sync-projects` and `discover-projects` handlers) to `for (const c of getRegistry().projects)`. The fields used inside the loop (`c.dir`, `c.repo`, `c.name`, `c.color`) become `c.id`, `c.repo`, `c.name`, `c.color` — note **`dir` → `id`** is the rename; the rest are unchanged. Also update `path.join(getDesktop(), c.dir)` → `c.path` (the resolved path is now in the record).

- [ ] **Step 4: Launch app and verify.**

```bash
cd /Users/ab/Desktop/gas-commander
npm start
```

Expected: app opens, sidebar shows **5** projects (the original 2 plus jpp / esl-sync / gas-commander). Sync messages stream into Output for the 3 new ones on first launch (each will be cloned into `~/Desktop/<id>` if not present). No regression on the existing 2.

If the 3 new repos clone successfully, leave them. If any clone fails (e.g. private without cached creds), that's still acceptable — Mission Control will surface it as a red card later.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add projects.default.json registry.js main.js
git -C /Users/ab/Desktop/gas-commander commit -m "Move project registry into JSON + userData; add 3 missing projects"
```

---

## Task 2: Stack detection module

**Files:**
- Create: `stackDetect.js`

- [ ] **Step 1: Write `stackDetect.js`.**

```js
const fs = require('fs');
const path = require('path');

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function hasYmlSchedule(workflowsDir) {
  let entries;
  try { entries = fs.readdirSync(workflowsDir); } catch (_) { return false; }
  for (const f of entries) {
    if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
    if (readSafe(path.join(workflowsDir, f)).includes('schedule:')) return true;
  }
  return false;
}

function hasGsFile(projectPath) {
  let entries;
  try { entries = fs.readdirSync(projectPath); } catch (_) { return false; }
  return entries.some(function(f) { return f.endsWith('.gs'); });
}

function detectStack(projectPath) {
  // Forge first — its manifest.yml is distinctive
  const manifest = path.join(projectPath, 'manifest.yml');
  if (fileExists(manifest) && /^\s*modules:/m.test(readSafe(manifest))) return 'forge';

  // Apps Script
  if (fileExists(path.join(projectPath, '.clasp.json'))) return 'gas';
  if (fileExists(path.join(projectPath, 'appsscript.json'))) return 'gas';
  if (hasGsFile(projectPath)) return 'gas';

  // Python with scheduled GH Action
  if (fileExists(path.join(projectPath, 'requirements.txt'))
      && hasYmlSchedule(path.join(projectPath, '.github', 'workflows'))) return 'python';

  // Electron
  const pkg = path.join(projectPath, 'package.json');
  if (fileExists(pkg)) {
    try {
      const j = JSON.parse(readSafe(pkg));
      if ((j.dependencies && j.dependencies.electron)
          || (j.devDependencies && j.devDependencies.electron)) return 'electron';
    } catch (_) {}
  }

  return 'unknown';
}

module.exports = { detectStack };
```

- [ ] **Step 2: Smoke-test against the 5 real paths via a temp script.**

Create `/tmp/stack-smoke.js`:

```js
const { detectStack } = require('/Users/ab/Desktop/gas-commander/stackDetect');
const paths = [
  '/Users/ab/Desktop/esl-timeline',
  '/Users/ab/Desktop/Programs-dashboard',
  '/Users/ab/Desktop/jira-portfolio-plugin',
  '/Users/ab/Desktop/esl-jira-notion-sync',
  '/Users/ab/Desktop/gas-commander'
];
for (const p of paths) console.log(p.split('/').pop().padEnd(28), '→', detectStack(p));
```

Run: `node /tmp/stack-smoke.js`

Expected:
```
esl-timeline                 → gas
Programs-dashboard           → gas
jira-portfolio-plugin        → forge
esl-jira-notion-sync         → python
gas-commander                → electron
```

If any line disagrees, fix the heuristic in `stackDetect.js` and re-run until all five match. Delete `/tmp/stack-smoke.js` after.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add stackDetect.js
git -C /Users/ab/Desktop/gas-commander commit -m "Add stack auto-detection (gas/forge/python/electron)"
```

---

## Task 3: Health module — shared helpers + dispatcher

**Files:**
- Create: `health.js`

The probes share a `gitRows()` helper and a `ago()` formatter. Build these first, then a `probe()` dispatcher that returns a stub `HealthCard` for each stack. Per-stack logic comes in Tasks 4–7.

- [ ] **Step 1: Create `health.js` with shared helpers and dispatcher.**

```js
const { execSync } = require('child_process');
const { detectStack } = require('./stackDetect');

// HealthCard shape:
// { rows: [{ label, value, level }], dotLevel, errors }
// level: 'ok' | 'warn' | 'bad' | 'neutral'
// dotLevel: 'green' | 'yellow' | 'red' | 'grey'

function execCapture(cmd, opts) {
  try {
    return { ok: true, out: execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 5000 }, opts)).toString().trim() };
  } catch (err) {
    return { ok: false, err: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

function ago(isoOrSeconds) {
  let seconds;
  if (typeof isoOrSeconds === 'string') {
    const d = new Date(isoOrSeconds);
    if (isNaN(d.getTime())) return '—';
    seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  } else {
    seconds = isoOrSeconds;
  }
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function daysSinceCommit(projectPath) {
  const r = execCapture('git log -1 --format=%ct', { cwd: projectPath });
  if (!r.ok) return null;
  const ts = parseInt(r.out, 10);
  if (!ts) return null;
  return (Date.now() / 1000 - ts) / 86400;
}

function gitRows(projectPath) {
  const last = execCapture('git log -1 --format=%cr', { cwd: projectPath });
  const dirty = execCapture('git status --porcelain', { cwd: projectPath });
  const ahead = execCapture("git rev-list --count '@{u}..HEAD'", { cwd: projectPath });
  const behind = execCapture("git rev-list --count 'HEAD..@{u}'", { cwd: projectPath });
  const branch = execCapture('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });

  let gitValue;
  let gitLevel = 'ok';
  if (!last.ok || !branch.ok) {
    gitValue = 'no git';
    gitLevel = 'bad';
  } else if (dirty.ok && dirty.out) {
    gitValue = 'dirty';
    gitLevel = 'warn';
  } else if (ahead.ok && parseInt(ahead.out, 10) > 0) {
    gitValue = '+' + ahead.out + ' ahead';
    gitLevel = 'warn';
  } else if (behind.ok && parseInt(behind.out, 10) > 0) {
    gitValue = behind.out + ' behind';
    gitLevel = 'warn';
  } else {
    gitValue = 'clean · ' + (branch.out || 'main');
    gitLevel = 'ok';
  }

  return {
    lastCommit: { label: 'Last commit', value: last.ok ? last.out : '—', level: last.ok ? 'ok' : 'bad' },
    git: { label: 'Git', value: gitValue, level: gitLevel }
  };
}

function combineDot(rows, opts) {
  opts = opts || {};
  if (opts.forceNeutral) return 'grey';
  let level = 'ok';
  for (const r of rows) {
    if (r.level === 'bad') return 'red';
    if (r.level === 'warn') level = 'warn';
  }
  return level === 'warn' ? 'yellow' : 'green';
}

// Stub probes — Tasks 4–7 fill these in.
function probeAppsScript(project)  { return { rows: [{ label: 'Live URL', value: 'TODO', level: 'neutral' }, gitRows(project.path).lastCommit, gitRows(project.path).git], dotLevel: 'grey', errors: [] }; }
function probeForge(project)       { return { rows: [{ label: 'Install', value: 'TODO', level: 'neutral' }, gitRows(project.path).lastCommit, gitRows(project.path).git], dotLevel: 'grey', errors: [] }; }
function probePython(project)      { return { rows: [{ label: 'Last cron', value: 'TODO', level: 'neutral' }, { label: 'Next run', value: 'TODO', level: 'neutral' }, gitRows(project.path).git], dotLevel: 'grey', errors: [] }; }
function probeElectron(project)    {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Type', value: 'Electron', level: 'neutral' }, g.lastCommit, g.git], dotLevel: 'grey', errors: [] };
}
function probeUnknown(project)     {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Stack', value: 'unknown', level: 'warn' }, g.lastCommit, g.git], dotLevel: 'grey', errors: [] };
}

function probe(project) {
  const stack = project.stackOverride === 'self' ? 'self'
    : project.stackOverride || detectStack(project.path);
  switch (stack) {
    case 'gas':     return probeAppsScript(project);
    case 'forge':   return probeForge(project);
    case 'python':  return probePython(project);
    case 'electron':return probeElectron(project);
    case 'self':    return probeElectron(project);  // same probe, grey-locked downstream
    default:        return probeUnknown(project);
  }
}

module.exports = { probe, gitRows, ago, execCapture, daysSinceCommit, combineDot };
```

- [ ] **Step 2: Quick smoke from a temp script.**

`/tmp/health-smoke.js`:

```js
const { probe } = require('/Users/ab/Desktop/gas-commander/health');
const reg = require('/Users/ab/Desktop/gas-commander/registry').loadRegistry(require('os').homedir() + '/Library/Application Support/gas-commander');
for (const p of reg.projects) {
  console.log(p.id.padEnd(28), JSON.stringify(probe(p)));
}
```

Run: `node /tmp/health-smoke.js`

Expected: every project prints a HealthCard with three rows. `gitRows` columns should already be real values; stack-specific row 1 is `TODO` for now. Delete `/tmp/health-smoke.js` after.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add health.js
git -C /Users/ab/Desktop/gas-commander commit -m "Add health probe scaffolding + git helpers"
```

---

## Task 4: Apps Script probe — Live URL HEAD check + commit-age yellow rule

**Files:**
- Modify: `health.js`

- [ ] **Step 1: Replace `probeAppsScript` with the real implementation.**

```js
const fs = require('fs');
const path = require('path');

function resolveLiveUrl(project) {
  if (project.settings && project.settings.liveUrl) return project.settings.liveUrl;
  const claudeMd = path.join(project.path, 'CLAUDE.md');
  let content;
  try { content = fs.readFileSync(claudeMd, 'utf8'); } catch (_) { return null; }
  const m = content.match(/https:\/\/script\.google\.com\/.+?\/exec/);
  return m ? m[0] : null;
}

function probeAppsScript(project) {
  const errors = [];
  const liveUrl = resolveLiveUrl(project);

  // Row 1: Live URL HEAD ping
  let liveRow;
  if (!liveUrl) {
    liveRow = { label: 'Live URL', value: 'not configured', level: 'warn' };
  } else {
    const r = execCapture(
      'curl -sI -o /dev/null -w "%{http_code}" --max-time 5 ' + JSON.stringify(liveUrl),
      {}
    );
    if (!r.ok) {
      errors.push('curl failed: ' + r.err);
      liveRow = { label: 'Live URL', value: 'unreachable', level: 'bad' };
    } else {
      const code = parseInt(r.out, 10);
      const ok = code >= 200 && code < 400;
      liveRow = { label: 'Live URL', value: code + (ok ? ' OK' : ' ERR'), level: ok ? 'ok' : 'bad' };
    }
  }

  // Rows 2 & 3
  const g = gitRows(project.path);

  // Commit-age yellow rule
  const days = daysSinceCommit(project.path);
  if (days != null && days > 14 && g.lastCommit.level !== 'bad') {
    g.lastCommit.level = 'warn';
  }

  const rows = [liveRow, g.lastCommit, g.git];
  return { rows: rows, dotLevel: combineDot(rows), errors: errors };
}
```

(The `fs` / `path` requires go at the top of `health.js` next to the existing `child_process` require.)

- [ ] **Step 2: Smoke against esl-timeline + Programs-dashboard.**

```bash
node -e "const{probe}=require('/Users/ab/Desktop/gas-commander/health');const{loadRegistry}=require('/Users/ab/Desktop/gas-commander/registry');const reg=loadRegistry(require('os').homedir()+'/Library/Application Support/gas-commander');for(const p of reg.projects.filter(p=>['esl-timeline','Programs-dashboard'].includes(p.id))){console.log(p.id, JSON.stringify(probe(p), null, 2));}"
```

Expected: each prints `Live URL` row with `200 OK` (or `200 OK`-equivalent code), `Last commit` showing the same string `git log` gives, `Git` showing `clean · main` or `+N ahead`. `dotLevel` is `green` for both unless the live URL is unreachable or the repo is dirty.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add health.js
git -C /Users/ab/Desktop/gas-commander commit -m "Apps Script probe: live URL HEAD + commit-age threshold"
```

---

## Task 5: Forge probe — `forge install list` parsing

**Files:**
- Modify: `health.js`

- [ ] **Step 1: Replace `probeForge` with the real implementation.**

```js
const FORGE_BIN_CANDIDATES = [
  require('os').homedir() + '/.npm-global/bin/forge',
  '/opt/homebrew/bin/forge',
  '/usr/local/bin/forge'
];

function resolveForgeBin() {
  for (const candidate of FORGE_BIN_CANDIDATES) {
    try {
      require('fs').statSync(candidate);
      return candidate;
    } catch (_) {}
  }
  const which = execCapture('which forge', {});
  return which.ok ? which.out : null;
}

function probeForge(project) {
  const errors = [];
  const forgeBin = resolveForgeBin();

  let installRow;
  if (!forgeBin) {
    installRow = { label: 'Install', value: 'forge not found', level: 'bad' };
    errors.push('forge binary not in known paths');
  } else {
    const r = execCapture(JSON.stringify(forgeBin) + ' install list --product jira', { cwd: project.path });
    if (!r.ok) {
      errors.push('forge install list: ' + r.err);
      installRow = { label: 'Install', value: 'cli error', level: 'bad' };
    } else {
      // Output contains the installed app version among other text.
      // Match either "Version X.Y.Z" or a bare semver line.
      const m = r.out.match(/Version[^\n]*?(\d+\.\d+\.\d+)/i) || r.out.match(/\b(\d+\.\d+\.\d+)\b/);
      installRow = m
        ? { label: 'Install', value: 'v' + m[1], level: 'ok' }
        : { label: 'Install', value: 'no installs', level: 'warn' };
    }
  }

  const g = gitRows(project.path);
  const days = daysSinceCommit(project.path);
  if (days != null && days > 14 && g.lastCommit.level !== 'bad') g.lastCommit.level = 'warn';

  const rows = [installRow, g.lastCommit, g.git];
  return { rows: rows, dotLevel: combineDot(rows), errors: errors };
}
```

- [ ] **Step 2: Smoke against jpp.**

```bash
node -e "const{probe}=require('/Users/ab/Desktop/gas-commander/health');const{loadRegistry}=require('/Users/ab/Desktop/gas-commander/registry');const reg=loadRegistry(require('os').homedir()+'/Library/Application Support/gas-commander');console.log(JSON.stringify(probe(reg.projects.find(p=>p.id==='jira-portfolio-plugin')), null, 2));"
```

Expected: `Install` row shows `v5.13.0` (or whatever's currently installed), other rows show real git state, `dotLevel` green/yellow depending on git.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add health.js
git -C /Users/ab/Desktop/gas-commander commit -m "Forge probe: install version via forge install list"
```

---

## Task 6: Python probe — `gh run list` + cron parsing

**Files:**
- Modify: `health.js`

- [ ] **Step 1: Add a cron-next helper at the top of `health.js`.**

Cron parsing is deliberately minimal: only the five standard fields, no `@hourly` shortcuts. Anything fancier returns `'—'`.

```js
function findWorkflowWithSchedule(projectPath) {
  const dir = path.join(projectPath, '.github', 'workflows');
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return null; }
  for (const f of entries) {
    if (!/\.ya?ml$/.test(f)) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!content.includes('schedule:')) continue;
    const m = content.match(/cron:\s*['"]([^'"]+)['"]/);
    if (m) return { file: f, cron: m[1] };
  }
  return null;
}

function nextCronFire(cronExpr) {
  // Supports: "minute hour dom month dow" with values being '*', '*/N', or a literal integer.
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  function fits(val, field) {
    if (field === '*') return true;
    const stepMatch = field.match(/^\*\/(\d+)$/);
    if (stepMatch) return val % parseInt(stepMatch[1], 10) === 0;
    if (/^\d+$/.test(field)) return val === parseInt(field, 10);
    return false;
  }
  const now = new Date();
  // Look up to 24h ahead, minute by minute.
  for (let i = 1; i <= 24 * 60; i++) {
    const d = new Date(now.getTime() + i * 60000);
    if (fits(d.getUTCMinutes(), parts[0])
        && fits(d.getUTCHours(), parts[1])
        && fits(d.getUTCDate(), parts[2])
        && fits(d.getUTCMonth() + 1, parts[3])
        && fits(d.getUTCDay(), parts[4])) {
      return d;
    }
  }
  return null;
}

function formatCronNext(d) {
  if (!d) return '—';
  const minutes = Math.round((d.getTime() - Date.now()) / 60000);
  if (minutes < 60) return 'in ' + minutes + 'm';
  if (minutes < 24 * 60) return 'in ' + Math.round(minutes / 60) + 'h';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 2: Replace `probePython` with the real implementation.**

```js
function probePython(project) {
  const errors = [];
  const ghWhich = execCapture('which gh', {});
  let cronRow, nextRow;

  if (!ghWhich.ok) {
    cronRow = { label: 'Last cron', value: 'gh not installed', level: 'bad' };
    nextRow = { label: 'Next run', value: '—', level: 'neutral' };
    errors.push('gh CLI missing');
  } else {
    const wf = findWorkflowWithSchedule(project.path);
    if (!wf) {
      cronRow = { label: 'Last cron', value: 'no schedule', level: 'warn' };
      nextRow = { label: 'Next run', value: '—', level: 'neutral' };
    } else {
      const cmd = 'gh run list --workflow=' + JSON.stringify(wf.file)
                + ' --limit=1 --json status,conclusion,createdAt';
      const r = execCapture(cmd, { cwd: project.path });
      if (!r.ok) {
        cronRow = { label: 'Last cron', value: 'gh error', level: 'bad' };
        errors.push('gh run list: ' + r.err);
      } else {
        let arr;
        try { arr = JSON.parse(r.out); } catch (_) { arr = []; }
        const last = arr[0];
        if (!last) {
          cronRow = { label: 'Last cron', value: 'no runs', level: 'warn' };
        } else {
          const concl = last.conclusion || last.status;
          const isFail = concl === 'failure' || concl === 'cancelled' || concl === 'timed_out';
          cronRow = {
            label: 'Last cron',
            value: (isFail ? 'FAIL ' : 'OK ') + ago(last.createdAt),
            level: isFail ? 'bad' : 'ok'
          };
        }
      }
      nextRow = { label: 'Next run', value: formatCronNext(nextCronFire(wf.cron)), level: 'neutral' };
    }
  }

  const g = gitRows(project.path);
  const rows = [cronRow, nextRow, g.git];
  return { rows: rows, dotLevel: combineDot(rows), errors: errors };
}
```

- [ ] **Step 3: Smoke against esl-jira-notion-sync.**

Without `gh` installed (current state on this machine — Bash check in conversation showed `gh not found`):

Expected: `Last cron` row reads `gh not installed`, `dotLevel: red`, `errors: ['gh CLI missing']`. The other rows still populate.

```bash
node -e "const{probe}=require('/Users/ab/Desktop/gas-commander/health');const{loadRegistry}=require('/Users/ab/Desktop/gas-commander/registry');const reg=loadRegistry(require('os').homedir()+'/Library/Application Support/gas-commander');console.log(JSON.stringify(probe(reg.projects.find(p=>p.id==='esl-jira-notion-sync')), null, 2));"
```

- [ ] **Step 4: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add health.js
git -C /Users/ab/Desktop/gas-commander commit -m "Python probe: gh run list + cron parsing"
```

---

## Task 7: Electron self probe + grey-dot lock

**Files:**
- Modify: `health.js`

The current `probeElectron` already returns the right rows; only the dot needs to be locked grey for `self` entries.

- [ ] **Step 1: Update the `probe()` dispatcher to lock the dot.**

Replace the `case 'self':` line in `probe()`:

```js
case 'self': {
    const card = probeElectron(project);
    card.dotLevel = 'grey';
    return card;
  }
```

- [ ] **Step 2: Smoke against gas-commander self.**

```bash
node -e "const{probe}=require('/Users/ab/Desktop/gas-commander/health');const{loadRegistry}=require('/Users/ab/Desktop/gas-commander/registry');const reg=loadRegistry(require('os').homedir()+'/Library/Application Support/gas-commander');console.log(JSON.stringify(probe(reg.projects.find(p=>p.id==='gas-commander')), null, 2));"
```

Expected: rows `[Type=Electron, Last commit=..., Git=clean · main]`, `dotLevel: grey` even if git is dirty.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add health.js
git -C /Users/ab/Desktop/gas-commander commit -m "Lock gas-commander self dot to grey (informational only)"
```

---

## Task 8: New IPC handlers + preload bridge

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Add IPC handlers in `main.js`.**

Add these after the existing `discover-projects` handler:

```js
const stackDetect = require('./stackDetect');
const health = require('./health');

ipcMain.handle('registry:list', async () => {
  return getRegistry();
});

ipcMain.handle('registry:add', async (_, project) => {
  const reg = getRegistry();
  registry.addProject(reg, project);
  registry.saveRegistry(app.getPath('userData'), reg);
  return reg;
});

ipcMain.handle('registry:remove', async (_, id) => {
  const reg = getRegistry();
  registry.removeProject(reg, id);
  registry.saveRegistry(app.getPath('userData'), reg);
  return reg;
});

ipcMain.handle('registry:detectStack', async (_, projectPath) => {
  return stackDetect.detectStack(projectPath);
});

ipcMain.handle('health:snapshot', async () => {
  const reg = getRegistry();
  // Probes run in parallel; each is sync internally but cheap to Promise.all
  const cards = await Promise.all(reg.projects.map(function(p) {
    return new Promise(function(resolve) {
      try { resolve({ id: p.id, name: p.name, color: p.color, stack: p.stackOverride || stackDetect.detectStack(p.path), card: health.probe(p) }); }
      catch (err) { resolve({ id: p.id, name: p.name, color: p.color, stack: 'unknown', card: { rows: [], dotLevel: 'red', errors: [err.message] } }); }
    });
  }));
  return { refreshedAt: Date.now(), cards: cards };
});
```

Also add a directory-picker handler for the Add Project modal:

```js
const { dialog } = require('electron');

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
```

(`dialog` import goes near the top with the other electron imports.)

- [ ] **Step 2: Extend `preload.js`.**

Add inside the `contextBridge.exposeInMainWorld('api', { ... })` object, before the closing brace:

```js
  // Mission Control
  registryList: () => ipcRenderer.invoke('registry:list'),
  registryAdd: (project) => ipcRenderer.invoke('registry:add', project),
  registryRemove: (id) => ipcRenderer.invoke('registry:remove', id),
  registryDetectStack: (path) => ipcRenderer.invoke('registry:detectStack', path),
  healthSnapshot: () => ipcRenderer.invoke('health:snapshot'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
```

- [ ] **Step 3: Verify from DevTools.**

```bash
npm start
```

In DevTools console (View → Toggle Developer Tools):

```js
await window.api.healthSnapshot()
```

Expected: returns `{ refreshedAt: <ms>, cards: [ {id, name, color, stack, card: {rows, dotLevel, errors}}, ... ] }` with 5 entries.

```js
await window.api.registryDetectStack('/Users/ab/Desktop/esl-timeline')
```

Expected: `'gas'`.

- [ ] **Step 4: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add main.js preload.js
git -C /Users/ab/Desktop/gas-commander commit -m "Add IPC: registry CRUD, health:snapshot, dir picker"
```

---

## Task 9: Renderer — sidebar Overview entry + `currentView` state

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Update `renderer/index.html` sidebar markup.**

Replace the existing `<div class="sidebar">` block (lines 19–35) with:

```html
<div class="sidebar">
  <div class="sidebar-section" id="overviewSection">
    <button class="overview-btn active" id="overviewBtn">
      <span class="overview-icon">📊</span>
      <span>Overview</span>
    </button>
  </div>
  <div class="sidebar-section" id="projectsSection">
    <div class="section-label">Projects</div>
    <div id="projectList"></div>
    <button class="add-project-btn" id="addProjectBtn">+ Add Project</button>
  </div>
  <div class="sidebar-section" id="skillsSection" style="display:none">
    <div class="section-label">Skills</div>
    <div id="skillList"></div>
  </div>
  <div class="sidebar-section" id="deploySection" style="display:none">
    <div class="section-label">Deploy</div>
    <button class="deploy-btn" id="deployBtn">
      <span class="skill-icon">🚀</span>
      <span>Deploy to Apps Script</span>
    </button>
  </div>
</div>
```

And right after the closing `</div>` of the existing main panel's `<div class="output-panel"...>` block, add the Overview view shell:

```html
<!-- Overview -->
<div class="overview-panel active" id="overviewPanel">
  <div class="overview-header">
    <div class="overview-title">Mission Control</div>
    <div class="overview-meta">
      <span id="lastRefreshed">—</span>
      <button class="refresh-btn" id="refreshBtn">↻ Refresh</button>
    </div>
  </div>
  <div class="overview-grid" id="overviewGrid"></div>
</div>
```

- [ ] **Step 2: Add CSS for the Overview view + sidebar additions.**

Append to `renderer/styles.css`:

```css
.overview-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer;
}
.overview-btn:hover { background: rgba(255,255,255,0.04); }
.overview-btn.active {
  background: rgba(99,102,241,0.18);
  border-color: rgba(99,102,241,0.4);
  color: #c7d2fe;
}
.add-project-btn {
  display: block; width: 100%; margin-top: 6px;
  padding: 6px 10px; font-size: 11px;
  background: transparent; border: 1px dashed var(--border); border-radius: 4px;
  color: var(--text-dim); cursor: pointer;
}
.add-project-btn:hover { color: var(--text-primary); border-color: var(--text-dim); }

.overview-panel { display: none; flex-direction: column; flex: 1; padding: 16px; gap: 12px; overflow: auto; }
.overview-panel.active { display: flex; }
.overview-header { display: flex; align-items: center; justify-content: space-between; }
.overview-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.overview-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-dim); }
.refresh-btn {
  padding: 4px 10px; font-size: 11px;
  background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.4);
  border-radius: 4px; color: #c7d2fe; cursor: pointer;
}
.refresh-btn:disabled { opacity: 0.5; cursor: default; }
.overview-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.mc-card {
  background: var(--bg-elevated, #1a1f2e);
  border: 1px solid var(--border, #2a3142);
  border-radius: 8px; padding: 10px 12px; cursor: pointer;
}
.mc-card:hover { border-color: rgba(99,102,241,0.4); }
.mc-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.mc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mc-dot-green { background: #22c55e; }
.mc-dot-yellow { background: #eab308; }
.mc-dot-red { background: #ef4444; }
.mc-dot-grey { background: #6b7280; }
.mc-name { font-weight: 600; color: var(--text-primary); font-size: 13px; }
.mc-stack { margin-left: auto; font-size: 9px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.06em; }
.mc-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.mc-row span:first-child { color: var(--text-secondary); }
.mc-row span:last-child { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mc-row.bad span:last-child { color: #fca5a5; }
.mc-row.warn span:last-child { color: #fbbf77; }
.mc-row.ok span:last-child { color: #86efac; }
```

- [ ] **Step 3: Add `currentView` state and Overview show/hide logic in `renderer/app.js`.**

At the top of `app.js`, near the existing state declarations:

```js
var currentView = 'overview';  // 'overview' | 'project'
var lastSnapshot = null;
```

Add new DOM refs near the existing ones:

```js
var overviewBtn = document.getElementById('overviewBtn');
var overviewPanel = document.getElementById('overviewPanel');
var overviewGrid = document.getElementById('overviewGrid');
var refreshBtn = document.getElementById('refreshBtn');
var lastRefreshedLabel = document.getElementById('lastRefreshed');
var addProjectBtn = document.getElementById('addProjectBtn');
```

Add a `showView(view)` helper:

```js
function showView(view) {
  currentView = view;
  overviewBtn.classList.toggle('active', view === 'overview');
  overviewPanel.classList.toggle('active', view === 'overview');
  document.getElementById('outputPanel').classList.toggle('active', view === 'project');
  document.getElementById('previewPanel').classList.toggle('active', false);
  document.querySelector('.tab-bar').style.display = view === 'project' ? 'flex' : 'none';
  document.querySelector('.prompt-bar').style.display = view === 'project' ? 'flex' : 'none';
  if (view === 'overview') {
    document.querySelectorAll('.project-btn').forEach(function(b) { b.classList.remove('active'); });
    skillsSection.style.display = 'none';
    document.getElementById('deploySection').style.display = 'none';
    activeProject = null;
  }
}
```

Wire the button in `setupListeners()` (or `init()`):

```js
overviewBtn.addEventListener('click', function() {
  showView('overview');
});
```

Modify `selectProject(projectId)` to call `showView('project')` at the top.

Default the app to Overview at the end of `init()`:

```js
showView('overview');
```

- [ ] **Step 4: Manual verify.**

```bash
npm start
```

Expected:
- App opens in Overview mode — sidebar `📊 Overview` highlighted, main panel shows the Overview shell (header + empty grid).
- Click a project → switches to project mode (Skills/Deploy appear, Output panel visible, prompt bar back).
- Click `📊 Overview` → switches back.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add renderer/index.html renderer/app.js renderer/styles.css
git -C /Users/ab/Desktop/gas-commander commit -m "Renderer: add Overview sidebar entry + view state machine"
```

---

## Task 10: Renderer — Overview grid rendering + Refresh button

**Files:**
- Modify: `renderer/app.js`

- [ ] **Step 1: Add `renderOverview()` + `refreshOverview()` functions.**

```js
function dotClass(level) {
  return {
    green: 'mc-dot-green',
    yellow: 'mc-dot-yellow',
    red: 'mc-dot-red',
    grey: 'mc-dot-grey'
  }[level] || 'mc-dot-grey';
}

function rowClass(level) {
  if (level === 'bad') return 'bad';
  if (level === 'warn') return 'warn';
  if (level === 'ok') return 'ok';
  return '';
}

function renderOverview() {
  if (!lastSnapshot) {
    overviewGrid.innerHTML = '<div style="opacity:0.6;font-size:12px">Loading...</div>';
    return;
  }
  overviewGrid.innerHTML = lastSnapshot.cards.map(function(c) {
    var rows = c.card.rows.map(function(r) {
      return '<div class="mc-row ' + rowClass(r.level) + '">'
        + '<span>' + escapeHtml(r.label) + '</span>'
        + '<span>' + escapeHtml(r.value) + '</span>'
      + '</div>';
    }).join('');
    return '<div class="mc-card" data-id="' + c.id + '">'
      + '<div class="mc-head">'
        + '<span class="mc-dot ' + dotClass(c.card.dotLevel) + '"></span>'
        + '<span class="mc-name">' + escapeHtml(c.name) + '</span>'
        + '<span class="mc-stack">' + escapeHtml(c.stack) + '</span>'
      + '</div>'
      + rows
    + '</div>';
  }).join('');
  lastRefreshedLabel.textContent = 'Refreshed ' + formatAgo(lastSnapshot.refreshedAt) + ' ago';

  // Click-to-open binding
  overviewGrid.querySelectorAll('.mc-card').forEach(function(card) {
    card.addEventListener('click', function() { selectProjectFromOverview(card.dataset.id); });
  });
}

function formatAgo(ts) {
  var sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

function selectProjectFromOverview(id) {
  // selectProject expects the projects array to already be loaded.
  // If `projects` is empty (Overview-first flow), populate it from registry.
  if (!projects.length) {
    window.api.discoverProjects().then(function(arr) {
      projects = arr;
      renderProjects();
      selectProject(id);
    });
  } else {
    selectProject(id);
  }
}

async function refreshOverview() {
  refreshBtn.disabled = true;
  var prevText = refreshBtn.textContent;
  refreshBtn.textContent = '...';
  try {
    lastSnapshot = await window.api.healthSnapshot();
    renderOverview();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = prevText;
  }
}
```

- [ ] **Step 2: Wire the Refresh button + first-open fetch.**

In `setupListeners()`:

```js
refreshBtn.addEventListener('click', refreshOverview);
```

In `init()` — after `setupListeners()` and before `appendBubble('system', 'Ready...')`, kick off the first snapshot fetch in the background:

```js
refreshOverview();  // populate Overview on first open; doesn't block sync messages
```

- [ ] **Step 3: Manual verify.**

```bash
npm start
```

Expected:
- App opens in Overview, "Loading..." flashes briefly, then 5 cards render.
- Each card shows the right dot color (esl-sync should be **red** because `gh` is not installed; jpp **yellow** if local is ahead; the two GAS projects **green** if live URLs respond 200; gas-commander **grey**).
- `Refreshed Xs ago` updates after click.
- Clicking a card switches to that project's view (Skills, Output panel appear).

- [ ] **Step 4: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add renderer/app.js
git -C /Users/ab/Desktop/gas-commander commit -m "Renderer: Mission Control grid + Refresh button"
```

---

## Task 11: Add Project modal + Remove from registry

**Files:**
- Modify: `renderer/index.html` (add modal)
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add the Add Project modal markup.**

Inside `<div class="app">`, near the existing Deploy Modal:

```html
<div class="modal-overlay" id="addProjectModal" style="display:none">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-title">+ Add Project</div>
      <button class="modal-close" id="addProjectModalClose">&times;</button>
    </div>
    <div class="modal-body">
      <label class="ap-label">Path</label>
      <div class="ap-row">
        <input type="text" class="ap-input" id="apPath" placeholder="/Users/ab/Desktop/...">
        <button class="ap-browse" id="apBrowse">Browse…</button>
      </div>
      <label class="ap-label">Detected stack</label>
      <div class="ap-detected" id="apDetected">—</div>
      <label class="ap-label">Display name</label>
      <input type="text" class="ap-input" id="apName">
      <label class="ap-label">Color</label>
      <input type="color" class="ap-color" id="apColor" value="#9aa4b8">
      <div class="ap-actions">
        <button class="ap-cancel" id="apCancel">Cancel</button>
        <button class="ap-save" id="apSave" disabled>Save</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add modal styles to `renderer/styles.css`.**

```css
.ap-label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-dim); margin: 10px 0 4px; }
.ap-row { display:flex; gap:6px; }
.ap-input {
  flex:1; background: rgba(0,0,0,0.25); border: 1px solid var(--border);
  border-radius:4px; padding:6px 8px; font-size:12px; color:var(--text-primary);
}
.ap-browse, .ap-cancel, .ap-save {
  padding:6px 12px; font-size:12px; border-radius:4px; cursor:pointer; border:1px solid var(--border);
}
.ap-browse { background: rgba(255,255,255,0.05); color: var(--text-primary); }
.ap-cancel { background: transparent; color: var(--text-dim); }
.ap-save { background: rgba(99,102,241,0.4); border-color: rgba(99,102,241,0.6); color: #fff; }
.ap-save:disabled { opacity:0.4; cursor: default; }
.ap-detected { font-family:monospace; font-size:12px; padding: 6px 8px; background: rgba(0,0,0,0.25); border-radius:4px; color: var(--text-primary); }
.ap-color { height:32px; width:60px; border:1px solid var(--border); border-radius:4px; background:transparent; }
.ap-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
```

- [ ] **Step 3: Wire the modal in `renderer/app.js`.**

```js
var apModal = document.getElementById('addProjectModal');
var apPath = document.getElementById('apPath');
var apName = document.getElementById('apName');
var apColor = document.getElementById('apColor');
var apDetected = document.getElementById('apDetected');
var apSave = document.getElementById('apSave');
var apCancel = document.getElementById('apCancel');
var apBrowse = document.getElementById('apBrowse');
var apClose = document.getElementById('addProjectModalClose');

function openAddProject() {
  apPath.value = '';
  apName.value = '';
  apColor.value = '#9aa4b8';
  apDetected.textContent = '—';
  apSave.disabled = true;
  apModal.style.display = 'flex';
}
function closeAddProject() { apModal.style.display = 'none'; }

apBrowse.addEventListener('click', async function() {
  var p = await window.api.pickDirectory();
  if (!p) return;
  apPath.value = p;
  apPath.dispatchEvent(new Event('input'));
});

apPath.addEventListener('input', async function() {
  var p = apPath.value.trim();
  if (!p) { apDetected.textContent = '—'; apSave.disabled = true; return; }
  var stack = await window.api.registryDetectStack(p);
  apDetected.textContent = stack;
  if (!apName.value) apName.value = p.split('/').filter(Boolean).pop() || '';
  apSave.disabled = !apName.value.trim();
});

apName.addEventListener('input', function() {
  apSave.disabled = !apName.value.trim() || !apPath.value.trim();
});

apSave.addEventListener('click', async function() {
  var idBase = apName.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var newProject = {
    id: idBase,
    name: apName.value.trim(),
    color: apColor.value,
    path: apPath.value.trim(),
    repo: '',
    stackOverride: null,
    settings: { liveUrl: null }
  };
  try {
    await window.api.registryAdd(newProject);
    closeAddProject();
    refreshOverview();
  } catch (err) {
    alert('Could not add: ' + err.message);
  }
});

apCancel.addEventListener('click', closeAddProject);
apClose.addEventListener('click', closeAddProject);
addProjectBtn.addEventListener('click', openAddProject);
```

- [ ] **Step 4: Wire right-click → Remove from registry.**

In `renderOverview()`, after the existing click binding, add:

```js
overviewGrid.querySelectorAll('.mc-card').forEach(function(card) {
  card.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    var id = card.dataset.id;
    if (id === 'gas-commander') return;  // can't remove self
    if (!confirm('Remove "' + card.querySelector('.mc-name').textContent + '" from the registry? (The folder is not deleted.)')) return;
    window.api.registryRemove(id).then(refreshOverview);
  });
});
```

- [ ] **Step 5: Manual verify.**

```bash
npm start
```

Expected:
- Click `+ Add Project` → modal opens.
- Browse picks a folder (or paste a path) → stack detected and shown.
- Save → modal closes, new card appears in Overview.
- Right-click a non-self card → confirmation → card disappears from Overview after confirm.
- Right-click gas-commander card → no menu (the self entry refuses removal silently).

- [ ] **Step 6: Commit.**

```bash
git -C /Users/ab/Desktop/gas-commander add renderer/index.html renderer/app.js renderer/styles.css
git -C /Users/ab/Desktop/gas-commander commit -m "Add Project modal + right-click remove from Mission Control"
```

---

## Task 12: End-to-end verification matrix + final commit

**Files:** none modified

- [ ] **Step 1: Run through every spec test point manually.**

| # | Test | Expected | Pass? |
|---|---|---|---|
| 1 | Stack detection on all 5 real paths | esl-timeline=gas, programs-db=gas, jpp=forge, esl-sync=python, gas-commander=electron | |
| 2 | Live URL probe on esl-timeline | shows real HTTP code, green dot if 200 | |
| 3 | Live URL probe — temporarily break URL in CLAUDE.md, refresh | row goes red, dot goes red | |
| 4 | `forge install list` on jpp | shows v-string matching `forge install list --product jira` output | |
| 5 | Python probe without `gh` | red dot, value "gh not installed", `errors` array has entry | |
| 6 | Refresh button | disables during in-flight, label updates after | |
| 7 | First-open snapshot | populates without clicking Refresh | |
| 8 | Add Project happy path | new folder → detect stack → save → card appears | |
| 9 | Add Project with junk path | detect returns "unknown", Save still works, card appears with grey + warn row | |
| 10 | Remove from registry | card vanishes, `projects.json` no longer contains it | |
| 11 | Self entry | dot stays grey even when local repo is dirty | |
| 12 | Restart app | Overview re-fetches automatically on first open | |

Note any failures in a `docs/superpowers/plans/2026-05-22-mission-control-phase-1-verification.md` file with the actual vs expected; otherwise skip.

- [ ] **Step 2: Final commit (only if verification doc was written).**

```bash
git -C /Users/ab/Desktop/gas-commander add docs/superpowers/plans/2026-05-22-mission-control-phase-1-verification.md
git -C /Users/ab/Desktop/gas-commander commit -m "Phase 1 verification notes"
```

---

## Self-review notes (the plan author's own pass)

1. **Spec coverage:** every section of the spec maps to a task. Registry refactor → Task 1; stack detection → Task 2; per-stack probes → Tasks 4–7 with shared scaffolding in 3; IPC → Task 8; sidebar/view state → Task 9; grid + refresh → Task 10; add/remove → Task 11; verification matrix → Task 12.

2. **Placeholder scan:** the dispatcher in Task 3 has explicit `TODO` rows for stack-specific row 1 — these are replaced in Tasks 4–7 with full code. No bare TODOs remain after Task 7.

3. **Type consistency:** `HealthCard` shape (`{ rows: [{label, value, level}], dotLevel, errors }`) is used identically in `health.js`, `main.js` `health:snapshot` handler, and `renderOverview()`. `dotLevel` levels are `green|yellow|red|grey`; row `level`s are `ok|warn|bad|neutral`. Renderer's `dotClass()` / `rowClass()` match these vocabularies.

4. **Known mismatch with spec:** spec mentions `window.gc` as the bridge name. The codebase already uses `window.api`. The plan keeps `window.api` — see Task 8. If a future maintainer wants `window.gc`, that's an unrelated rename.

5. **`gh` prerequisite:** Phase 1 ships with `gh not installed` handling. Installing `gh` is not a plan task; it's an operator concern noted in the spec.
