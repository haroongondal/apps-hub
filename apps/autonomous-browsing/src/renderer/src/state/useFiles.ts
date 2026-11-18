import { useCallback, useState } from 'react'
import type { RoutineFile } from '../../../shared/types'
import type { Outgoing } from '../components/ExportReview'
import type { Pending } from '../components/ImportReview'

export interface FilesState {
  outgoing: Outgoing | null
  pending: Pending | null
  problem: string | null
  busy: boolean
  savedTo: string | null
  beginExport: (kind: 'system' | 'user', id: string) => Promise<void>
  beginImport: () => Promise<void>
  write: (file: RoutineFile) => Promise<void>
  confirmImport: (overwrite: boolean) => Promise<void>
  clear: () => void
}

export function useFiles(onImported: () => void): FilesState {
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  const clear = useCallback((): void => {
    setOutgoing(null)
    setPending(null)
    setProblem(null)
    setSavedTo(null)
  }, [])

  const attempt = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setProblem(null)
    setBusy(true)
    try {
      await work()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    }
    setBusy(false)
  }, [])

  const beginExport = useCallback(
    (kind: 'system' | 'user', id: string): Promise<void> =>
      attempt(async () => {
        clear()
        setOutgoing(await window.api.files.exportPrepare(kind, id))
      }),
    [attempt, clear]
  )

  const beginImport = useCallback(
    (): Promise<void> =>
      attempt(async () => {
        clear()
        const opened = await window.api.files.importOpen()
        if (opened) setPending(opened)
      }),
    [attempt, clear]
  )

  const write = useCallback(
    (file: RoutineFile): Promise<void> =>
      attempt(async () => {
        const written = await window.api.files.exportWrite(file)
        if (!written) return
        setOutgoing(null)
        setSavedTo(written.path)
      }),
    [attempt]
  )

  const confirmImport = useCallback(
    (overwrite: boolean): Promise<void> =>
      attempt(async () => {
        if (!pending) return
        await window.api.files.importSave(pending.file, overwrite)
        setPending(null)
        onImported()
      }),
    [attempt, pending, onImported]
  )

  return { outgoing, pending, problem, busy, savedTo, beginExport, beginImport, write, confirmImport, clear }
}
