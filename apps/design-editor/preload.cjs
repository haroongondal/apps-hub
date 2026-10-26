const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  saveFile: opts => ipcRenderer.invoke('save-file', opts),
  openDesign: () => ipcRenderer.invoke('open-design'),
  readAutosave: () => ipcRenderer.invoke('autosave-read'),
  writeAutosave: text => ipcRenderer.invoke('autosave-write', text),
  setDocState: state => ipcRenderer.send('doc-state', state),
  onMenu: fn => ipcRenderer.on('menu', (_, cmd) => fn(cmd)),
});
