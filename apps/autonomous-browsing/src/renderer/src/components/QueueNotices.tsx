import { useState, type ReactNode } from 'react'
import type { QueueSnapshot } from '../../../shared/types'
import { workLabel } from '../lib/queue-view'
import { Button } from './ui'
import styles from './topbar.module.css'

interface QueueNoticesProps {
  snapshot: QueueSnapshot
  names: Map<string, string>
  onStart: () => void
}

export function QueueNotices({ snapshot, names, onStart }: QueueNoticesProps): ReactNode {
  const [dismissed, setDismissed] = useState<string[]>([])
  const drops = snapshot.recent.filter((drop) => !dismissed.includes(drop.id))

  return (
    <>
      {snapshot.suspended ? (
        <div className={styles.banner} role="alert" aria-live="assertive">
          <p className={styles.bannerText}>
            <span className={styles.bannerTitle}>Queue suspended</span>
            Nothing starts until you say so, because the browser was paused when the last run stopped.
          </p>
          <Button variant="primary" size="sm" onClick={onStart}>
            Start queue
          </Button>
        </div>
      ) : null}

      {drops.map((drop) => (
        <div key={drop.id} className={styles.notice} role="alert">
          <p className={styles.noticeText}>
            <span className={styles.noticeTitle}>{workLabel(drop.work, names)} did not run</span>
            {drop.message}
          </p>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setDismissed((current) => [...current, drop.id])}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </>
  )
}
