import type { ReactNode } from 'react'
import type { BrowserState } from '../state/useBrowser'
import type { ExtensionState } from '../state/useExtension'
import { Button, Pill } from './ui'
import styles from './topbar.module.css'

interface TopBarProps {
  extension: ExtensionState
  browser: BrowserState
  running: boolean
  onPause: () => void
  onStop: () => void
}

export function TopBar({ extension, browser, running, onPause, onStop }: TopBarProps): ReactNode {
  return (
    <header className={styles.bar}>
      <span className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          <span className={styles.markSegment} />
          <span className={styles.markSegment} />
          <span className={styles.markSegment} />
        </span>
        Autonomous Browsing
      </span>
      <span className={styles.spacer} />
      <Pill tone={extension.connected ? 'var(--ok)' : 'var(--human)'}>
        {extension.connected ? 'Chrome connected' : 'Chrome not connected'}
      </Pill>
      {browser.supported ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={browser.running ? browser.close : browser.open}
          disabled={browser.working || running}
          title={
            browser.error
              ? browser.error
              : browser.running
                ? 'Close the automation browser'
                : 'Open the automation browser to sign into sites before a run'
          }
        >
          {browser.error ? 'Browser error' : browser.running ? 'Close browser' : 'Open browser'}
        </Button>
      ) : null}
      {running && !extension.paused ? (
        <span className={styles.controls}>
          <Button variant="secondary" size="sm" onClick={onPause} disabled={!extension.connected}>
            Pause
          </Button>
          <Button variant="danger" size="sm" onClick={onStop}>
            Stop run
          </Button>
        </span>
      ) : null}
    </header>
  )
}

interface HoldBannerProps {
  extension: ExtensionState
  onResume: () => void
  onStop: () => void
}

// role="alert" rather than "status": a hold has stalled the run and needs the
// person in their browser now, which is not something to announce politely.
export function HoldBanner({ extension, onResume, onStop }: HoldBannerProps): ReactNode {
  if (!extension.paused) return null
  return (
    <div className={styles.banner} role="alert" aria-live="assertive">
      <p className={styles.bannerText}>
        <span className={styles.bannerTitle}>{extension.holdAutomatic ? 'Needs you' : 'Paused'}</span>
        {extension.holdAutomatic
          ? `${extension.holdReason ?? 'A sensitive field is on the page'}. Finish this step in Chrome, then resume.`
          : `${extension.holdReason ?? 'Paused from the app'}. Resume when you are ready.`}
      </p>
      <Button variant="primary" size="sm" onClick={onResume}>
        Resume
      </Button>
      <Button variant="quiet" size="sm" onClick={onStop}>
        Stop run
      </Button>
    </div>
  )
}
