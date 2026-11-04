const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('harbor', {
  getInputPrivacy: () => ipcRenderer.invoke('input-privacy:get'),
  saveInputPrivacy: value => ipcRenderer.invoke('input-privacy:save', value),
  editText: action => ipcRenderer.invoke('terminal:edit-text', action),
  onEdit: callback => {
    const listener = (_, action) => callback(action);
    ipcRenderer.on('terminal:edit', listener);
    return () => ipcRenderer.removeListener('terminal:edit', listener);
  },
  copyText: text => ipcRenderer.invoke('clipboard:copy', text),
  pasteText: text => ipcRenderer.invoke('clipboard:paste', text),
  openLink: url => ipcRenderer.invoke('terminal:link', url),
  getLanguage: () => ipcRenderer.invoke('language:get'),
  setLanguage: (language) => ipcRenderer.invoke('language:set', language),
  getCapabilities: () => ipcRenderer.invoke('transport:capabilities'),
  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  saveAppearance: (value) => ipcRenderer.invoke('appearance:save', value),
  getSecurity: () => ipcRenderer.invoke('security:get'),
  enableSecurity: (value) => ipcRenderer.invoke('security:enable', value),
  configureSecurity: (value) => ipcRenderer.invoke('security:configure', value),
  unlock: (value) => ipcRenderer.invoke('security:unlock', value),
  lock: () => ipcRenderer.invoke('security:lock'),
  activity: () => ipcRenderer.send('security:activity'),
  getServer: (id) => ipcRenderer.invoke('servers:get', id),
  listSessions: () => ipcRenderer.invoke('session:list'),
  onSecurity: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('security:changed', listener);
    return () => ipcRenderer.removeListener('security:changed', listener);
  },
  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (server) => ipcRenderer.invoke('servers:save', server),
  moveServer: (input) => ipcRenderer.invoke('servers:move', input),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  chooseKey: (kind) => ipcRenderer.invoke('key:choose', kind),
  openSession: (options) => ipcRenderer.invoke('session:open', options),
  input: (id, data) => ipcRenderer.send('session:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', id, cols, rows),
  ack: (id, length, generation) => ipcRenderer.send('session:ack', id, length, generation),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  pauseRetry: (id) => ipcRenderer.invoke('session:pause-retry', id),
  reconnect: (id) => ipcRenderer.invoke('session:reconnect', id),
  onEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('session:event', listener);
    return () => ipcRenderer.removeListener('session:event', listener);
  },
});
