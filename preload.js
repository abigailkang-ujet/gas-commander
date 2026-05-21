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
  deployCheck: (projectPath) => ipcRenderer.invoke('deploy-check', { projectPath }),
  deploySetup: (projectPath, scriptId) => ipcRenderer.invoke('deploy-setup', { projectPath, scriptId }),
  deployExecute: (projectPath, description) => ipcRenderer.invoke('deploy-execute', { projectPath, description }),

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
  }
});
