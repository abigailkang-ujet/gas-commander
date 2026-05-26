const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  syncProjects: () => ipcRenderer.invoke('sync-projects'),
  discoverProjects: () => ipcRenderer.invoke('discover-projects'),

  runSkill: (projectPath, skillId, args) => {
    ipcRenderer.send('run-skill', { projectPath, skillId, args });
  },

  runPrompt: (projectPath, prompt, continueSession) => {
    ipcRenderer.send('run-prompt', { projectPath, prompt, continueSession });
  },

  stopProcess: () => {
    ipcRenderer.send('stop-process');
  },

  // Deploy
  deployCheck: (projectPath, projectId) => ipcRenderer.invoke('deploy-check', { projectPath, projectId }),
  deploySetup: (projectPath, scriptId) => ipcRenderer.invoke('deploy-setup', { projectPath, scriptId }),
  deployExecute: (projectPath, projectId, description) => ipcRenderer.invoke('deploy-execute', { projectPath, projectId, description }),

  onDeployProgress: (callback) => {
    ipcRenderer.on('deploy-progress', (_, data) => callback(data));
  },

  onStreamEvent: (callback) => {
    ipcRenderer.on('stream-event', (_, data) => callback(data));
  },

  onSessionEnd: (callback) => {
    ipcRenderer.on('session-end', (_, data) => callback(data));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('stream-event');
    ipcRenderer.removeAllListeners('session-end');
    ipcRenderer.removeAllListeners('deploy-progress');
  },

  // Mission Control
  registryList: () => ipcRenderer.invoke('registry:list'),
  registryAdd: (project) => ipcRenderer.invoke('registry:add', project),
  registryRemove: (id) => ipcRenderer.invoke('registry:remove', id),
  registryDetectStack: (path) => ipcRenderer.invoke('registry:detectStack', path),
  healthSnapshot: () => ipcRenderer.invoke('health:snapshot'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory')
});
