// === State ===
var projects = [];
var activeProject = null;
var isRunning = false;
var hasSession = false; // true after first interaction completes (can continue)

// === DOM refs ===
var projectList = document.getElementById('projectList');
var skillsSection = document.getElementById('skillsSection');
var skillList = document.getElementById('skillList');
var outputPanel = document.getElementById('outputPanel');
var previewPanel = document.getElementById('previewPanel');
var previewUrl = document.getElementById('previewUrl');
var previewRefresh = document.getElementById('previewRefresh');
var promptInput = document.getElementById('promptInput');
var promptSend = document.getElementById('promptSend');
var stopBtn = document.getElementById('stopBtn');
var tabBtns = document.querySelectorAll('.tab-btn');

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

function selectProject(projectId) {
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

// === Deploy Modal ===
var deployModal = document.getElementById('deployModal');
var deployModalBody = document.getElementById('deployModalBody');

function closeDeployModal() {
  deployModal.style.display = 'none';
}

async function openDeployModal() {
  if (!activeProject) return;
  deployModal.style.display = 'flex';
  deployModalBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim)">Checking deploy status...</div>';

  var check = await window.api.deployCheck(activeProject.path);

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

  // Ready to deploy — show diff preview
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
  var diffDisplay = check.diff || '(no changes detected)';
  var filesHtml = check.files.length > 0
    ? check.files.map(function(f) { return '<div class="deploy-step"><span class="deploy-step-icon">\u{1F4C4}</span><span class="deploy-step-text">' + escapeHtml(f) + '</span></div>'; }).join('')
    : '<div style="color:var(--text-dim); padding:8px 0">No uncommitted changes — deploying current state</div>';

  deployModalBody.innerHTML = '<div>'
    + '<div style="font-weight:600; margin-bottom:8px">Script ID: <span style="color:var(--accent-blue); font-family:var(--font-mono); font-size:12px">' + escapeHtml(check.scriptId || '') + '</span></div>'
    + '<div style="font-weight:600; margin-bottom:8px">Changed files:</div>'
    + filesHtml
    + '<div class="deploy-diff">' + escapeHtml(diffDisplay) + '</div>'
    + '<div id="deployProgress"></div>'
    + '<div class="deploy-actions" id="deployActions">'
    + '<button class="btn-cancel" onclick="closeDeployModal()">Cancel</button>'
    + '<button class="btn-deploy" onclick="executeDeploy()">Deploy Now</button>'
    + '</div></div>';
}

async function executeDeploy() {
  var actionsEl = document.getElementById('deployActions');
  actionsEl.innerHTML = '<span style="color:var(--text-dim)">Deploying...</span>';

  var result = await window.api.deployExecute(activeProject.path, '');

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
