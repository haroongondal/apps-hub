import fs from 'node:fs'

export function parseEnvFile(raw: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const name = trimmed.slice(0, separator).replace(/^export\s+/, '').trim()
    if (!name) continue

    values[name] = unquote(trimmed.slice(separator + 1).trim())
  }

  return values
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted ? quoted[2]! : value
}

// An already-exported value wins, so a one-off shell override beats the file.
export function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return

  for (const [name, value] of Object.entries(parseEnvFile(fs.readFileSync(file, 'utf8')))) {
    if (process.env[name] === undefined) process.env[name] = value
  }
}
