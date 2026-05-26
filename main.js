const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Project registry (source of truth: GitHub repos) ---
const { execSync } = require('child_process');
const registry = require('./registry');
const stackDetect = require('./stackDetect');
const health = require('./health');

let projectRegistry = null;

function getRegistry() {
  if (!projectRegistry) {
    projectRegistry = registry.loadRegistry(app.getPath('userData'));
  }
  return projectRegistry;
}

function getDesktop() {
  return path.join(require('os').homedir(), 'Desktop');
}

// Ensure a project is cloned and up-to-date. Returns sync status.
function syncProject(c) {
  const fullPath = c.path;
  const gitDir = path.join(fullPath, '.git');

  try {
    if (!fs.existsSync(gitDir)) {
      // Not cloned yet — clone it
      execSync('git clone "' + c.repo + '" "' + fullPath + '"', {
        cwd: getDesktop(),
        timeout: 60000,
        stdio: 'pipe'
      });
      return { status: 'cloned', message: 'Cloned from GitHub' };
    }

    // Already cloned — fetch and check
    execSync('git fetch origin', { cwd: fullPath, timeout: 30000, stdio: 'pipe' });

    // Check if behind
    const local = execSync('git rev-parse HEAD', { cwd: fullPath, stdio: 'pipe' }).toString().trim();
    const remote = execSync('git rev-parse origin/main', { cwd: fullPath, stdio: 'pipe' }).toString().trim();

    if (local === remote) {
      return { status: 'current', message: 'Up to date' };
    }

    // Check for local changes
    const dirty = execSync('git status --porcelain', { cwd: fullPath, stdio: 'pipe' }).toString().trim();
    if (dirty) {
      // Has local changes — stash, pull, pop
      execSync('git stash', { cwd: fullPath, timeout: 10000, stdio: 'pipe' });
      execSync('git pull origin main', { cwd: fullPath, timeout: 30000, stdio: 'pipe' });
      execSync('git stash pop', { cwd: fullPath, timeout: 10000, stdio: 'pipe' });
      return { status: 'updated', message: 'Pulled latest (local changes preserved)' };
    }

    // Clean — just pull
    execSync('git pull origin main', { cwd: fullPath, timeout: 30000, stdio: 'pipe' });
    return { status: 'updated', message: 'Pulled latest from GitHub' };

  } catch (err) {
    return { status: 'error', message: err.message.split('\n')[0] };
  }
}

// --- IPC Handlers ---

// Sync all projects (clone if missing, pull if behind)
ipcMain.handle('sync-projects', async () => {
  const results = [];
  for (const c of getRegistry().projects) {
    const syncResult = syncProject(c);
    results.push({ id: c.id, name: c.name, ...syncResult });
  }
  return results;
});

// Discover projects (after sync)
ipcMain.handle('discover-projects', async () => {
  const projects = [];

  for (const c of getRegistry().projects) {
    const fullPath = c.path;
    const claudeMd = path.join(fullPath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) continue;

    const skillsDir = path.join(fullPath, '.claude', 'commands');
    let skills = [];
    if (fs.existsSync(skillsDir)) {
      skills = fs.readdirSync(skillsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const name = f.replace('.md', '');
          const content = fs.readFileSync(path.join(skillsDir, f), 'utf8');
          const titleMatch = content.match(/^#\s+(.+)/m);
          return { id: name, label: titleMatch ? titleMatch[1] : name, file: f };
        });
    }

    const claudeContent = fs.readFileSync(claudeMd, 'utf8');
    const urlMatch = claudeContent.match(/https:\/\/script\.google\.com[^\s)]+\/exec/);

    // Get git info
    let gitInfo = '';
    try {
      const log = execSync('git log --oneline -1', { cwd: fullPath, stdio: 'pipe' }).toString().trim();
      gitInfo = log;
    } catch (_) {}

    projects.push({
      id: c.id,
      name: c.name,
      path: fullPath,
      color: c.color,
      liveUrl: urlMatch ? urlMatch[0] : null,
      skills,
      gitInfo
    });
  }
  return projects;
});

// --- Mission Control IPC ---

ipcMain.handle('registry:list', async () => {
  return getRegistry();
});

