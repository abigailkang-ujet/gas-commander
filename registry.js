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
