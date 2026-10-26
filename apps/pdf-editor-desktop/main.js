import { app, BrowserWindow } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 900, title: 'PDF Editor' });
  // a missed drop or stray link would navigate away and lose unsaved edits
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // the editor UI lives in the shared engine package: still plain file://
  const page = fileURLToPath(new URL('../../packages/pdf-editor-engine/desktop.html', import.meta.url));
  win.loadURL(pathToFileURL(page).href);
});
app.on('window-all-closed', () => app.quit());
