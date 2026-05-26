// === State ===
var projects = [];
var activeProject = null;
var isRunning = false;
var hasSession = false; // true after first interaction completes (can continue)
var currentView = 'overview';  // 'overview' | 'project'
var lastSnapshot = null;

// === DOM refs ===
var projectList = document.getElementById('projectList');
var skillsSection = document.getElementById('skillsSection');
var overviewBtn = document.getElementById('overviewBtn');
var overviewPanel = document.getElementById('overviewPanel');
var overviewGrid = document.getElementById('overviewGrid');
var refreshBtn = document.getElementById('refreshBtn');
var lastRefreshedLabel = document.getElementById('lastRefreshed');
var skillList = document.getElementById('skillList');
var outputPanel = document.getElementById('outputPanel');
var previewPanel = document.getElementById('previewPanel');
var previewUrl = document.getElementById('previewUrl');
var previewRefresh = document.getElementById('previewRefresh');
var promptInput = document.getElementById('promptInput');
var promptSend = document.getElementById('promptSend');
var stopBtn = document.getElementById('stopBtn');
var tabBtns = document.querySelectorAll('.tab-btn');

var addProjectBtn = document.getElementById('addProjectBtn');
var apModal = document.getElementById('addProjectModal');
var apPath = document.getElementById('apPath');
var apName = document.getElementById('apName');
var apColor = document.getElementById('apColor');
var apDetected = document.getElementById('apDetected');
var apError = document.getElementById('apError');
var apSave = document.getElementById('apSave');
var apCancel = document.getElementById('apCancel');
var apBrowse = document.getElementById('apBrowse');
var apClose = document.getElementById('addProjectModalClose');

var SKILL_ICONS = {
  'deploy': '\u{1F680}',
  'fix-bug': '\u{1F41B}',
  'add-feature': '\u{2728}',
  'add-widget': '\u{1F4CA}',
  'sync-check': '\u{1F504}',
};

// === Init ===
async function init() {
  setupListeners();

  // Show sync status in output
  outputPanel.innerHTML = '';
  appendBubble('system', 'GitHub에서 최신 코드 동기화 중...');

  // Sync repos (clone if missing, pull if behind)
  var syncResults = await window.api.syncProjects();
  for (var i = 0; i < syncResults.length; i++) {
    var r = syncResults[i];
    var icon = r.status === 'error' ? '\u274C' : r.status === 'cloned' ? '\u{1F4E5}' : r.status === 'updated' ? '\u2B06' : '\u2705';
    appendBubble('system', icon + ' ' + r.name + ': ' + r.message);
  }

  // Now discover projects
  projects = await window.api.discoverProjects();
  renderProjects();

  appendBubble('system', 'Ready — 프로젝트를 선택하세요');
  showView('overview');
  refreshOverview();  // populate Overview asynchronously after sync messages settle
}

function renderProjects() {
  projectList.innerHTML = projects.map(function(p) {
    var commitInfo = p.gitInfo ? ' \u00B7 ' + escapeHtml(p.gitInfo) : '';
    return '<button class="project-btn" data-id="' + p.id + '">'
      + '<div class="project-dot" style="background:' + p.color + '"></div>'
      + '<div>'
        + '<div>' + escapeHtml(p.name) + '</div>'
        + '<div class="project-path">~/' + p.id + commitInfo + '</div>'
      + '</div>'
    + '</button>';
  }).join('');
}

function dotClass(level) {
  return ({ green: 'mc-dot-green', yellow: 'mc-dot-yellow', red: 'mc-dot-red', grey: 'mc-dot-grey' })[level] || 'mc-dot-grey';
}

function rowClass(level) {
  if (level === 'bad')  return 'bad';
  if (level === 'warn') return 'warn';
  if (level === 'ok')   return 'ok';
  return '';
}

function formatAgo(ts) {
  var sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60)   return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

