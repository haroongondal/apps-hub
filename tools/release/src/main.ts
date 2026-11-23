import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MANIFEST_PATH, StoreManifestSchema, emptyManifest, nextVersionCode, type StoreManifest } from '@apps-hub/store-manifest';
import { APPS } from './apps.ts';
import { checkReleasable, readHead } from './guard.ts';
import { releaseAndroid } from './release-android.ts';
import { formatPlan, installDeps, planRollback, storeTarget, withWorktree } from './rollback.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENV_FILE = join(homedir(), '.config/apps-hub/release.env');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    platform: { type: 'string', default: 'android' },
    all: { type: 'boolean', default: false },
    changelog: { type: 'string', short: 'm', default: '' },
    'from-branch': { type: 'boolean', default: false },
    rollback: { type: 'boolean', default: false },
    to: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const ids = values.all ? Object.keys(APPS) : positionals;
if (ids.length === 0 || ids.some((id) => !APPS[id])) {
  console.error(`usage: pnpm release <${Object.keys(APPS).join('|')}> [--platform android|ios|all] [--all] [-m changelog] [--from-branch]\n       pnpm release <app> --rollback [--to <sha|tag>] [--dry-run] [-m changelog] [--from-branch]`);
  process.exit(1);
}
if (values.rollback ? ids.length !== 1 || values.all : values['dry-run'] || values.to) {
  console.error('--rollback takes exactly one app (no --all). --to and --dry-run only work with --rollback.');
  process.exit(1);
}
if (values.platform !== 'android') {
  console.error('iOS releases need a paid Apple Developer Program membership (ad hoc OTA). See docs/app-store.md.');
  process.exit(1);
}

const guard = checkReleasable(ROOT, { fromBranch: values['from-branch'] });
if (!guard.ok) {
  console.error(guard.reason);
  process.exit(1);
}
if (guard.warning) console.error(guard.warning);
const withBranchTag = (text: string) => (guard.warning ? `[branch build ${guard.head.slice(0, 7)}] ${text}` : text);
const changelog = withBranchTag(values.changelog);

process.loadEnvFile(ENV_FILE);
const API = process.env.STORE_API_URL?.replace(/\/$/, '');
const TOKEN = process.env.RELEASE_TOKEN;
if (!API || !TOKEN) throw new Error(`STORE_API_URL and RELEASE_TOKEN must be set in ${ENV_FILE}`);
const auth = { authorization: `Bearer ${TOKEN}` };

async function fetchManifest(): Promise<StoreManifest> {
  const res = await fetch(`${API}/${MANIFEST_PATH}`, { headers: auth });
  if (res.status === 404) return emptyManifest();
  if (!res.ok) throw new Error(`GET manifest: ${res.status} ${await res.text()}`);
  return StoreManifestSchema.parse(await res.json());
}

async function upload(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const res = await fetch(`${API}/admin/${key}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': contentType },
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`);
}

let manifest = await fetchManifest();

if (values.rollback) {
  const id = ids[0];
  const plan = planRollback({ repoDir: ROOT, id, manifest, to: values.to });
  console.log(formatPlan(plan, storeTarget(API)));
  if (values['dry-run']) process.exit(0);
  // The rebuilt old commit gets a NEW, higher versionCode: Android refuses an install over a higher one.
  console.log(`\nBuilding ${plan.toCommit.slice(0, 7)} in a temporary worktree (pnpm install first).`);
  manifest = await withWorktree(ROOT, plan.toCommit, async (root) => {
    installDeps(root);
    return releaseAndroid({
      root,
      id,
      manifest,
      versionCode: plan.newVersionCode,
      changelog: values.changelog ? changelog : withBranchTag(plan.changelog),
      commit: plan.toCommit,
      upload,
    });
  });
  await upload(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`✔ ${id} rolled back to ${plan.toVersionName} as ${plan.newVersionCode} published`);
  process.exit(0);
}

const commit = readHead(ROOT);
for (const id of ids) {
  manifest = await releaseAndroid({ root: ROOT, id, manifest, versionCode: nextVersionCode(manifest, id), changelog, commit, upload });
  // Publish after each app so a later failure never strands an uploaded build.
  await upload(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`✔ ${id} ${manifest.apps.find((a) => a.id === id)?.android?.versionCode} published`);
}
