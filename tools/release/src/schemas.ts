import { execFileSync } from 'node:child_process';

// Per app: where its on-device database version lives; schemas.test.ts keeps `version` and the file list honest.
export type SchemaSource =
  | { kind: 'const'; db: string; file: string; pattern: RegExp; version: number }
  | { kind: 'steps'; db: string; file: string; name: string; version: number }
  | { kind: 'unversioned'; db: string; file: string; why: string };

export const SCHEMAS: Record<string, SchemaSource[]> = {
  netlens: [
    { kind: 'const', db: 'devices (expo-sqlite)', file: 'apps/netlens/src/db/device-store-sqlite.ts', pattern: /PRAGMA user_version = (\d+)/g, version: 2 },
  ],
  'open-tunnel': [
    { kind: 'const', db: 'firewall.db', file: 'apps/open_tunnel_vpn/modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/FirewallStore.kt', pattern: /const val DB_VERSION = (\d+)/g, version: 1 },
    { kind: 'unversioned', db: 'opentunnel.sqlite3 (expo-sqlite)', file: 'apps/open_tunnel_vpn/src/data/open-database.ts', why: 'a node cache and settings created with IF NOT EXISTS, no version number' },
  ],
  'pdf-editor': [
    { kind: 'steps', db: 'library.db track library', file: 'packages/library-core/src/schema.ts', name: 'LIBRARY_STEPS', version: 5 },
    { kind: 'steps', db: 'library.db track scan', file: 'packages/scan-core/src/schema.ts', name: 'SCAN_STEPS', version: 1 },
    { kind: 'steps', db: 'library.db track knowledge', file: 'packages/knowledge-core/src/schema.ts', name: 'KNOWLEDGE_STEPS', version: 6 },
    { kind: 'unversioned', db: 'library.db (expo-sqlite)', file: 'apps/pdf-editor-mobile/src/library/open-library.ts', why: 'opens the file; its versions are the three tracks above' },
  ],
  'design-editor': [],
  store: [],
  deputy: [],
  halo: [],
  'ai-hub': [],
  strongroom: [
    { kind: 'const', db: 'strongroom.db', file: 'apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/android/SqliteRecordStore.kt', pattern: /const val VERSION = (\d+)/g, version: 2 },
  ],
  inflow: [
    { kind: 'const', db: 'Inflow archive (SQLCipher)', file: 'apps/inflow/modules/inflow-core/android/src/main/java/expo/modules/inflowcore/android/SqlItemStore.kt', pattern: /private const val SCHEMA_VERSION = (\d+)/g, version: 10 },
  ],
  clipboard: [
    { kind: 'const', db: 'clips.db', file: 'apps/clipboard/modules/clipboard-core/android/src/main/java/expo/modules/clipboardcore/android/ClipStore.kt', pattern: /"clips\.db", null, (\d+)\)/g, version: 2 },
  ],
};

// shortcut: counts plain string literals only (no `${}`, no spreads); a step list never uses them, so upgrade if one does.
export function countSteps(text: string, name: string): number | null {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\[`).exec(text);
  if (!m) return null;
  let n = 0;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const c = text[i];
    if (c === ']') return n;
    if (c === '`' || c === "'" || c === '"') {
      n++;
      for (i++; i < text.length && text[i] !== c; i += text[i] === '\\' ? 2 : 1);
    } else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const end = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i);
      if (end < 0) return null;
      i = end;
    }
  }
  return null;
}

export function readVersion(text: string, source: SchemaSource): number | null {
  if (source.kind === 'steps') return countSteps(text, source.name);
  if (source.kind !== 'const') return null;
  const found = [...text.matchAll(new RegExp(source.pattern.source, 'g'))].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : null;
}

export type SchemaVerdict = 'ok' | 'newer' | 'unknown';

export interface SchemaCheck {
  app: string;
  db: string;
  target: number | null;
  current: number | null;
  verdict: SchemaVerdict;
}

type Read = { present: false } | { present: true; version: number | null };

function readAt(repoDir: string, sha: string, source: SchemaSource): Read {
  if (source.kind === 'unversioned') return { present: false };
  let text: string;
  try {
    text = execFileSync('git', ['show', `${sha}:${source.file}`], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return { present: false };
  }
  return { present: true, version: readVersion(text, source) };
}

export function checkSchemas(repoDir: string, id: string, toCommit: string, currentRef: string): SchemaCheck[] {
  const out: SchemaCheck[] = [];
  for (const source of SCHEMAS[id] ?? []) {
    if (source.kind === 'unversioned') continue;
    const cur = readAt(repoDir, currentRef, source);
    const tgt = readAt(repoDir, toCommit, source);
    const current = cur.present ? cur.version : null;
    const target = tgt.present ? tgt.version : null;
    let verdict: SchemaVerdict = 'ok';
    if (cur.present && tgt.present) {
      if (current === null || target === null) verdict = 'unknown';
      else if (target < current) verdict = 'newer';
    } else if (cur.present && current === null) verdict = 'unknown';
    out.push({ app: id, db: source.db, target, current, verdict });
  }
  return out;
}