function renderOverview() {
  if (!lastSnapshot) {
    overviewGrid.innerHTML = '<div style="opacity:0.6; font-size:12px; padding:20px">Loading…</div>';
    return;
  }
  overviewGrid.innerHTML = lastSnapshot.cards.map(function(c) {
    var rows = (c.card.rows || []).map(function(r) {
      return '<div class="mc-row ' + rowClass(r.level) + '">'
        + '<span>' + escapeHtml(r.label) + '</span>'
        + '<span>' + escapeHtml(r.value) + '</span>'
      + '</div>';
    }).join('');
    return '<div class="mc-card" data-id="' + escapeHtml(c.id) + '">'
      + '<div class="mc-head">'
        + '<span class="mc-dot ' + dotClass(c.card.dotLevel) + '"></span>'
        + '<span class="mc-name">' + escapeHtml(c.name) + '</span>'
        + '<span class="mc-stack">' + escapeHtml(c.stack) + '</span>'
      + '</div>'
      + rows
    + '</div>';
  }).join('');
  lastRefreshedLabel.textContent = 'Refreshed ' + formatAgo(lastSnapshot.refreshedAt) + ' ago';

  // Wire click-to-open. Bind to each .mc-card individually.
  overviewGrid.querySelectorAll('.mc-card').forEach(function(card) {
    card.addEventListener('click', function() {
      selectProjectFromOverview(card.dataset.id);
    });
  });

  // Wire right-click → remove from registry.
  overviewGrid.querySelectorAll('.mc-card').forEach(function(card) {
    card.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      var id = card.dataset.id;
      if (id === 'gas-commander') return;  // self entry can't be removed
      var name = card.querySelector('.mc-name') ? card.querySelector('.mc-name').textContent : id;
      if (!confirm('Remove "' + name + '" from the registry?\n\n(The folder on disk is NOT deleted.)')) return;
      window.api.registryRemove(id).then(function() {
        refreshSidebarAndOverview();
      });
    });
  });
}

function selectProjectFromOverview(id) {
  // If the projects[] array hasn't been populated yet (overview-first flow), discover first.
  if (!projects.length) {
    window.api.discoverProjects().then(function(arr) {
      if (Array.isArray(arr)) {
        projects = arr;
        renderProjects();
      }
      selectProject(id);
    });
  } else {
    selectProject(id);
  }
}

// Re-fetch both registry-derived views (sidebar list AND Mission Control grid).
// Called after registry mutations so both surfaces stay consistent.
async function refreshSidebarAndOverview() {
  try {
    var fresh = await window.api.discoverProjects();
    if (Array.isArray(fresh)) {
      projects = fresh;
      renderProjects();
    }
  } catch (_) {}
  await refreshOverview();
}

async function refreshOverview() {
  refreshBtn.disabled = true;
  var prevText = refreshBtn.textContent;
  refreshBtn.textContent = '…';
  try {
    lastSnapshot = await window.api.healthSnapshot();
    renderOverview();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = prevText;
  }
}

function renderSkills() {
  if (!activeProject) {
    skillsSection.style.display = 'none';
    return;
  }
  skillsSection.style.display = 'block';
  skillList.innerHTML = activeProject.skills.map(function(s) {
    var icon = SKILL_ICONS[s.id] || '\u{26A1}';
    return '<button class="skill-btn" data-skill="' + s.id + '">'
      + '<span class="skill-icon">' + icon + '</span>'
      + '<span>' + s.label + '</span>'
    + '</button>';
  }).join('');
}

function showView(view) {
  currentView = view;
  overviewBtn.classList.toggle('active', view === 'overview');
  overviewPanel.classList.toggle('active', view === 'overview');

  // The existing output/preview/prompt/tab UI is hidden when on Overview.
  var outputPanelEl = document.getElementById('outputPanel');
  var previewPanelEl = document.getElementById('previewPanel');
  var tabBar = document.querySelector('.tab-bar');
  var promptBar = document.querySelector('.prompt-bar');

  if (view === 'overview') {
    if (outputPanelEl) {
      outputPanelEl.classList.remove('active');
      // switchTab() writes inline display:block on outputPanel; clearing the class
      // alone isn't enough — force the inline style to hidden as well.
      outputPanelEl.style.display = 'none';
    }
    if (previewPanelEl) {
      previewPanelEl.classList.remove('active');
      previewPanelEl.style.display = 'none';
    }
    if (tabBar) tabBar.style.display = 'none';
    if (promptBar) promptBar.style.display = 'none';
    // Clear active project highlight + hide Skills/Deploy
    document.querySelectorAll('.project-btn').forEach(function(b) { b.classList.remove('active'); });
    skillsSection.style.display = 'none';
    document.getElementById('deploySection').style.display = 'none';
    activeProject = null;
  } else {
    // Clear the inline display:none we may have set, so switchTab's class-vs-inline
    // mechanism can take over again.
    if (outputPanelEl) outputPanelEl.style.display = '';
    if (previewPanelEl) previewPanelEl.style.display = '';
    // Restore the original "active" panel — default to Output if nothing is active
    if (outputPanelEl && !outputPanelEl.classList.contains('active') &&
        previewPanelEl && !previewPanelEl.classList.contains('active')) {
      outputPanelEl.classList.add('active');
    }
    if (tabBar) tabBar.style.display = '';
    if (promptBar) promptBar.style.display = '';
  }
}

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

