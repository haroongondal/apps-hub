import { useState, type ReactNode } from 'react'
import { redact, type Secret } from '../../../shared/routine-review'
import type { RoutineFile } from '../../../shared/types'
import { plural } from '../lib/format'
import { Button, Eyebrow } from './ui'
import shell from './app.module.css'
import styles from './files.module.css'

export interface Outgoing {
  file: RoutineFile
  secrets: Secret[]
}

interface ExportReviewProps {
  outgoing: Outgoing
  problem: string | null
  writing: boolean
  onWrite: (file: RoutineFile) => void
  onCancel: () => void
}

export function ExportReview({
  outgoing,
  problem,
  writing,
  onWrite,
  onCancel
}: ExportReviewProps): ReactNode {
  const [hide, setHide] = useState<number[]>(() => outgoing.secrets.map((_, at) => at))
  const chosen = outgoing.secrets.filter((_, at) => hide.includes(at))

  return (
    <>
      <header className={styles.header}>
        <Eyebrow>Export</Eyebrow>
        <h2 className={styles.title}>{outgoing.file.name}</h2>
        <div className={styles.meta}>
          {plural(outgoing.file.definition.steps.length, 'step')}
          <span className={styles.separator}>·</span>
          saved as a JSON file you can read and share
        </div>
      </header>

      <div className={shell.detailBody}>
        <div className={styles.body}>
          {outgoing.secrets.length === 0 ? (
            <p className={styles.plain}>
              Nothing in this automation holds text you typed, so there is nothing to strip out.
            </p>
          ) : (
            <section className={styles.section}>
              <Eyebrow>Text that will be in the file</Eyebrow>
              <p className={styles.plain}>
                Anything you leave in is readable by whoever opens the file. Stripping one replaces it
                with a blank the other person fills in themselves.
              </p>
              <ul className={styles.list}>
                {outgoing.secrets.map((secret, at) => (
                  <li key={at} className={styles.secretRow}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={hide.includes(at)}
                        onChange={(event) =>
                          setHide((current) =>
                            event.target.checked ? [...current, at] : current.filter((i) => i !== at)
                          )
                        }
                      />
                      <span className={styles.secretWhere}>{whereLabel(secret)}</span>
                    </label>
                    <code className={hide.includes(at) ? styles.struck : styles.kept}>{secret.value}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {problem ? (
            <div className={styles.problem} role="alert">
              <p>{problem}</p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={writing}
              onClick={() => onWrite(chosen.length > 0 ? redact(outgoing.file, chosen) : outgoing.file)}
            >
              {chosen.length > 0 ? `Strip ${plural(chosen.length, 'value')} and save` : 'Save the file'}
            </Button>
            <Button variant="quiet" onClick={onCancel} disabled={writing}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

function whereLabel(secret: Secret): string {
  if (secret.where === 'description') return 'Description'
  if (secret.where === 'param') return `Default for ${secret.name}`
  return `Typed at ${secret.name}`
}
