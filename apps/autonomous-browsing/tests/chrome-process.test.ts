import { describe, expect, it } from 'vitest'
import { ChromeProcess, type ChromeProcessIo } from '../src/main/automation/chrome-process'

const PROFILE = '/data/profile'
const ENDPOINT_FILE = '/data/endpoint.json'
const PORT_FILE = '/data/profile/DevToolsActivePort'

interface FakeOptions {
  files?: Record<string, string>
  livePids?: number[]
  httpPorts?: number[]
  pagePorts?: number[]
  onSpawn?: (world: FakeWorld) => number
}

interface FakeWorld {
  io: ChromeProcessIo
  files: Map<string, string>
  livePids: Set<number>
  httpPorts: Set<number>
  pagePorts: Set<number>
  spawns: Array<{ command: string; args: string[] }>
  kills: Array<{ pid: number; signal: string }>
}

function fakeIo(options: FakeOptions = {}): FakeWorld {
  const files = new Map(Object.entries(options.files ?? {}))
  const livePids = new Set(options.livePids ?? [])
  const httpPorts = new Set(options.httpPorts ?? [])
  const pagePorts = new Set(options.pagePorts ?? [])
  const spawns: FakeWorld['spawns'] = []
  const kills: FakeWorld['kills'] = []
  let clock = 0

  const world: FakeWorld = {
    files,
    livePids,
    httpPorts,
    pagePorts,
    spawns,
    kills,
    io: {
      exists: (file) => files.has(file),
      read: (file) => {
        const content = files.get(file)
        if (content === undefined) throw new Error(`no such file: ${file}`)
        return content
      },
      write: (file, content) => void files.set(file, content),
      remove: (file) => void files.delete(file),
      mkdir: () => {},
      spawn: (command, args) => {
        spawns.push({ command, args })
        return options.onSpawn ? options.onSpawn(world) : 4242
      },
      alive: (pid) => livePids.has(pid),
      kill: (pid, signal) => {
        kills.push({ pid, signal })
        if (signal === 'SIGKILL') livePids.delete(pid)
      },
      httpOk: async (url) => {
        const port = Number(new URL(url).port)
        return httpPorts.has(port)
      },
      httpJson: async (url) => {
        const port = Number(new URL(url).port)
        if (!httpPorts.has(port)) return null
        const background = { type: 'background_page', id: 'b1' }
        return pagePorts.has(port) ? [background, { type: 'page', id: 'p1' }] : [background]
      },
      delay: async () => {
        clock += 200
      },
      now: () => clock
    }
  }
  return world
}

function chrome(world: FakeWorld, env: NodeJS.ProcessEnv = {}, platform = 'darwin'): ChromeProcess {
  return new ChromeProcess(PROFILE, ENDPOINT_FILE, world.io, env, platform)
}

describe('finding the Chrome binary', () => {
  it('prefers AUTOMATION_CHROME_PATH over anything on disk', () => {
    const world = fakeIo({ files: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '' } })
    expect(chrome(world, { AUTOMATION_CHROME_PATH: '/opt/my-chrome' }).executable()).toBe('/opt/my-chrome')
  })

  it('takes the first installed candidate for the platform', () => {
    const world = fakeIo({ files: { '/usr/bin/chromium': '' } })
    expect(chrome(world, {}, 'linux').executable()).toBe('/usr/bin/chromium')
  })

  it('names the paths it looked at when nothing is installed', () => {
    expect(() => chrome(fakeIo()).executable()).toThrow(/AUTOMATION_CHROME_PATH.*Google Chrome\.app/s)
  })
})

describe('adopting an already-running browser', () => {
  it('returns the endpoint when the recorded process is alive and answering', async () => {
    const world = fakeIo({
      files: { [ENDPOINT_FILE]: JSON.stringify({ port: 9333, pid: 77 }) },
      livePids: [77],
      httpPorts: [9333],
      pagePorts: [9333]
    })
    expect(await chrome(world).adopt()).toEqual({ port: 9333, pid: 77 })
    expect(world.kills).toEqual([])
  })

  it('reaps a browser whose last window closed, instead of adopting one no session can attach to', async () => {
    const world = fakeIo({
      files: { [ENDPOINT_FILE]: JSON.stringify({ port: 9333, pid: 77 }) },
      livePids: [77],
      httpPorts: [9333]
    })

    expect(await chrome(world).adopt()).toBeNull()
    expect(world.kills[0]).toEqual({ pid: 77, signal: 'SIGTERM' })
    expect(world.files.has(ENDPOINT_FILE)).toBe(false)
  })

  it('returns null without touching anything when no endpoint was recorded', async () => {
    const world = fakeIo()
    expect(await chrome(world).adopt()).toBeNull()
    expect(world.kills).toEqual([])
  })

  it('cleans a stale record for a dead process instead of adopting it', async () => {
    const world = fakeIo({ files: { [ENDPOINT_FILE]: JSON.stringify({ port: 9333, pid: 77 }) } })
    expect(await chrome(world).adopt()).toBeNull()
    expect(world.files.has(ENDPOINT_FILE)).toBe(false)
  })

  it('does not adopt a live pid whose DevTools endpoint stopped answering — the pid may be recycled', async () => {
    const world = fakeIo({
      files: { [ENDPOINT_FILE]: JSON.stringify({ port: 9333, pid: 77 }) },
      livePids: [77]
    })
    expect(await chrome(world).adopt()).toBeNull()
    expect(world.files.has(ENDPOINT_FILE)).toBe(false)
    expect(world.kills).toEqual([])
  })

  it('treats an unparseable record as stale', async () => {
    const world = fakeIo({ files: { [ENDPOINT_FILE]: 'not json' } })
    expect(await chrome(world).adopt()).toBeNull()
    expect(world.files.has(ENDPOINT_FILE)).toBe(false)
  })
})

