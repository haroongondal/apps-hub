import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { IpcChannels, type IpcChannel } from '../shared/ipc'
import { ChromeProcess } from './automation/chrome-process'
import { ClaudeAutomationClient } from './automation/claude-client'
import { enableRunDebug } from './automation/debug-log'
import { ExtensionBridge } from './automation/extension-bridge'
import { ExtensionSession } from './automation/extension-session'
import { AutomationOrchestrator } from './automation/orchestrator'
import { PlaywrightSession } from './automation/playwright-session'
import { RunQueue } from './automation/run-queue'
import type { AutomationSession, RunContext } from './automation/session'
import type { QueueDisposition, QueueWork } from '../shared/types'
import type { SessionControl } from './automation/session-control'
import { openDatabase } from './db/database'
import { loadEnvFile } from './lib/env-file'
import { RunStore, type RunOpenMeta } from './db/runs'
import { SystemRoutineStore } from './db/system-routines'
import { RepairProposalStore } from './db/repair-proposals'
import { SiteMemoryStore } from './db/site-landmarks'
import { UserRoutineStore } from './db/user-routines'
import { registerIpcHandlers, trustSender, type BrowserHost } from './ipc'

function resolveUpdatesDir(): string {
  if (!app.isPackaged) {
    const dir = path.join(app.getAppPath(), 'updates')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  const dir = path.join(app.getPath('userData'), 'updates')
  fs.mkdirSync(dir, { recursive: true })
  const marker = path.join(dir, '.seeded-version')
  const seededVersion = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null
  if (seededVersion !== app.getVersion()) {
    const bundled = path.join(process.resourcesPath, 'updates')
    if (fs.existsSync(bundled)) fs.cpSync(bundled, dir, { recursive: true, force: true })
    fs.writeFileSync(marker, app.getVersion())
  }
  return dir
}

// Only the drops nobody was present to see earn a row; a user's own cancel and a
// schedule's supersede would fill the history with runs that never ran.
const DROP_STATUS: Partial<Record<QueueDisposition, 'cancelled' | 'error'>> = {
  'dropped-app-quit': 'cancelled',
  'expired-no-extension': 'error'
}

interface DropRecorder {
  runs: RunStore
  system: SystemRoutineStore
  user: UserRoutineStore
  broadcast: (channel: IpcChannel, payload?: unknown) => void
}

function recordDrop(deps: DropRecorder, work: QueueWork, disposition: QueueDisposition, message: string): void {
  const status = DROP_STATUS[disposition]
  if (!status || work.kind === 'lease') return

  try {
    deps.runs.record(
      {
        runId: randomUUID(),
        source: work.kind,
        status,
        stepIndex: -1,
        description: 'Never started',
        error: message
      },
      dropMeta(deps, work)
    )
  } catch (error) {
    console.error('[queue] could not record a dropped entry:', error)
    return
  }
  deps.broadcast(IpcChannels.runsChanged)
}

function dropMeta(deps: DropRecorder, work: Exclude<QueueWork, { kind: 'lease' }>): RunOpenMeta {
  if (work.kind === 'chat') {
    return { routineId: null, routineKind: null, routineName: work.input.goal, params: {} }
  }
  const { kind, id, params } = work.target
  const routine = kind === 'system' ? deps.system.get(id) : deps.user.get(id)
  return { routineId: id, routineKind: kind, routineName: routine?.name ?? id, params: params ?? {} }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 580,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1116' : '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  trustSender(win.webContents)
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    const envFile = app.isPackaged
      ? path.join(process.resourcesPath, '.env')
      : path.join(app.getAppPath(), '.env')
    loadEnvFile(envFile)

    const db = openDatabase(path.join(app.getPath('userData'), 'routines.db'))
    const system = new SystemRoutineStore(db)
    const user = new UserRoutineStore(db)
    const runsDir = path.join(app.getPath('userData'), 'runs')
    const debugLevel = process.env['AUTOMATION_DEBUG']
    if (debugLevel) enableRunDebug(runsDir, debugLevel)
    const runs = new RunStore(db, runsDir)
    const proposals = new RepairProposalStore(db)
    const sites = new SiteMemoryStore(db)
    sites.prune()
    const interrupted = runs.closeOpenRuns()
    if (interrupted > 0) console.log(`[runs] closed ${interrupted} run(s) the last session left open`)
    const updatesDir = resolveUpdatesDir()
    system.syncFromDir(updatesDir)

    const inputMode = process.env['AUTOMATION_INPUT'] ?? 'auto'
    let session: AutomationSession
    let control: SessionControl
    let browserHost: BrowserHost | null
    let closeBackend: () => void

    if (process.env['AUTOMATION_BACKEND'] === 'extension') {
      const bridge = new ExtensionBridge()
      bridge.listen()
      session = new ExtensionSession(bridge, inputMode)
      control = bridge
      browserHost = null
      closeBackend = (): void => bridge.close()
    } else {
      const chrome = new ChromeProcess(
        path.join(app.getPath('userData'), 'automation-profile'),
        path.join(app.getPath('userData'), 'automation-browser.json')
      )
      const playwright = new PlaywrightSession(chrome, inputMode)
      session = playwright
      control = playwright
      browserHost = playwright
      closeBackend = (): void => playwright.shutdownSync()
    }

    const automation = new AutomationOrchestrator(session, new ClaudeAutomationClient(process.env['AI_GATEWAY_API_KEY']), sites)

    const broadcast = (channel: IpcChannel, payload?: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
    }

    const sendStatus = (): void =>
      broadcast(IpcChannels.automationStatus, { connected: control.connected, paused: control.isPaused })

    control.on('connected', sendStatus)
    control.on('disconnected', sendStatus)
    control.on('paused', (reason: string | null, automatic: boolean, at: RunContext | null) => {
      broadcast(IpcChannels.automationHold, {
        held: true,
        reason,
        automatic,
        runId: at?.runId ?? null,
        stepIndex: at?.stepIndex ?? null
      })
    })
    control.on('resumed', () => {
      broadcast(IpcChannels.automationHold, {
        held: false,
        reason: null,
        automatic: false,
        runId: null,
        stepIndex: null
      })
    })

    const queue = new RunQueue({
      control,
      onChanged: (snapshot) => broadcast(IpcChannels.queueChanged, snapshot),
      onDropped: (work, disposition, message) =>
        recordDrop({ runs, system, user, broadcast }, work, disposition, message)
    })

    registerIpcHandlers({
      system,
      user,
      runs,
      proposals,
      sites,
      accept: (work) => db.transaction(work)(),
      updatesDir,
      automation,
      queue,
      control,
      browserHost,
      broadcast
    })
    const stopWatching = system.watch(updatesDir, (result) => broadcast(IpcChannels.changed, result))

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    app.on('before-quit', () => {
      stopWatching()
      queue.drain('the app closed before this entry started')
      closeBackend()
      if (db.open) db.close()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
