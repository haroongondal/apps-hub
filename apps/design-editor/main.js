import { app, BrowserWindow, Menu, dialog, ipcMain, net, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openMediaWindow, registerMedia } from './media.js';

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
    { type: 'separator' },
    { id: 'media', label: 'Media Tools…', accelerator: 'Shift+CmdOrCtrl+M', click: openMediaWindow },
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
  // the dialog only confirmed filePath, so ask before replacing any of the per-page files
  const taken = Array.isArray(data) ? (await Promise.all(files.map(f => fs.access(f).then(() => f, () => null)))).filter(Boolean) : [];
  if (taken.length) {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', message: `Replace ${taken.length} ${taken.length > 1 ? 'files that already exist' : 'file that already exists'}?`,
      detail: taken.map(f => path.basename(f)).join('\n'), buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1,
    });
    if (r.response !== 0) return null;
  }
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
// a session this build can't restore is saved aside as a design file before the new design's autosave replaces it
ipcMain.handle('autosave-keep', async () => {
  const { doc } = JSON.parse(await fs.readFile(autosavePath(), 'utf8'));
  const kept = path.join(app.getPath('userData'), `autosave-unreadable-${Date.now()}.json`);
  await fs.writeFile(kept, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return kept;
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
// Design with AI: the key is encrypted at rest and never leaves this process; the page only sends the request body
const aiKeyPath = () => path.join(app.getPath('userData'), 'ai-key.bin');
const readAiKey = async () => {
  try { return safeStorage.decryptString(await fs.readFile(aiKeyPath())); } catch { return null; }
};
ipcMain.handle('ai-has-key', async () => !!(await readAiKey()));
ipcMain.handle('ai-set-key', async (_, key) => {
  key = typeof key === 'string' ? key.trim() : '';
  if (!key) return { ok: false, error: 'bad' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'nosecure' };
  await fs.writeFile(aiKeyPath(), safeStorage.encryptString(key));
  return { ok: true };
});
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// The page picks the prompt and the tool, not the model, the spend or a server tool. Keep this in step with aiSanitise in apps/design-editor-mobile/src/editor/ai.ts.
const AI_MODEL = 'claude-sonnet-5-5'; // keep in step with MODEL in packages/design-editor-engine/ai-layout.js
function aiSanitise(body) {
  if (!isObj(body) || !Array.isArray(body.messages)) return null;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(t => !isObj(t) || 'type' in t))) return null;
  const clean = { ...body, model: AI_MODEL, max_tokens: Math.min(Number(body.max_tokens) || 8000, 8000) };
  delete clean.stream;
  return clean;
}
ipcMain.handle('ai-request', async (_, page) => {
  const body = aiSanitise(page);
  if (!body) return { ok: false, status: 0, error: 'bad' };
  const key = await readAiKey();
  if (!key) return { ok: false, status: 0, error: 'nokey' };
  try {
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let json;
    try { const parsed = JSON.parse(text); if (isObj(parsed)) json = parsed; } catch { /* an HTTP error page without JSON keeps its status */ }
    if (res.ok && !json) return { ok: false, status: res.status, error: 'bad' };
    return json ? { ok: res.ok, status: res.status, json } : { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'TimeoutError' ? 'timeout' : 'offline' };
  }
});
registerMedia();
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
  win.loadFile('vendor/engine/desktop.html');
});
app.on('window-all-closed', () => app.quit());