function updatePromptPlaceholder() {
  if (!activeProject) {
    promptInput.placeholder = '프로젝트를 먼저 선택하세요';
  } else if (hasSession) {
    promptInput.placeholder = '이어서 대화하기... (이전 맥락이 유지됩니다)';
  } else {
    promptInput.placeholder = activeProject.name + '에 대해 요청하세요...';
  }
}

// === Actions ===
var currentSkill = null;

function startSkill(skillId) {
  if (!activeProject || isRunning) return;
  currentSkill = skillId;
  clearOutput();
  setRunning(true);
  hasSession = false;

  var skillLabel = activeProject.skills.find(function(s) { return s.id === skillId; });
  appendBubble('system', (skillLabel ? skillLabel.label : skillId) + ' 실행 중...');

  window.api.runSkill(activeProject.path, skillId, '');
}

function sendPrompt() {
  var text = promptInput.value.trim();
  if (!text || !activeProject || isRunning) return;

  promptInput.value = '';

  if (hasSession) {
    // Continue previous session
    appendBubble('user', text);
    setRunning(true);
    window.api.runPrompt(activeProject.path, text, true);
  } else {
    // New session
    clearOutput();
    appendBubble('user', text);
    setRunning(true);
    window.api.runPrompt(activeProject.path, text, false);
  }
}

// === Output rendering ===
var currentAssistantEl = null;

