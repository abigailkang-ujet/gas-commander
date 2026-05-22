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
