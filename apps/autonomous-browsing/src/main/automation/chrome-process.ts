import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface ChromeEndpoint {
  port: number
  pid: number
}

export interface ChromeProcessIo {
  exists(file: string): boolean
  read(file: string): string
  write(file: string, content: string): void
  remove(file: string): void
  mkdir(dir: string): void
  spawn(command: string, args: string[]): number
  alive(pid: number): boolean
  kill(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void
  httpOk(url: string): Promise<boolean>
  httpJson(url: string): Promise<unknown>
  delay(ms: number): Promise<void>
  now(): number
}

const LAUNCH_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 5_000
const POLL_MS = 150

const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`
  ]
}

const realIo: ChromeProcessIo = {
  exists: (file) => fs.existsSync(file),
  read: (file) => fs.readFileSync(file, 'utf8'),
  write: (file, content) => fs.writeFileSync(file, content),
  remove: (file) => fs.rmSync(file, { force: true }),
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  spawn: (command, args) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    if (child.pid === undefined) throw new Error(`could not start ${command}`)
    return child.pid
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  },
  httpOk: async (url) => {
    try {
      const response = await fetch(url)
      return response.ok
    } catch {
      return false
    }
  },
  httpJson: async (url) => {
    try {
      const response = await fetch(url)
      return response.ok ? await response.json() : null
    } catch {
      return null
    }
  },
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
}

export class ChromeProcess {
  constructor(
    private readonly profileDir: string,
    private readonly endpointFile: string,
    private readonly io: ChromeProcessIo = realIo,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: string = process.platform,
    private readonly extraArgs: string[] = []
  ) {}

  executable(): string {
    const override = this.env['AUTOMATION_CHROME_PATH']
    if (override) return override
    const candidates = CHROME_CANDIDATES[this.platform] ?? []
    for (const candidate of candidates) {
      if (this.io.exists(candidate)) return candidate
    }
    throw new Error(
      `no Chrome found — set AUTOMATION_CHROME_PATH, or install Google Chrome (looked at: ${candidates.join(', ')})`
    )
  }

  async adopt(): Promise<ChromeEndpoint | null> {
    if (!this.io.exists(this.endpointFile)) return null
    const endpoint = this.parseEndpoint()
    if (!endpoint || !this.io.alive(endpoint.pid) || !(await this.io.httpOk(this.versionUrl(endpoint.port)))) {
      this.io.remove(this.endpointFile)
      return null
    }
    if (await this.hasOpenPage(endpoint.port)) return endpoint

    // Chrome outlives its last window still answering /json/version, but with the profile gone no session works.
    await this.stop(endpoint)
    return null
  }

  async launch(): Promise<ChromeEndpoint> {
    this.io.mkdir(this.profileDir)
    const portFile = path.join(this.profileDir, 'DevToolsActivePort')
    this.io.remove(portFile)

    const pid = this.io.spawn(this.executable(), [
      `--user-data-dir=${this.profileDir}`,
      '--remote-debugging-port=0',
      // Remote debugging alone sets navigator.webdriver, and Google's sign-in refuses a browser
      // that reports it — "This browser or app may not be secure". Measured on Chrome 151.
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      ...this.extraArgs,
      'about:blank'
    ])

    const deadline = this.io.now() + LAUNCH_TIMEOUT_MS
    while (this.io.now() < deadline) {
      const port = this.readPort(portFile)
      if (port !== null && (await this.io.httpOk(this.versionUrl(port))) && (await this.hasOpenPage(port))) {
        const endpoint = { port, pid }
        this.io.write(this.endpointFile, JSON.stringify(endpoint))
        return endpoint
      }
      if (!this.io.alive(pid)) {
        throw new Error(
          'Chrome exited before it was ready — if another Chrome already uses the automation profile, close it and try again'
        )
      }
      await this.io.delay(POLL_MS)
    }
    this.io.kill(pid, 'SIGKILL')
    throw new Error(`Chrome did not expose its DevTools endpoint within ${LAUNCH_TIMEOUT_MS / 1000}s`)
  }

  async stop(endpoint: ChromeEndpoint): Promise<void> {
    this.io.kill(endpoint.pid, 'SIGTERM')
    const deadline = this.io.now() + STOP_TIMEOUT_MS
    while (this.io.alive(endpoint.pid) && this.io.now() < deadline) {
      await this.io.delay(POLL_MS)
    }
    if (this.io.alive(endpoint.pid)) this.io.kill(endpoint.pid, 'SIGKILL')
    this.io.remove(this.endpointFile)
  }

  // Best-effort synchronous stop for app teardown, where nothing can await.
  killNow(endpoint: ChromeEndpoint): void {
    this.io.kill(endpoint.pid, 'SIGTERM')
    this.io.remove(this.endpointFile)
  }

  private readPort(portFile: string): number | null {
    if (!this.io.exists(portFile)) return null
    const port = Number.parseInt(this.io.read(portFile), 10)
    return Number.isInteger(port) && port > 0 ? port : null
  }

  private async hasOpenPage(port: number): Promise<boolean> {
    const targets = await this.io.httpJson(this.targetsUrl(port))
    if (!Array.isArray(targets)) return false
    return targets.some((target: unknown) => {
      if (typeof target !== 'object' || target === null) return false
      return (target as Record<string, unknown>)['type'] === 'page'
    })
  }

  private parseEndpoint(): ChromeEndpoint | null {
    try {
      const parsed: unknown = JSON.parse(this.io.read(this.endpointFile))
      if (typeof parsed !== 'object' || parsed === null) return null
      const { port, pid } = parsed as Record<string, unknown>
      if (!Number.isInteger(port) || !Number.isInteger(pid)) return null
      return { port: port as number, pid: pid as number }
    } catch {
      return null
    }
  }

  private versionUrl(port: number): string {
    return `http://127.0.0.1:${port}/json/version`
  }

  private targetsUrl(port: number): string {
    return `http://127.0.0.1:${port}/json/list`
  }
}
