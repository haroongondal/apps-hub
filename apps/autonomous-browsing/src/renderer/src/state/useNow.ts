import { useEffect, useState } from 'react'

// Relative timestamps in the runs rail go stale on their own; nothing else in
// the app re-renders them.
export function useNow(intervalMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
