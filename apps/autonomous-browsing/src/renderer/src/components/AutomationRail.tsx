import { useState, type ReactNode } from 'react'
import { requiredParams } from '../../../shared/routines'
import type { RoutineDefinition, SystemRoutine, UserRoutine } from '../../../shared/types'
import type { AutomationsState } from '../state/useAutomations'
import type { StartRoutineInput } from '../state/useRuns'
import { Button, EmptyState, Eyebrow, Field } from './ui'
import shell from './app.module.css'
import styles from './automations.module.css'

interface RailProps {
  automations: AutomationsState
  canRun: boolean
  pendingRepairs: Map<string, number>
  onRun: (input: StartRoutineInput) => void
  onNewGoal: () => void
  onReview: (routineId: string) => void
  onExport: (kind: 'system' | 'user', id: string) => void
  onImport: () => void
}

export function AutomationRail({
  automations,
  canRun,
  pendingRepairs,
  onRun,
  onNewGoal,
  onReview,
  onExport,
  onImport
}: RailProps): ReactNode {
  return (
    <nav className={shell.rail} aria-label="Automations">
      <div className={shell.railHeader}>
        <Eyebrow>Automations</Eyebrow>
      </div>
      <div className={shell.railBody}>
        <span className={styles.topActions}>
          <Button variant="secondary" className={styles.newGoal} onClick={onNewGoal}>
            New from a goal
          </Button>
          <Button variant="quiet" size="sm" onClick={onImport}>
            Import a file
          </Button>
        </span>

        {automations.syncErrors.length > 0 ? (
          <ul className={styles.syncErrors}>
            {automations.syncErrors.map((message) => (
              <li key={message} className={styles.syncError}>
                {message}
              </li>
            ))}
          </ul>
        ) : null}

        <Group
          title="Built in"
          count={automations.builtIn.length}
          action={
            <Button variant="quiet" size="sm" onClick={automations.reload}>
              Reload
            </Button>
          }
        >
          {automations.builtIn.length === 0 ? (
            <EmptyState title="No built-in automations">
              Drop a routine JSON file into <code>updates/</code> and it appears here.
            </EmptyState>
          ) : (
            automations.builtIn.map((routine) => (
              <AutomationRow
                key={routine.id}
                routine={routine}
                kind="system"
                canRun={canRun}
                pending={0}
                onRun={onRun}
                onReview={onReview}
                onExport={onExport}
              />
            ))
          )}
        </Group>

        <Group title="Yours" count={automations.yours.length}>
          {automations.yours.length === 0 ? (
            <EmptyState title="Nothing saved yet">
              Describe a goal, then save what the run recorded as an automation you can replay.
            </EmptyState>
          ) : (
            automations.yours.map((routine) => (
              <AutomationRow
                key={routine.id}
                routine={routine}
                kind="user"
                canRun={canRun}
                pending={pendingRepairs.get(routine.id) ?? 0}
                onRun={onRun}
                onReview={onReview}
                onExport={onExport}
                onDelete={async () => {
                  await window.api.user.remove(routine.id)
                }}
              />
            ))
          )}
        </Group>
      </div>
    </nav>
  )
}

interface GroupProps {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
}

function Group({ title, count, action, children }: GroupProps): ReactNode {
  return (
    <section className={styles.group}>
      <div className={styles.groupHeader}>
        <Eyebrow>{title}</Eyebrow>
        <span className={styles.groupTail}>
          {count > 0 ? <span className={shell.count}>{count}</span> : null}
          {action}
        </span>
      </div>
      {children}
    </section>
  )
}

interface RowProps {
  routine: SystemRoutine | UserRoutine
  kind: 'system' | 'user'
  canRun: boolean
  pending: number
  onRun: (input: StartRoutineInput) => void
  onReview: (routineId: string) => void
  onExport: (kind: 'system' | 'user', id: string) => void
  onDelete?: () => Promise<void>
}

function AutomationRow({
  routine,
  kind,
  canRun,
  pending,
  onRun,
  onReview,
  onExport,
  onDelete
}: RowProps): ReactNode {
  const [params, setParams] = useState(() => defaultParams(routine.definition))
  const [missing, setMissing] = useState<string[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const specs = Object.entries(routine.definition.params ?? {})

  const run = (): void => {
    const blank = requiredParams(routine.definition, params)
    setMissing(blank)
    if (blank.length > 0) return
    onRun({ kind, id: routine.id, params, name: routine.name })
  }

  const problem =
    missing.length === 0
      ? null
      : `Fill in ${missing.map((name) => label(routine.definition, name)).join(', ')} before running this.`

  return (
    <article className={styles.row}>
      <h3 className={styles.name}>{routine.name}</h3>
      {routine.description ? <p className={styles.description}>{routine.description}</p> : null}

      {pending > 0 ? (
        <button type="button" className={styles.pending} onClick={() => onReview(routine.id)}>
          {pending === 1 ? '1 repair to review' : `${pending} repairs to review`}
        </button>
      ) : null}

      {specs.length > 0 ? (
        <div className={styles.params}>
          {specs.map(([name, spec]) => (
            <Field
              key={name}
              label={spec.description ?? name}
              required={spec.required}
              invalid={missing.includes(name)}
              value={params[name] ?? ''}
              onChange={(value) => {
                setMissing((current) => current.filter((missed) => missed !== name))
                setParams((current) => ({ ...current, [name]: value }))
              }}
            />
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={run} disabled={!canRun}>
          Run
        </Button>
        <span className={styles.grow} />
        {confirmingDelete ? null : (
          <Button variant="quiet" size="sm" onClick={() => onExport(kind, routine.id)}>
            Export
          </Button>
        )}
        {onDelete && !confirmingDelete ? (
          <Button variant="quiet" size="sm" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        ) : null}
        {onDelete && confirmingDelete ? (
          <>
            <span className={styles.hint}>Delete for good?</span>
            <Button variant="danger" size="sm" onClick={() => void onDelete()}>
              Delete
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </>
        ) : null}
      </div>

      {problem ? <p className={styles.rowError}>{problem}</p> : null}
    </article>
  )
}

function label(definition: RoutineDefinition, name: string): string {
  return definition.params?.[name]?.description ?? name
}

// Defaults are values, not placeholders: a placeholder looks like a filled field
// and then submits empty.
function defaultParams(definition: RoutineDefinition): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, spec] of Object.entries(definition.params ?? {})) values[name] = spec.default ?? ''
  return values
}