function clearOutput() {
  outputPanel.innerHTML = '';
  currentAssistantEl = null;
  switchTab('output');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendBubble(role, content) {
  currentAssistantEl = null;
  var bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + role;

  if (role !== 'system') {
    var label = document.createElement('div');
    label.className = 'bubble-label';
    label.textContent = role === 'assistant' ? 'Claude' : role === 'user' ? 'You' : 'Tool';
    bubble.appendChild(label);
  }

  var body = document.createElement('div');
  body.className = 'bubble-body';
  body.textContent = content;
  bubble.appendChild(body);
  outputPanel.appendChild(bubble);
  outputPanel.scrollTop = outputPanel.scrollHeight;

  if (role === 'assistant') {
    currentAssistantEl = body;
  }
  return body;
}

function appendToolBubble(label, content) {
  currentAssistantEl = null;
  var bubble = document.createElement('div');
  bubble.className = 'chat-bubble tool';

  var labelEl = document.createElement('div');
  labelEl.className = 'bubble-label';
  labelEl.textContent = label;
  bubble.appendChild(labelEl);

  var body = document.createElement('div');
  body.className = 'bubble-body';
  var text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  if (text.length > 600) {
    text = text.substring(0, 600) + '\n... (' + text.length + ' chars total)';
  }
  body.textContent = text;
  bubble.appendChild(body);

  outputPanel.appendChild(bubble);
  outputPanel.scrollTop = outputPanel.scrollHeight;
}

// === Stream event handler ===
function handleStreamEvent(evt) {
  if (!evt) return;

  switch (evt.type) {
    case 'system':
      if (evt.subtype === 'init') {
        appendBubble('system', 'Connected');
      }
      break;

    case 'assistant':
      handleAssistant(evt);
      break;

    case 'tool_use':
      var summary = evt.name || 'tool';
      if (evt.input) {
        if (evt.input.file_path) summary += '  ' + evt.input.file_path;
        else if (evt.input.command) summary += '  $ ' + evt.input.command.substring(0, 80);
        else if (evt.input.pattern) summary += '  "' + evt.input.pattern + '"';
      }
      appendToolBubble(summary, '');
      break;

    case 'tool_result':
      var content = evt.content || '';
      if (typeof content !== 'string') content = JSON.stringify(content);
      if (content.length > 0) {
        appendToolBubble('Result', content);
      }
      break;

    case 'result':
      currentAssistantEl = null;
      if (evt.subtype === 'error') {
        appendBubble('system', 'Error: ' + (evt.error || 'unknown'));
      } else if (evt.result) {
        // Final text result
        appendBubble('assistant', evt.result);
      }
      break;

    case 'text':
      // Raw text fallback
      if (evt.text) {
        appendBubble('assistant', evt.text);
      }
      break;

    case 'stderr':
      if (evt.text) {
        appendBubble('system', evt.text);
      }
      break;

    default:
      break;
  }
}

function handleAssistant(evt) {
  var msg = evt.message;
  if (!msg || !msg.content) return;

  for (var i = 0; i < msg.content.length; i++) {
    var block = msg.content[i];

    if (block.type === 'text' && block.text !== undefined) {
      if (!currentAssistantEl) {
        appendBubble('assistant', block.text);
      } else {
        currentAssistantEl.textContent = block.text;
        outputPanel.scrollTop = outputPanel.scrollHeight;
      }
    } else if (block.type === 'tool_use') {
      var summary = block.name || 'tool';
      if (block.input) {
        if (block.input.file_path) summary += '  ' + block.input.file_path;
        else if (block.input.command) summary += '  $ ' + (block.input.command || '').substring(0, 80);
        else if (block.input.pattern) summary += '  "' + block.input.pattern + '"';
      }
      appendToolBubble(summary, '');
    }
  }
}

// === UI state ===
function setRunning(running) {
  isRunning = running;
  stopBtn.classList.toggle('visible', running);
  promptSend.textContent = hasSession ? 'Reply' : 'Send';
  updatePromptPlaceholder();

  document.querySelectorAll('.skill-btn').forEach(function(btn) {
    btn.classList.toggle('running', running && btn.dataset.skill === currentSkill);
  });
}

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

// === Event listeners ===
function setupListeners() {
  overviewBtn.addEventListener('click', function() { showView('overview'); });
  refreshBtn.addEventListener('click', refreshOverview);

  projectList.addEventListener('click', function(e) {
    var btn = e.target.closest('.project-btn');
    if (btn) selectProject(btn.dataset.id);
  });

  skillList.addEventListener('click', function(e) {
    var btn = e.target.closest('.skill-btn');
    if (btn) startSkill(btn.dataset.skill);
  });

  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
  });

  promptInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  promptSend.addEventListener('click', sendPrompt);

  stopBtn.addEventListener('click', function() {
    window.api.stopProcess();
    appendBubble('system', 'Stopped');
    setRunning(false);
  });

  previewRefresh.addEventListener('click', function() {
    var wv = document.getElementById('previewWebview');
    if (activeProject && activeProject.liveUrl) {
      wv.src = activeProject.liveUrl;
    }
  });

  window.api.onStreamEvent(handleStreamEvent);

  window.api.onSessionEnd(function(data) {
    currentAssistantEl = null;
    setRunning(false);

    if (data.code === 0) {
      hasSession = true;
      appendBubble('system', 'Done — 이어서 대화할 수 있습니다');
    } else {
      appendBubble('system', 'Ended (code: ' + data.code + ')');
    }
    updatePromptPlaceholder();
  });

  // Add Project modal
  addProjectBtn.addEventListener('click', openAddProject);
  apCancel.addEventListener('click', closeAddProject);
  apClose.addEventListener('click', closeAddProject);
  apModal.addEventListener('click', function(e) {
    if (e.target === apModal) closeAddProject();
  });

  apBrowse.addEventListener('click', async function() {
    var picked = await window.api.pickDirectory();
    if (!picked) return;
    apPath.value = picked;
    detectAndUpdate();
  });

  apPath.addEventListener('input', detectAndUpdate);
  apName.addEventListener('input', updateApSaveDisabled);

  apSave.addEventListener('click', async function() {
    var id = deriveProjectId(apName.value);
    if (!id) {
      apError.textContent = 'Display name must produce a non-empty id (letters / digits / hyphens).';
      apError.style.display = 'block';
      return;
    }
    var newProject = {
      id: id,
      name: apName.value.trim(),
      color: apColor.value,
      path: apPath.value.trim(),
      repo: '',
      stackOverride: null,
      settings: { liveUrl: null }
    };
    apError.style.display = 'none';
    apSave.disabled = true;
    try {
      await window.api.registryAdd(newProject);
      closeAddProject();
      await refreshSidebarAndOverview();
    } catch (err) {
      apError.textContent = String(err && err.message || err) || 'Failed to add project';
      apError.style.display = 'block';
      apSave.disabled = false;
    }
  });

  // Deploy button
  document.getElementById('deployBtn').addEventListener('click', openDeployModal);
  document.getElementById('deployModalClose').addEventListener('click', closeDeployModal);
  document.getElementById('deployModal').addEventListener('click', function(e) {
    if (e.target === this) closeDeployModal();
  });

  // Deploy progress — replace running step when done
  window.api.onDeployProgress(function(data) {
    var container = document.getElementById('deployProgress');
    if (!container) return;

    // If a running step exists and this is done/error, replace it
    var runningEl = container.querySelector('[data-status="running"]');
    if (runningEl && data.status !== 'running') {
      var icon = data.status === 'done' ? '\u2705' : '\u274C';
      runningEl.innerHTML = '<span>' + icon + '</span> <span>' + escapeHtml(data.message) + '</span>';
      runningEl.dataset.status = data.status;
      return;
    }

    // Otherwise add new item
    var item = document.createElement('div');
    item.className = 'deploy-progress-item';
    item.dataset.status = data.status;
    if (data.status === 'running') {
      item.innerHTML = '<div class="spinner"></div> <span>' + escapeHtml(data.message) + '</span>';
    } else {
      var icon = data.status === 'done' ? '\u2705' : '\u274C';
      item.innerHTML = '<span>' + icon + '</span> <span>' + escapeHtml(data.message) + '</span>';
    }
    container.appendChild(item);
  });
}

