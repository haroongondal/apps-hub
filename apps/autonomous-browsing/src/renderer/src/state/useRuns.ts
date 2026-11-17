import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationProgressEvent, RunDetail, RunRoutineInput, RunSummary } from '../../../shared/types'

export interface StartRoutineInput extends RunRoutineInput {
  name: string
}

export interface RunsOptions {
  // Arming auto-follow while another run is in flight would snap the detail pane
  // to that run's thread the moment it reports its next step.
  follow: () => boolean
}

export interface RunsState {
  summaries: RunSummary[]
  selected: RunDetail | null
  select: (runId: string | null) => void
  startError: string | null
  dismissStartError: () => void
  startRoutine: (input: StartRoutineInput) => Promise<void>
  rerun: (runId: string, params: Record<string, string>) => Promise<void>
  resumeRun: (runId: string, startIndex: number) => Promise<void>
  startGoal: (goal: string) => Promise<void>
  requestCancel: () => Promise<void>
  saveAsAutomation: (runId: string, name: string) => Promise<void>
  remove: (runId: string) => Promise<void>
}

interface PendingStart {
  opened: boolean
}

export function useRuns({ follow: shouldFollow }: RunsOptions): RunsState {
  const [summaries, setSummaries] = useState<RunSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<RunDetail | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const pendingStarts = useRef<PendingStart[]>([])
  const seenRuns = useRef(new Set<string>())
  const follow = useRef(true)
  const openThread = useRef<string | null>(null)

  const refreshList = useCallback(async (): Promise<void> => {
    setSummaries(await window.api.runs.list())
  }, [])

  const refreshSelected = useCallback(async (runId: string | null, deliberate = false): Promise<void> => {
    setSelected(runId === null ? null : await window.api.runs.get(runId, deliberate))
  }, [])

  // A run that began reporting did start, and entries dequeue in order, so the oldest waiter owns it.
  const creditRunStart = useCallback((runId: string): void => {
    if (seenRuns.current.has(runId)) return
    seenRuns.current.add(runId)
    const oldest = pendingStarts.current.find((pending) => !pending.opened)
    if (oldest) oldest.opened = true
  }, [])

  useEffect(() => {
    void refreshList()
    return window.api.runs.onChanged(() => void refreshList())
  }, [refreshList])

  useEffect(() => {
    openThread.current = selectedId
    void refreshSelected(selectedId, !follow.current)
  }, [selectedId, refreshSelected])

  useEffect(() => {
    return window.api.automation.onProgress((event: AutomationProgressEvent) => {
      creditRunStart(event.runId)

      if (follow.current) {
        openThread.current = event.runId
        setSelectedId(event.runId)
      }
      if (openThread.current === event.runId) void refreshSelected(event.runId)
    })
  }, [refreshSelected, creditRunStart])

  const start = useCallback(
    async (begin: () => Promise<unknown>): Promise<void> => {
      const pending: PendingStart = { opened: false }
      pendingStarts.current.push(pending)
      follow.current = shouldFollow()
      setStartError(null)
      try {
        await begin()
      } catch (error) {
        if (!pending.opened) setStartError(error instanceof Error ? error.message : String(error))
      } finally {
        pendingStarts.current = pendingStarts.current.filter((candidate) => candidate !== pending)
      }
    },
    [shouldFollow]
  )

  const startRoutine = useCallback(
    (input: StartRoutineInput): Promise<void> =>
      start(() => window.api.automation.run({ kind: input.kind, id: input.id, params: input.params })),
    [start]
  )

  const rerun = useCallback(
    (runId: string, params: Record<string, string>): Promise<void> =>
      start(() => window.api.runs.rerun(runId, params)),
    [start]
  )

  const resumeRun = useCallback(
    (runId: string, startIndex: number): Promise<void> => start(() => window.api.runs.resume(runId, startIndex)),
    [start]
  )

  const startGoal = useCallback(
    (goal: string): Promise<void> =>
      start(() => window.api.automation.chatSend({ sessionId: crypto.randomUUID(), goal })),
    [start]
  )

  const requestCancel = useCallback(async (): Promise<void> => {
    await window.api.automation.cancel()
  }, [])

  const saveAsAutomation = useCallback(
    async (runId: string, name: string): Promise<void> => {
      await window.api.automation.chatSave(runId, name)
      await refreshSelected(runId)
    },
    [refreshSelected]
  )

  const remove = useCallback(
    async (runId: string): Promise<void> => {
      await window.api.runs.remove(runId)
      if (runId === selectedId) setSelectedId(null)
    },
    [selectedId]
  )

  const select = useCallback((runId: string | null): void => {
    follow.current = false
    openThread.current = runId
    setSelectedId(runId)
  }, [])

  return {
    summaries,
    selected,
    select,
    startError,
    dismissStartError: () => setStartError(null),
    startRoutine,
    rerun,
    resumeRun,
    startGoal,
    requestCancel,
    saveAsAutomation,
    remove
  }
}