ipcMain.handle('registry:add', async (_, project) => {
  if (!project || typeof project.id !== 'string' || !project.id.trim()) {
    throw new Error('Project id is required');
  }
  if (/[\\/]|\.\./.test(project.id) || project.id.startsWith('.')) {
    throw new Error('Project id cannot contain path separators, "..", or start with "."');
  }
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
  const cards = await Promise.all(reg.projects.map(function(p) {
    return new Promise(function(resolve) {
      try {
        resolve({
          id: p.id,
          name: p.name,
          color: p.color,
          stack: p.stackOverride || stackDetect.detectStack(p.path),
          card: health.probe(p)
        });
      } catch (err) {
        resolve({
          id: p.id,
          name: p.name,
          color: p.color,
          stack: 'unknown',
          card: { rows: [], dotLevel: 'red', errors: [err.message] }
        });
      }
    });
  }));
  return { refreshedAt: Date.now(), cards: cards };
});

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// --- Claude Code execution ---
const activeProcesses = new Map();
// Track whether we have a previous session to continue
const sessionHistory = new Map(); // projectPath -> true if has prior session

function runClaude(event, projectPath, prompt, shouldContinue) {
  const existing = activeProcesses.get('current');
  if (existing) {
    existing.kill('SIGTERM');
    activeProcesses.delete('current');
  }

  // Write prompt to temp file (avoids shell escaping issues)
  const tmpFile = path.join(app.getPath('temp'), 'gas-commander-prompt.txt');
  fs.writeFileSync(tmpFile, prompt, 'utf8');

  // Build command
  const flags = [
    '--output-format stream-json',
    '--verbose',
    '--permission-mode acceptEdits'
  ];
  if (shouldContinue && sessionHistory.get(projectPath)) {
    flags.push('--continue');
  }

  const cmd = 'claude -p ' + flags.join(' ') + ' < "' + tmpFile + '"';

  const proc = spawn('bash', ['-lc', cmd], {
    cwd: projectPath,
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  activeProcesses.set('current', proc);

  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        event.sender.send('stream-event', evt);
      } catch (_) {
        // Plain text fallback
        event.sender.send('stream-event', { type: 'text', text: trimmed });
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    // Filter noise
    if (text && !text.includes('ExperimentalWarning')) {
      event.sender.send('stream-event', { type: 'stderr', text: text });
    }
  });

  proc.on('close', (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const evt = JSON.parse(buffer.trim());
        event.sender.send('stream-event', evt);
      } catch (_) {
        event.sender.send('stream-event', { type: 'text', text: buffer.trim() });
      }
    }
    activeProcesses.delete('current');
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // Mark that this project now has a session to continue
    if (code === 0) {
      sessionHistory.set(projectPath, true);
    }

    event.sender.send('session-end', { code });
  });
}

// Run skill (new session)
ipcMain.on('run-skill', (event, { projectPath, skillId, args }) => {
  const skillFile = path.join(projectPath, '.claude', 'commands', skillId + '.md');
  let skillContent;
  try {
    skillContent = fs.readFileSync(skillFile, 'utf8');
  } catch (err) {
    event.sender.send('stream-event', { type: 'stderr', text: 'Skill file not found: ' + skillFile });
    event.sender.send('session-end', { code: 1 });
    return;
  }

  let prompt = skillContent;
  if (args) {
    prompt = prompt.replace(/\$ARGUMENTS/g, args);
  }

  // Skills always start a new session
  sessionHistory.delete(projectPath);
  runClaude(event, projectPath, prompt, false);
});

// Run prompt (new or continue)
ipcMain.on('run-prompt', (event, { projectPath, prompt, continueSession }) => {
  runClaude(event, projectPath, prompt, continueSession);
});

// Stop
ipcMain.on('stop-process', () => {
  const proc = activeProcesses.get('current');
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete('current');
  }
});

// --- Deploy via clasp ---

// --- Deploy state: per-project record of last commit that was deployed via gas-commander.
// Stored in userData (not in the deployed project's repo) so we don't touch downstream .gitignores.
function deployStatePath() {
  return path.join(app.getPath('userData'), 'deploy-state.json');
}
function loadDeployState() {
  try { return JSON.parse(fs.readFileSync(deployStatePath(), 'utf8')); } catch (_) { return {}; }
}
function saveDeployState(state) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(deployStatePath(), JSON.stringify(state, null, 2), 'utf8');
}