// === Add Project Modal ===
function openAddProject() {
  apPath.value = '';
  apName.value = '';
  apColor.value = '#9aa4b8';
  apDetected.textContent = '—';
  apError.style.display = 'none';
  apError.textContent = '';
  apSave.disabled = true;
  apModal.style.display = 'flex';
}

function closeAddProject() {
  apModal.style.display = 'none';
}

function deriveProjectId(name) {
  return name.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function detectAndUpdate() {
  var p = apPath.value.trim();
  if (!p) { apDetected.textContent = '—'; apSave.disabled = true; return; }
  apDetected.textContent = '…';
  try {
    var stack = await window.api.registryDetectStack(p);
    apDetected.textContent = stack || 'unknown';
  } catch (_) {
    apDetected.textContent = 'unknown';
  }
  if (!apName.value.trim()) {
    var parts = p.split('/').filter(Boolean);
    apName.value = parts[parts.length - 1] || '';
  }
  updateApSaveDisabled();
}

function updateApSaveDisabled() {
  apSave.disabled = !(apName.value.trim() && apPath.value.trim());
}

// === Deploy Modal ===
var deployModal = document.getElementById('deployModal');
var deployModalBody = document.getElementById('deployModalBody');

function closeDeployModal() {
  deployModal.style.display = 'none';
}

async function openDeployModal() {
  // Capture the project locally so that a user clicking Overview (or switching
  // projects) mid-await doesn't null `activeProject` out from under us.
  var project = activeProject;
  if (!project) return;
  deployModal.style.display = 'flex';

  // B2: re-sync + re-discover before showing modal, so any external pushes are reflected
  // in both the sidebar and the deploy-check we're about to run. Network call ~1–2s.
  deployModalBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim)">Syncing latest from GitHub…</div>';
  try {
    await window.api.syncProjects();
    var fresh = await window.api.discoverProjects();
    if (Array.isArray(fresh)) {
      projects = fresh;
      var updated = projects.find(function(p) { return p.id === project.id; });
      if (updated) {
        project = updated;
        if (activeProject && activeProject.id === project.id) activeProject = updated;
      }
      renderProjects();
      // Restore active highlight after re-render
      document.querySelectorAll('.project-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.id === project.id);
      });
    }
  } catch (_) {
    // Sync failure is non-fatal — continue with whatever local state we have
  }

  deployModalBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim)">Checking deploy status…</div>';
  var check = await window.api.deployCheck(project.path, project.id);

  if (!check.claspInstalled) {
    deployModalBody.innerHTML = renderSetupNeeded('clasp CLI가 설치되어 있지 않습니다.', '터미널에서 실행: <code>npm install -g @google/clasp</code>');
    return;
  }

  if (!check.claspLoggedIn) {
    deployModalBody.innerHTML = renderSetupNeeded('clasp 로그인이 필요합니다.', '터미널에서 실행: <code>clasp login</code><br>브라우저에서 Google 계정 승인 후 다시 시도하세요.');
    return;
  }

  if (!check.claspJsonExists) {
    deployModalBody.innerHTML = renderScriptIdForm();
    return;
  }

  // Ready to deploy — show preview with HEAD info + Case A/B
  renderDeployPreview(check);
}

