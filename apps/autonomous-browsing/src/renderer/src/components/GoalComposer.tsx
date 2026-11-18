import { useState, type ReactNode, type RefObject } from 'react'
import { Button } from './ui'
import styles from './composer.module.css'

interface ComposerProps {
  canSend: boolean
  connected: boolean
  queuedBehind: string | null
  onSend: (goal: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}

export function GoalComposer({ canSend, connected, queuedBehind, onSend, inputRef }: ComposerProps): ReactNode {
  const [goal, setGoal] = useState('')

  const send = (): void => {
    const trimmed = goal.trim()
    if (!trimmed || !canSend) return
    setGoal('')
    onSend(trimmed)
  }

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <label className={styles.field}>
        <span className={styles.hint}>
          {connected
            ? 'Describe a goal and Claude drives Chrome one step at a time. Enter sends, Shift+Enter adds a line.'
            : 'Chrome is not connected, so a goal cannot run yet.'}
        </span>
        {queuedBehind ? <span className={styles.queued}>{queuedBehind}</span> : null}
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={2}
          value={goal}
          placeholder="Find the cheapest return flight to Lisbon next month"
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            send()
          }}
        />
      </label>
      <Button type="submit" variant="primary" disabled={!canSend || !goal.trim()}>
        Start
      </Button>
    </form>
  )
}