describe('launching a fresh browser', () => {
  it('spawns on the profile, reads the port Chrome chose, and records the endpoint', async () => {
    const world = fakeIo({
      files: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '' },
      livePids: [4242],
      httpPorts: [9444],
      pagePorts: [9444],
      onSpawn: (w) => {
        w.files.set(PORT_FILE, '9444\n/devtools/browser/abc')
        return 4242
      }
    })

    const endpoint = await chrome(world).launch()

    expect(endpoint).toEqual({ port: 9444, pid: 4242 })
    expect(world.spawns[0]?.args).toContain(`--user-data-dir=${PROFILE}`)
    expect(world.spawns[0]?.args).toContain('--remote-debugging-port=0')
    expect(JSON.parse(world.files.get(ENDPOINT_FILE) ?? '{}')).toEqual({ port: 9444, pid: 4242 })
  })

  it('launches with AutomationControlled disabled, so the browser is not branded as a webdriver', async () => {
    const world = fakeIo({
      files: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '' },
      livePids: [4242],
      httpPorts: [9444],
      pagePorts: [9444],
      onSpawn: (w) => {
        w.files.set(PORT_FILE, '9444\n/devtools/browser/abc')
        return 4242
      }
    })

    await chrome(world).launch()

    expect(world.spawns[0]?.args).toContain('--disable-blink-features=AutomationControlled')
  })

  it('removes a stale DevToolsActivePort before spawning, so an old port cannot be read back', async () => {
    const world = fakeIo({
      files: {
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '',
        [PORT_FILE]: '1111'
      },
      livePids: [4242],
      httpPorts: [9444],
      pagePorts: [9444],
      onSpawn: (w) => {
        expect(w.files.has(PORT_FILE)).toBe(false)
        w.files.set(PORT_FILE, '9444\n/devtools/browser/abc')
        return 4242
      }
    })

    expect(await chrome(world).launch()).toEqual({ port: 9444, pid: 4242 })
  })

  it('waits for the first page target, so a status check right after opening cannot reap the new browser', async () => {
    const world = fakeIo({
      files: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '' },
      livePids: [4242],
      httpPorts: [9444],
      onSpawn: (w) => {
        w.files.set(PORT_FILE, '9444\n/devtools/browser/abc')
        return 4242
      }
    })
    const waitForPort = world.io.delay
    let polls = 0
    world.io.delay = async (ms) => {
      polls += 1
      if (polls === 3) world.pagePorts.add(9444)
      await waitForPort(ms)
    }

    expect(await chrome(world).launch()).toEqual({ port: 9444, pid: 4242 })
    expect(polls).toBe(3)
  })

  it('explains a launch that dies immediately as a profile already in use', async () => {
    const world = fakeIo({
      files: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': '' },
      onSpawn: () => 4242
    })

    await expect(chrome(world).launch()).rejects.toThrow(/close it and try again/)
  })
})

describe('stopping the browser it launched', () => {
  it('terminates gracefully and forgets the endpoint', async () => {
    const world = fakeIo({ files: { [ENDPOINT_FILE]: '{"port":9444,"pid":88}' } })
    world.livePids.add(88)
    world.io.kill = (pid, signal) => {
      world.kills.push({ pid, signal })
      world.livePids.delete(pid)
    }

    await chrome(world).stop({ port: 9444, pid: 88 })

    expect(world.kills).toEqual([{ pid: 88, signal: 'SIGTERM' }])
    expect(world.files.has(ENDPOINT_FILE)).toBe(false)
  })

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const world = fakeIo({ livePids: [88] })

    await chrome(world).stop({ port: 9444, pid: 88 })

    expect(world.kills[0]).toEqual({ pid: 88, signal: 'SIGTERM' })
    expect(world.kills.at(-1)).toEqual({ pid: 88, signal: 'SIGKILL' })
  })
})
