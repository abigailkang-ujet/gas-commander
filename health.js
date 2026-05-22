const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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

function ago(isoOrEpochSec) {
  let seconds;
  if (typeof isoOrEpochSec === 'string') {
    const d = new Date(isoOrEpochSec);
    if (isNaN(d.getTime())) return '—';
    seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  } else {
    // Treat number as Unix epoch seconds (matches `git log -1 --format=%ct` output).
    seconds = Math.floor(Date.now() / 1000) - isoOrEpochSec;
  }
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// Returns elapsed days since the last commit, or null if git is unavailable.
// Callers MUST null-check before comparing (e.g., `null > 14` is false and
// would silently misclassify a broken project as healthy).
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
  } else if (!ahead.ok || !behind.ok) {
    // ahead/behind fail when the current branch has no upstream tracking ref —
    // e.g., a never-pushed local branch. Distinct signal from clean.
    gitValue = 'local only · ' + (branch.out || 'main');
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
  if (!rows || rows.length === 0) return 'grey';
  let level = 'ok';
  for (const r of rows) {
    if (r.level === 'bad') return 'red';
    if (r.level === 'warn') level = 'warn';
  }
  return level === 'warn' ? 'yellow' : 'green';
}

function resolveLiveUrl(project) {
  if (project.settings && project.settings.liveUrl) return project.settings.liveUrl;
  const claudeMd = path.join(project.path, 'CLAUDE.md');
  let content;
  try { content = fs.readFileSync(claudeMd, 'utf8'); } catch (_) { return null; }
  const m = content.match(/https:\/\/script\.google\.com\/.+?\/exec/);
  return m ? m[0] : null;
}

// Stub probes — Tasks 5–7 fill these in.
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
function probeForge(project) {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Install', value: 'TODO', level: 'neutral' }, g.lastCommit, g.git], dotLevel: 'grey', errors: [] };
}
function probePython(project) {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Last cron', value: 'TODO', level: 'neutral' }, { label: 'Next run', value: 'TODO', level: 'neutral' }, g.git], dotLevel: 'grey', errors: [] };
}
function probeElectron(project) {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Type', value: 'Electron', level: 'neutral' }, g.lastCommit, g.git], dotLevel: 'grey', errors: [] };
}
function probeUnknown(project) {
  const g = gitRows(project.path);
  return { rows: [{ label: 'Stack', value: 'unknown', level: 'warn' }, g.lastCommit, g.git], dotLevel: 'grey', errors: [] };
}

function probe(project) {
  const stack = project.stackOverride === 'self' ? 'self'
    : project.stackOverride || detectStack(project.path);
  switch (stack) {
    case 'gas':      return probeAppsScript(project);
    case 'forge':    return probeForge(project);
    case 'python':   return probePython(project);
    case 'electron': return probeElectron(project);
    case 'self':     return probeElectron(project);  // same probe, grey-locked downstream
    default:         return probeUnknown(project);
  }
}

module.exports = { probe, gitRows, ago, execCapture, daysSinceCommit, combineDot };
