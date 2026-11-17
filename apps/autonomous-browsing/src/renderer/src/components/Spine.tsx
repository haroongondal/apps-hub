import type { ReactNode } from 'react'
import type { StepMark } from '../lib/run-model'
import styles from './spine.module.css'

const TONES: Record<StepMark, string> = {
  pending: 'var(--line)',
  clean: 'var(--line-strong)',
  active: 'var(--machine)',
  attention: 'var(--human)',
  failed: 'var(--fault)'
}

export function SpineMini({ marks }: { marks: StepMark[] }): ReactNode {
  if (marks.length === 0) return <span className={styles.mini} />
  return (
    <span className={styles.mini} aria-hidden="true">
      {marks.map((mark, index) => (
        <span key={index} className={styles.segment} style={{ ['--tone' as string]: TONES[mark] }} />
      ))}
    </span>
  )
}

interface SliceProps {
  mark: StepMark
  first: boolean
  last: boolean
}

export function SpineSlice({ mark, first, last }: SliceProps): ReactNode {
  const loud = mark === 'attention' || mark === 'failed' || mark === 'active'
  const classes = [styles.marker, loud ? styles.loud : '', mark === 'active' ? styles.active : '']
  return (
    <span className={styles.gutter} aria-hidden="true">
      {first ? null : <span className={`${styles.rail} ${styles.railTop}`} />}
      {last ? null : <span className={`${styles.rail} ${styles.railBottom}`} />}
      <span className={classes.filter(Boolean).join(' ')} style={{ ['--tone' as string]: TONES[mark] }} />
    </span>
  )
}

export function markTone(mark: StepMark): string {
  return TONES[mark]
}
