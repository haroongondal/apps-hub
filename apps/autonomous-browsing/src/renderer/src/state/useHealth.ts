import { useCallback, useEffect, useState } from 'react'
import type { RoutineHealth } from '../../../shared/types'

export function useHealth(): RoutineHealth[] {
  const [rows, setRows] = useState<RoutineHealth[]>([])

  const refresh = useCallback((): void => {
    void window.api.runs.health().then(setRows, () => setRows([]))
  }, [])

  useEffect(() => {
    refresh()
    return window.api.runs.onChanged(refresh)
  }, [refresh])

  return rows
}
