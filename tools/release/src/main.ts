import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  MANIFEST_PATH,
  SIGNING_CERT_SHA256,
  StoreManifestSchema,
  emptyManifest,
  nextVersionCode,
  upsertAndroidRelease,
  type StoreManifest,
} from '@apps-hub/store-manifest';
import { APPS } from './apps.ts';
import { applyAppsHubGradle, assembleRelease, inspectApk, sha256File } from './android.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENV_FILE = join(homedir(), '.config/apps-hub/release.env');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    platform: { type: 'string', default: 'android' },
    all: { type: 'boolean', default: false },
    changelog: { type: 'string', short: 'm', default: '' },
  },
});

const ids = values.all ? Object.keys(APPS) : positionals;
if (ids.length === 0 || ids.some((id) => !APPS[id])) {
  console.error(`usage: pnpm release <${Object.keys(APPS).join('|')}> [--platform android|ios|all] [--all] [-m changelog]`);
  process.exit(1);
}
if (values.platform !== 'android') {
  console.error('iOS releases need a paid Apple Developer Program membership (ad hoc OTA). See docs/app-store.md.');
  process.exit(1);
}

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
  // node:https has no headers timeout (fetch's undici gives up after 5 minutes, too short on a slow uplink).
  const data = typeof body === 'string' ? Buffer.from(body) : body;
  const { status, text } = await new Promise<{ status: number; text: string }>((resolveReq, reject) => {
    const req = httpsRequest(
      `${API}/admin/${key}`,
      { method: 'PUT', headers: { ...auth, 'content-type': contentType, 'content-length': data.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolveReq({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
      },
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.end(data);
  });
  if (status < 200 || status > 299) throw new Error(`PUT ${key}: ${status} ${text}`);
}

async function releaseAndroid(id: string, manifest: StoreManifest): Promise<StoreManifest> {
  const app = APPS[id];
  const appDir = resolve(ROOT, app.dir);
  for (const [cmd, ...args] of app.prepare ?? []) execFileSync(cmd, args, { cwd: appDir, stdio: 'inherit' });
  if (app.prebuild) {
    execFileSync('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], {
      cwd: appDir,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
  }
  const gradleFile = join(appDir, 'android/app/build.gradle');
  const gradle = readFileSync(gradleFile, 'utf8');
  const wired = applyAppsHubGradle(gradle);
  if (wired !== gradle) writeFileSync(gradleFile, wired);
  const versionName: string = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')).expo.version;
  const versionCode = nextVersionCode(manifest, id);
  console.log(`\n▶ ${id}: building ${versionName} (${versionCode})`);

  const apk = assembleRelease(appDir, versionCode, versionName);
  const info = inspectApk(apk);
  if (info.signers.length !== 1 || info.signers[0] !== SIGNING_CERT_SHA256) {
    throw new Error(`${id}: APK signed by [${info.signers}], expected ${SIGNING_CERT_SHA256}. Is ~/.gradle/gradle.properties set up?`);
  }
  if (info.packageName !== app.android.packageName || info.versionCode !== versionCode) {
    throw new Error(`${id}: APK is ${info.packageName}@${info.versionCode}, expected ${app.android.packageName}@${versionCode}`);
  }

  const bytes = readFileSync(apk);
  const apkPath = `apps/${id}/android/${versionCode}.apk`;
  const android = {
    packageName: info.packageName,
    versionCode,
    versionName,
    minSdk: info.minSdk,
    apkPath,
    sha256: await sha256File(apk),
    signingCertSha256: SIGNING_CERT_SHA256,
    sizeBytes: bytes.length,
  };
  console.log(`▶ ${id}: uploading ${apkPath} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  for (let attempt = 1; ; attempt++) {
    try {
      await upload(apkPath, bytes, 'application/vnd.android.package-archive');
      break;
    } catch (e) {
      if (attempt === 5) throw e;
      console.log(`  upload attempt ${attempt} failed (${(e as Error).message}), retrying`);
    }
  }
  // A slow upload leaves time for another release to publish; merge onto the live manifest, not the one read at the start.
  return upsertAndroidRelease(await fetchManifest(), { id, name: app.name, changelog: values.changelog }, android);
}

let manifest = await fetchManifest();
for (const id of ids) {
  manifest = await releaseAndroid(id, manifest);
  // Publish after each app so a later failure never strands an uploaded build.
  await upload(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`✔ ${id} ${manifest.apps.find((a) => a.id === id)?.android?.versionCode} published`);
}