// Check deploy readiness for a project
ipcMain.handle('deploy-check', async (_, { projectPath, projectId }) => {
  const result = {
    claspInstalled: false,
    claspLoggedIn: false,
    claspJsonExists: false,
    scriptId: null,
    headSha: null,
    headSubject: '',
    lastDeployedSha: null,
    lastDeployedAt: null,
    upToDate: false,
    commitsSinceDeploy: [],         // [{sha, subject}]
    filesChangedSinceDeploy: [],    // [path]
    hasUncommitted: false
  };

  // Check clasp installed
  try {
    execSync('which clasp', { stdio: 'pipe' });
    result.claspInstalled = true;
  } catch (_) {
    return result;
  }

  // Check clasp logged in
  const home = require('os').homedir();
  result.claspLoggedIn = fs.existsSync(path.join(home, '.clasprc.json'));

  // Check .clasp.json exists
  const claspJson = path.join(projectPath, '.clasp.json');
  if (fs.existsSync(claspJson)) {
    result.claspJsonExists = true;
    try {
      const config = JSON.parse(fs.readFileSync(claspJson, 'utf8'));
      result.scriptId = config.scriptId;
    } catch (_) {}
  }

  // HEAD commit info
  try {
    result.headSha = execSync('git rev-parse HEAD', { cwd: projectPath, stdio: 'pipe' }).toString().trim();
    result.headSubject = execSync('git log -1 --format=%s', { cwd: projectPath, stdio: 'pipe' }).toString().trim();
  } catch (_) {}

  // Last deployed commit (from userData record)
  const state = loadDeployState();
  if (projectId && state[projectId]) {
    result.lastDeployedSha = state[projectId].sha;
    result.lastDeployedAt = state[projectId].at;
    result.upToDate = result.headSha != null && result.lastDeployedSha === result.headSha;
  }

  // Commits + files changed since last deploy
  if (result.lastDeployedSha && !result.upToDate && result.headSha) {
    try {
      const log = execSync(
        'git log ' + result.lastDeployedSha + '..HEAD --format=%H%x09%s',
        { cwd: projectPath, stdio: 'pipe' }
      ).toString().trim();
      result.commitsSinceDeploy = log
        ? log.split('\n').map(function(line) {
            const tab = line.indexOf('\t');
            return tab < 0
              ? { sha: line, subject: '' }
              : { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
          })
        : [];
      const diffNames = execSync(
        'git diff --name-only ' + result.lastDeployedSha + ' HEAD',
        { cwd: projectPath, stdio: 'pipe' }
      ).toString().trim();
      result.filesChangedSinceDeploy = diffNames ? diffNames.split('\n') : [];
    } catch (_) {}
  }

  // Uncommitted working-tree warning (clasp only pushes committed state? No — clasp pushes
  // whatever is on disk, but since we deploy a tagged commit, uncommitted changes WILL be
  // pushed too. Surfacing this prevents the silent "I forgot to commit" footgun.)
  try {
    const dirty = execSync('git status --porcelain', { cwd: projectPath, stdio: 'pipe' }).toString().trim();
    result.hasUncommitted = !!dirty;
  } catch (_) {}

  return result;
});

// Setup clasp for a project (create .clasp.json)
ipcMain.handle('deploy-setup', async (_, { projectPath, scriptId }) => {
  try {
    const claspJson = path.join(projectPath, '.clasp.json');
    const config = { scriptId: scriptId, rootDir: '.' };
    fs.writeFileSync(claspJson, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Execute deploy: clasp push + create new version
ipcMain.handle('deploy-execute', async (event, { projectPath, projectId, description }) => {
  try {
    // Step 1: clasp push
    event.sender.send('deploy-progress', { step: 'push', status: 'running', message: 'Uploading files to Apps Script...' });
    execSync('clasp push --force', { cwd: projectPath, timeout: 30000, stdio: 'pipe' });
    event.sender.send('deploy-progress', { step: 'push', status: 'done', message: 'Files uploaded' });

    // Step 2: create new version
    event.sender.send('deploy-progress', { step: 'version', status: 'running', message: 'Creating new version...' });
    const versionDesc = description || 'Deploy via GAS Commander ' + new Date().toISOString().split('T')[0];
    const versionOutput = execSync('clasp version "' + versionDesc.replace(/"/g, '\\"') + '"', {
      cwd: projectPath, timeout: 30000, stdio: 'pipe'
    }).toString().trim();
    event.sender.send('deploy-progress', { step: 'version', status: 'done', message: versionOutput });

    // Step 3: deploy the new version
    event.sender.send('deploy-progress', { step: 'deploy', status: 'running', message: 'Deploying new version...' });
    const deployOutput = execSync('clasp deploy --description "' + versionDesc.replace(/"/g, '\\"') + '"', {
      cwd: projectPath, timeout: 30000, stdio: 'pipe'
    }).toString().trim();
    event.sender.send('deploy-progress', { step: 'deploy', status: 'done', message: deployOutput });

    // Step 4: record the deployed HEAD sha so the next deploy-check can show Case A/B correctly.
    if (projectId) {
      try {
        const sha = execSync('git rev-parse HEAD', { cwd: projectPath, stdio: 'pipe' }).toString().trim();
        const state = loadDeployState();
        state[projectId] = { sha: sha, at: new Date().toISOString() };
        saveDeployState(state);
      } catch (_) {}
    }

    return { success: true, message: 'Deploy complete!' };
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message;
    event.sender.send('deploy-progress', { step: 'error', status: 'error', message: msg });
    return { success: false, error: msg };
  }
});