function renderSetupNeeded(title, instruction) {
  return '<div style="padding:8px 0">'
    + '<div style="font-weight:600; margin-bottom:12px; color:var(--accent-amber)">\u26A0\uFE0F ' + title + '</div>'
    + '<div style="color:var(--text-muted)">' + instruction + '</div>'
    + '<div class="deploy-actions"><button class="btn-cancel" onclick="closeDeployModal()">Close</button></div>'
    + '</div>';
}

function renderScriptIdForm() {
  return '<div style="padding:8px 0">'
    + '<div style="font-weight:600; margin-bottom:8px">Apps Script ID 설정</div>'
    + '<div style="color:var(--text-muted); margin-bottom:12px; font-size:13px">'
    + 'Apps Script 에디터 URL에서 Script ID를 복사하세요:<br>'
    + '<code style="color:var(--accent-blue)">https://script.google.com/home/projects/<b>SCRIPT_ID</b>/edit</code>'
    + '</div>'
    + '<input type="text" class="deploy-input" id="scriptIdInput" placeholder="Script ID를 붙여넣으세요">'
    + '<div class="deploy-actions">'
    + '<button class="btn-cancel" onclick="closeDeployModal()">Cancel</button>'
    + '<button class="btn-setup" onclick="saveScriptId()">Save &amp; Continue</button>'
    + '</div></div>';
}

async function saveScriptId() {
  var input = document.getElementById('scriptIdInput');
  var scriptId = input.value.trim();
  if (!scriptId) return;

  var result = await window.api.deploySetup(activeProject.path, scriptId);
  if (result.success) {
    openDeployModal(); // Re-open to show deploy preview
  } else {
    deployModalBody.innerHTML = renderSetupNeeded('Setup failed', result.error);
  }
}

