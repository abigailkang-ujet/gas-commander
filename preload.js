const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  syncProjects: () => ipcRenderer.invoke('sync-projects'),
  discoverProjects: () => ipcRenderer.invoke('discover-projects'),

  runSkill: (projectPath, skillId, args) => {
    ipcRenderer.send('run-skill', { projectPath, skillId, args });
  },

  // continueSession: true to resume previous conversation
  runPrompt: (projectPath, prompt, continueSession) => {
    ipcRenderer.send('run-prompt', { projectPath, prompt, continueSession });
  },

  stopProcess: () => {
    ipcRenderer.send('stop-process');
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
  }
});
