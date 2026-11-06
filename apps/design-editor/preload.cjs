const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  saveFile: opts => ipcRenderer.invoke('save-file', opts),
  openDesign: () => ipcRenderer.invoke('open-design'),
  readAutosave: () => ipcRenderer.invoke('autosave-read'),
  writeAutosave: text => ipcRenderer.invoke('autosave-write', text),
  keepAutosave: () => ipcRenderer.invoke('autosave-keep'),
  setDocState: state => ipcRenderer.send('doc-state', state),
  onMenu: fn => ipcRenderer.on('menu', (_, cmd) => fn(cmd)),
  media: {
    status: () => ipcRenderer.invoke('media-status'),
    pick: () => ipcRenderer.invoke('media-pick'),
    pickFolder: () => ipcRenderer.invoke('media-pick-folder'),
    plan: spec => ipcRenderer.invoke('media-plan', spec),
    enqueue: items => ipcRenderer.invoke('media-enqueue', items),
    cancel: id => ipcRenderer.invoke('media-cancel', id),
    keyframe: (inputId, timeS) => ipcRenderer.invoke('media-keyframe', { inputId, timeS }),
    thumbs: (inputId, timesS) => ipcRenderer.invoke('media-thumbs', { inputId, timesS }),
    queue: () => ipcRenderer.invoke('media-queue'),
    reveal: jobId => ipcRenderer.invoke('media-reveal', jobId),
    open: jobId => ipcRenderer.invoke('media-open', jobId),
    openWindow: () => ipcRenderer.send('media-open-window'),
    onEvent: fn => ipcRenderer.on('media-event', (_, e) => fn(e)),
  },
});