function renderDeployPreview(check) {
  // Head line — always shown so the user knows WHICH commit is about to deploy.
  var headShort = check.headSha ? check.headSha.slice(0, 7) : '???????';
  var headLine =
    '<div style="margin:10px 0 14px; padding:10px 12px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:6px;">'
    + '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim); margin-bottom:4px">Deploying HEAD</div>'
    + '<div><span style="font-family:var(--font-mono); color:var(--accent-blue)">' + escapeHtml(headShort) + '</span> '
    + '<span style="color:var(--text-primary)">' + escapeHtml(check.headSubject || '') + '</span></div>'
    + '</div>';

  // Body branches into 3 cases.
  var bodyHtml;
  if (check.upToDate) {
    // Case A — Apps Script is already at this commit
    bodyHtml =
      '<div style="padding:12px 14px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.35); border-radius:6px; color:#86efac;">'
      + '✓ Apps Script is already at commit <span style="font-family:var(--font-mono)">' + escapeHtml(headShort) + '</span>. '
      + '<span style="opacity:0.85">No deploy needed — current state matches the live version.</span>'
      + '</div>';
  } else if (!check.lastDeployedSha) {
    // First deploy via gas-commander (no record yet)
    bodyHtml =
      '<div style="padding:12px 14px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:6px; color:#c7d2fe;">'
      + 'No prior deploy recorded for this project. All clasp-tracked files will be pushed.'
      + '</div>';
  } else {
    // Case B — commits/files since last deploy
    var prevShort = check.lastDeployedSha.slice(0, 7);
    var commitsHtml = (check.commitsSinceDeploy || []).map(function(c) {
      return '<div style="padding:3px 0; font-size:12px;">'
        + '<span style="font-family:var(--font-mono); color:var(--text-dim)">' + escapeHtml(c.sha.slice(0, 7)) + '</span> '
        + '<span style="color:var(--text-primary)">' + escapeHtml(c.subject) + '</span>'
        + '</div>';
    }).join('');
    var filesHtml = (check.filesChangedSinceDeploy || []).map(function(f) {
      return '<div class="deploy-step"><span class="deploy-step-icon">\u{1F4C4}</span><span class="deploy-step-text">' + escapeHtml(f) + '</span></div>';
    }).join('');
    bodyHtml =
      '<div style="margin:6px 0 12px"><div style="font-weight:600; margin-bottom:6px">Commits since last deploy <span style="font-weight:400; color:var(--text-dim); font-family:var(--font-mono); font-size:12px">(' + escapeHtml(prevShort) + ')</span>:</div>'
      + (commitsHtml || '<div style="color:var(--text-dim); font-size:12px">(none)</div>')
      + '</div>'
      + '<div style="margin:6px 0"><div style="font-weight:600; margin-bottom:6px">Files to push:</div>'
      + (filesHtml || '<div style="color:var(--text-dim); font-size:12px">(no file diff)</div>')
      + '</div>';
  }

  // Uncommitted-changes warning — clasp push DOES upload the on-disk state, so any
  // uncommitted edits silently ride along. Surface this so the user can commit first.
  var uncommittedHtml = check.hasUncommitted
    ? '<div style="margin-top:10px; padding:8px 10px; background:rgba(234,164,75,0.12); border:1px solid rgba(234,164,75,0.4); border-radius:4px; color:#fbbf77; font-size:12px;">'
      + '⚠ Working tree has uncommitted changes — these <strong>will be pushed too</strong>. Commit first if you want a clean deploy.'
      + '</div>'
    : '';

  deployModalBody.innerHTML = '<div>'
    + '<div style="font-weight:600; margin-bottom:8px">Script ID: <span style="color:var(--accent-blue); font-family:var(--font-mono); font-size:12px">' + escapeHtml(check.scriptId || '') + '</span></div>'
    + headLine
    + bodyHtml
    + uncommittedHtml
    + '<div id="deployProgress"></div>'
    + '<div class="deploy-actions" id="deployActions">'
    + '<button class="btn-cancel" onclick="closeDeployModal()">Cancel</button>'
    + '<button class="btn-deploy" onclick="executeDeploy()">' + (check.upToDate ? 'Re-deploy Anyway' : 'Deploy Now') + '</button>'
    + '</div></div>';
}

async function executeDeploy() {
  var actionsEl = document.getElementById('deployActions');
  actionsEl.innerHTML = '<span style="color:var(--text-dim)">Deploying...</span>';

  var result = await window.api.deployExecute(activeProject.path, activeProject.id, '');

  if (result.success) {
    actionsEl.innerHTML = '<span style="color:var(--accent-green); font-weight:600">\u2705 ' + result.message + '</span>'
      + '<button class="btn-deploy" onclick="reloadPreviewAndClose()" style="margin-left:8px">Preview Reload</button>';
  } else {
    actionsEl.innerHTML = '<span style="color:var(--accent-red)">\u274C ' + escapeHtml(result.error) + '</span>'
      + '<button class="btn-cancel" onclick="closeDeployModal()" style="margin-left:8px">Close</button>';
  }
}

function reloadPreviewAndClose() {
  closeDeployModal();
  switchTab('preview');
  var wv = document.getElementById('previewWebview');
  if (activeProject && activeProject.liveUrl) {
    wv.src = activeProject.liveUrl;
  }
}

init();
