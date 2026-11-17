import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SiteLandmark } from '../../../shared/site-memory'
import { relativeTime } from '../lib/format'
import { useNow } from '../state/useNow'
import type { SitesState } from '../state/useSites'
import { Button, EmptyState, Eyebrow, Mono, Pill } from './ui'
import shell from './app.module.css'
import styles from './sites.module.css'

function detail(landmark: SiteLandmark): string {
  if (landmark.kind === 'obstacle') return 'blocked a run before'
  return landmark.selector ?? landmark.url ?? ''
}

function LandmarkRow({ landmark }: { landmark: SiteLandmark }): ReactNode {
  const stale = landmark.misses > landmark.hits
  return (
    <li className={styles.landmark}>
      <span className={styles.label}>{landmark.label}</span>
      <Mono>{detail(landmark)}</Mono>
      <span className={styles.score}>
        {landmark.hits} worked, {landmark.misses} failed
      </span>
      {stale ? <Pill tone="var(--fault)">stopped working</Pill> : null}
    </li>
  )
}

export function SitesView({ state }: { state: SitesState }): ReactNode {
  const now = useNow(60_000)
  const [expanded, setExpanded] = useState<string | null>(null)
  const hasSites = state.origins.length > 0

  useEffect(() => {
    if (expanded !== null && !state.landmarks.has(expanded)) {
      state.open(expanded)
    }
  }, [expanded, state.landmarks, state.open])

  const toggle = (origin: string): void => {
    setExpanded(expanded === origin ? null : origin)
  }

  return (
    <>
      {hasSites ? (
        <header className={styles.header}>
          <Eyebrow>Site memory</Eyebrow>
          <Button variant="danger" size="sm" onClick={() => void state.purge()}>
            Forget everything
          </Button>
        </header>
      ) : null}
      <div className={shell.detailBody}>
        {hasSites ? (
          <ul className={styles.origins}>
            {state.origins.map((site) => (
              <li key={site.origin} className={styles.origin}>
                <button type="button" className={styles.summary} onClick={() => toggle(site.origin)}>
                  <span className={styles.host}>{site.origin}</span>
                  <span className={styles.count}>{site.landmarks} noted</span>
                  <span className={styles.seen}>{relativeTime(site.lastSeen, now)}</span>
                </button>
                <Button variant="danger" size="sm" onClick={() => void state.forget(site.origin)}>
                  Forget this site
                </Button>
                {expanded === site.origin ? (
                  <ul className={styles.landmarks}>
                    {(state.landmarks.get(site.origin) ?? []).map((landmark) => (
                      <LandmarkRow key={landmark.id} landmark={landmark} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing learned yet">
            Site memory fills in as automations and goals run. What a run finds on a site — the
            controls that worked, the pages that loaded — is offered back to the next run on that
            same site.
          </EmptyState>
        )}
      </div>
    </>
  )
}
