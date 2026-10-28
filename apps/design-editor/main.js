import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

if (process.env.DESIGN_EDITOR_DATA) app.setPath('userData', process.env.DESIGN_EDITOR_DATA);
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.json');
let win;
const granted = new Set();

const send = cmd => () => win?.webContents.send('menu', cmd);
const isMac = process.platform === 'darwin';
const menu = Menu.buildFromTemplate([
  ...(isMac ? [{ role: 'appMenu' }] : []),
  { label: 'File', submenu: [
    { id: 'new', label: 'New Design', accelerator: 'CmdOrCtrl+N', click: send('new') },
    { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
    { type: 'separator' },
    { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
    { id: 'saveAs', label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: send('saveAs') },
    { id: 'export', label: 'Download…', accelerator: 'Shift+CmdOrCtrl+E', click: send('export') },
    ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
  ] },
  // undo and redo go to the editor's own history, not Chromium's, unless a text field has focus
  { label: 'Edit', submenu: [
    { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
    { id: 'redo', label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
    { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
    { id: 'duplicate', label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
    { role: 'selectAll' },
  ] },
  { label: 'View', submenu: [
    { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
    { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
    { label: 'Fit to Window', accelerator: 'CmdOrCtrl+0', click: send('zoomFit') },
    { type: 'separator' },
    { role: 'togglefullscreen' },
    { role: 'toggleDevTools' },
  ] },
  { role: 'windowMenu' },
]);

const FILTERS = {
  json: { name: 'Design', extensions: ['json'] },
  png: { name: 'PNG image', extensions: ['png'] },
  jpg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  svg: { name: 'SVG image', extensions: ['svg'] },
  pdf: { name: 'PDF document', extensions: ['pdf'] },
};

ipcMain.handle('save-file', async (_, { name, ext, data, filePath }) => {
  if (!FILTERS[ext]) throw new Error('unknown file type ' + ext);
  if (filePath && !granted.has(filePath)) throw new Error('path was not chosen in a dialog');
  if (Array.isArray(data) && (filePath || ext === 'json')) throw new Error('several files need a dialog');
  if (!filePath) {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [FILTERS[ext]] });
    if (r.canceled || !r.filePath) return null;
    filePath = r.filePath;
    if (ext === 'json') granted.add(filePath);
  }
  // one file per page: name-1.png, name-2.png, … next to the path picked in the dialog
  const files = Array.isArray(data) ? data.map((_, i) => filePath.replace(/(\.\w+)?$/, `-${i + 1}$1`)) : [filePath];
  const list = Array.isArray(data) ? data : [data];
  await Promise.all(files.map((f, i) => fs.writeFile(f, typeof list[i] === 'string' ? list[i] : Buffer.from(list[i]))));
  return files[0];
});
ipcMain.handle('open-design', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [FILTERS.json] });
  if (r.canceled || !r.filePaths[0]) return null;
  granted.add(r.filePaths[0]);
  return { filePath: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
});
ipcMain.handle('autosave-read', async () => {
  try {
    const saved = JSON.parse(await fs.readFile(autosavePath(), 'utf8'));
    if (saved.filePath) granted.add(saved.filePath);
    return saved;
  } catch { return null; }
});
let autosaving = Promise.resolve();
ipcMain.handle('autosave-write', (_, saved) => {
  if (saved.filePath && !granted.has(saved.filePath)) saved.filePath = null;
  autosaving = autosaving.catch(() => {}).then(async () => {
    await fs.writeFile(autosavePath() + '.tmp', JSON.stringify(saved));
    await fs.rename(autosavePath() + '.tmp', autosavePath());
  });
  return autosaving;
});
ipcMain.on('doc-state', (_, { title, dirty, filePath }) => {
  if (!win) return;
  win.setTitle(title);
  win.setDocumentEdited(dirty);
  win.setRepresentedFilename(filePath || '');
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(menu);
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, title: 'Design Editor',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  // a stray drop or link would navigate away from the editor and lose the open design
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
  win.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
