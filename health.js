const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectStack } = require('./stackDetect');

const FORGE_BIN_CANDIDATES = [
  os.homedir() + '/.npm-global/bin/forge',
  '/opt/homebrew/bin/forge',
  '/usr/local/bin/forge'
];

function resolveForgeBin() {
  for (const candidate of FORGE_BIN_CANDIDATES) {
    try {
      fs.statSync(candidate);
      return candidate;
    } catch (_) {}
  }
  const which = execCapture('which forge', {});
  return which.ok ? which.out : null;
}

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
  // Take the LAST exec URL in the doc — CLAUDE.md often contains example/stale
  // URLs in code blocks above the current "Live URL: ..." line. Last match is
  // a robust heuristic without needing label-aware parsing.
  const all = [...content.matchAll(/https:\/\/script\.google\.com\/[^\s"'`)]+\/exec/g)];
  return all.length ? all[all.length - 1][0] : null;
}

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
  // Anything else (named months, ranges, lists) returns null.
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
  // GitHub Actions cron is UTC. Look up to 24h ahead, minute by minute.
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
      // Parse the "App version" column from the forge install list pipe-delimited table.
      const lines = r.out.split('\n');
      let appVersion = null;
      const headerIdx = lines.findIndex(l => l.includes('App version') && l.includes('│'));
      if (headerIdx >= 0) {
        const headerCols = lines[headerIdx].split('│').map(c => c.trim());
        const colIdx = headerCols.indexOf('App version');
        if (colIdx >= 0) {
          for (let i = headerIdx + 1; i < lines.length; i++) {
            const row = lines[i];
            if (!row.includes('│')) continue;
            const cols = row.split('│').map(c => c.trim());
            const candidate = cols[colIdx];
            // Skip separator rows like '│────│────│' which have empty trimmed cells
            if (candidate) { appVersion = candidate; break; }
          }
        }
      }
      installRow = appVersion
        ? { label: 'Install', value: 'v' + appVersion, level: 'ok' }
        : { label: 'Install', value: 'no installs', level: 'warn' };
    }
  }

  const g = gitRows(project.path);
  const days = daysSinceCommit(project.path);
  if (days != null && days > 14 && g.lastCommit.level !== 'bad') g.lastCommit.level = 'warn';

  const rows = [installRow, g.lastCommit, g.git];
  return { rows: rows, dotLevel: combineDot(rows), errors: errors };
}
function probePython(project) {
  const errors = [];
  const ghWhich = execCapture('which gh', {});
  // Initialize nextRow to a neutral fallback so the `gh run list` error branch
  // (which doesn't reassign nextRow) doesn't leak `undefined` into the rows array.
  let cronRow;
  let nextRow = { label: 'Next run', value: '—', level: 'neutral' };

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
