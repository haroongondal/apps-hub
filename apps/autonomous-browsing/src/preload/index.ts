import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type IpcChannel } from '../shared/ipc'
import type { RoutineReview, Secret } from '../shared/routine-review'
import type { ResumePlan, ResumeRefusal } from '../shared/resume'
import type { SiteLandmark } from '../shared/site-memory'
import type {
  AutomationHoldEvent,
  AutomationProgressEvent,
  BrowserStatus,
  ChatSendInput,
  ExtensionStatus,
  PurgeResult,
  QueueSnapshot,
  RepairProposal,
  RoutineFile,
  RoutineRevision,
  RunDetail,
  RoutineHealth,
  RunListQuery,
  RunResult,
  RunRoutineInput,
  RunSummary,
  SaveUserRoutineInput,
  SiteOriginSummary,
  SyncResult,
  SystemRoutine,
  UserRoutine
} from '../shared/types'

// ipcMain.handle prefixes "Error invoking remote method '<channel>': Error: ".
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/

async function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    if (error instanceof Error) throw new Error(error.message.replace(IPC_ERROR_PREFIX, ''))
    throw error
  }
}

const api = {
  system: {
    list: (): Promise<SystemRoutine[]> => invoke(IpcChannels.systemList),
    lastSync: (): Promise<SyncResult | null> => invoke(IpcChannels.systemLastSync),
    reload: (): Promise<SyncResult> => invoke(IpcChannels.systemReload)
  },
  user: {
    list: (): Promise<UserRoutine[]> => invoke(IpcChannels.userList),
    get: (id: string): Promise<UserRoutine | null> => invoke(IpcChannels.userGet, id),
    save: (payload: SaveUserRoutineInput): Promise<UserRoutine> => invoke(IpcChannels.userSave, payload),
    remove: (id: string): Promise<boolean> => invoke(IpcChannels.userDelete, id)
  },
  onRoutinesChanged(listener: (result?: SyncResult) => void): () => void {
    const wrapped = (_event: unknown, result?: SyncResult): void => listener(result)
    ipcRenderer.on(IpcChannels.changed, wrapped)
    return () => {
      ipcRenderer.removeListener(IpcChannels.changed, wrapped)
    }
  },
  automation: {
    run: (input: RunRoutineInput): Promise<RunResult> => invoke(IpcChannels.automationRun, input),
    chatSend: (input: ChatSendInput): Promise<void> => invoke(IpcChannels.automationChatSend, input),
    chatSave: (runId: string, name: string): Promise<UserRoutine> =>
      invoke(IpcChannels.automationChatSave, { runId, name }),
    onProgress(listener: (event: AutomationProgressEvent) => void): () => void {
      const wrapped = (_event: unknown, progress: AutomationProgressEvent): void => listener(progress)
      ipcRenderer.on(IpcChannels.automationProgress, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.automationProgress, wrapped)
      }
    },
    status: (): Promise<ExtensionStatus> => invoke(IpcChannels.automationStatus),
    pause: (reason?: string): Promise<void> => invoke(IpcChannels.automationPause, reason),
    resume: (): Promise<void> => invoke(IpcChannels.automationResume),
    cancel: (): Promise<void> => invoke(IpcChannels.automationCancel),
    onStatusChanged(listener: (status: ExtensionStatus) => void): () => void {
      const wrapped = (_event: unknown, status: ExtensionStatus): void => listener(status)
      ipcRenderer.on(IpcChannels.automationStatus, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.automationStatus, wrapped)
      }
    },
    onHold(listener: (event: AutomationHoldEvent) => void): () => void {
      const wrapped = (_event: unknown, hold: AutomationHoldEvent): void => listener(hold)
      ipcRenderer.on(IpcChannels.automationHold, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.automationHold, wrapped)
      }
    }
  },
  browser: {
    open: (): Promise<BrowserStatus> => invoke(IpcChannels.browserOpen),
    close: (): Promise<BrowserStatus> => invoke(IpcChannels.browserClose),
    status: (): Promise<BrowserStatus> => invoke(IpcChannels.browserStatus),
    onChanged(listener: (status: BrowserStatus) => void): () => void {
      const wrapped = (_event: unknown, status: BrowserStatus): void => listener(status)
      ipcRenderer.on(IpcChannels.browserStatus, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.browserStatus, wrapped)
      }
    }
  },
  queue: {
    list: (): Promise<QueueSnapshot> => invoke(IpcChannels.queueList),
    cancel: (id: string): Promise<boolean> => invoke(IpcChannels.queueCancel, id),
    clear: (): Promise<number> => invoke(IpcChannels.queueClear),
    start: (): Promise<void> => invoke(IpcChannels.queueStart),
    onChanged(listener: (snapshot: QueueSnapshot) => void): () => void {
      const wrapped = (_event: unknown, snapshot: QueueSnapshot): void => listener(snapshot)
      ipcRenderer.on(IpcChannels.queueChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.queueChanged, wrapped)
      }
    }
  },
  runs: {
    list: (query?: RunListQuery): Promise<RunSummary[]> => invoke(IpcChannels.runsList, query ?? {}),
    get: (id: string, markOpen = false): Promise<RunDetail | null> => invoke(IpcChannels.runsGet, id, markOpen),
    artifact: (artifactId: number): Promise<string | null> => invoke(IpcChannels.runsArtifact, artifactId),
    remove: (id: string): Promise<boolean> => invoke(IpcChannels.runsDelete, id),
    purge: (): Promise<PurgeResult> => invoke(IpcChannels.runsPurge),
    health: (): Promise<RoutineHealth[]> => invoke(IpcChannels.runsHealth),
    resumePlan: (runId: string, startIndex?: number): Promise<ResumePlan | ResumeRefusal> =>
      invoke(IpcChannels.runsResumePlan, { runId, startIndex }),
    resume: (runId: string, startIndex: number): Promise<void> =>
      invoke(IpcChannels.runsResume, { runId, startIndex }),
    rerun: (runId: string, params?: Record<string, string>): Promise<void> =>
      invoke(IpcChannels.runsRerun, { runId, params }),
    onChanged(listener: () => void): () => void {
      const wrapped = (): void => listener()
      ipcRenderer.on(IpcChannels.runsChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.runsChanged, wrapped)
      }
    }
  },
  files: {
    exportPrepare: (kind: 'system' | 'user', id: string): Promise<{ file: RoutineFile; secrets: Secret[] }> =>
      invoke(IpcChannels.exportPrepare, { kind, id }),
    exportWrite: (file: RoutineFile): Promise<{ path: string } | null> =>
      invoke(IpcChannels.exportWrite, file),
    importOpen: (): Promise<{ file: RoutineFile; review: RoutineReview; path: string } | null> =>
      invoke(IpcChannels.importOpen),
    importSave: (file: RoutineFile, overwrite = false): Promise<UserRoutine> =>
      invoke(IpcChannels.importSave, { file, overwrite })
  },
  repairs: {
    list: (routineId?: string): Promise<RepairProposal[]> =>
      invoke(IpcChannels.repairsList, routineId === undefined ? {} : { routineId }),
    accept: (proposalId: number): Promise<UserRoutine> =>
      invoke(IpcChannels.repairsAccept, { proposalId }),
    acceptOnce: (proposalId: number): Promise<boolean> =>
      invoke(IpcChannels.repairsAcceptOnce, { proposalId }),
    reject: (proposalId: number): Promise<boolean> => invoke(IpcChannels.repairsReject, { proposalId }),
    revisions: (routineId: string): Promise<RoutineRevision[]> =>
      invoke(IpcChannels.userRevisions, routineId),
    revert: (routineId: string, revision: number): Promise<UserRoutine> =>
      invoke(IpcChannels.userRevert, { routineId, revision }),
    onChanged(listener: () => void): () => void {
      const wrapped = (): void => listener()
      ipcRenderer.on(IpcChannels.repairsChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.repairsChanged, wrapped)
      }
    }
  },
  sites: {
    list: (): Promise<SiteOriginSummary[]> => invoke(IpcChannels.sitesList, {}),
    landmarks: (origin: string): Promise<SiteLandmark[]> =>
      invoke(IpcChannels.sitesLandmarks, { origin }),
    forget: (origin: string): Promise<number> => invoke(IpcChannels.sitesForget, { origin }),
    purge: (): Promise<number> => invoke(IpcChannels.sitesPurge, {}),
    onChanged(listener: () => void): () => void {
      const wrapped = (): void => listener()
      ipcRenderer.on(IpcChannels.sitesChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.sitesChanged, wrapped)
      }
    }
  }
}

export type RendererApi = typeof api

contextBridge.exposeInMainWorld('api', api)
