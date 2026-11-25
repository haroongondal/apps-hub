import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SIGNING_CERT_SHA256,
  upsertAndroidRelease,
  type AndroidRelease,
  type StoreManifest,
} from '@apps-hub/store-manifest';
import { APPS } from './apps.ts';
import { applyAppsHubGradle, assembleRelease, inspectApk, sha256File, type ApkInfo } from './android.ts';

/** The manifest's Android entry for one built APK. `commit` is the full git sha the APK was built from. */
export function androidEntry(a: {
  info: ApkInfo;
  versionName: string;
  apkPath: string;
  sha256: string;
  sizeBytes: number;
  commit: string;
  rolledBackFrom?: AndroidRelease['rolledBackFrom'];
}): AndroidRelease {
  return {
    packageName: a.info.packageName,
    versionCode: a.info.versionCode,
    versionName: a.versionName,
    minSdk: a.info.minSdk,
    apkPath: a.apkPath,
    sha256: a.sha256,
    signingCertSha256: SIGNING_CERT_SHA256,
    sizeBytes: a.sizeBytes,
    commit: a.commit,
    ...(a.rolledBackFrom ? { rolledBackFrom: a.rolledBackFrom } : {}),
  };
}

/** The build takes minutes; refuse to upload under a versionCode another release took meanwhile (the key would be overwritten). */
export function assertVersionStillFree(manifest: StoreManifest, id: string, versionCode: number): void {
  const published = manifest.apps.find((a) => a.id === id)?.android?.versionCode;
  if (published !== undefined && versionCode <= published) {
    throw new Error(`${id}: versionCode ${versionCode} was published by another release while this one was building. Nothing was uploaded; run it again.`);
  }
}

export interface ReleaseAndroidOptions {
  /** Checkout to build in: the repo root for a normal release, a temporary worktree for a rollback. */
  root: string;
  id: string;
  /** The live manifest: an upload can take long enough for another release to publish, so the entry is merged onto a fresh copy fetched after it. */
  fetchManifest: () => Promise<StoreManifest>;
  versionCode: number;
  changelog: string;
  /** Full sha of the commit checked out at `root`. */
  commit: string;
  /** Set for a rollback: the published release this build replaces. */
  rolledBackFrom?: AndroidRelease['rolledBackFrom'];
  upload: (key: string, body: Buffer | string, contentType: string) => Promise<void>;
}

export async function releaseAndroid(o: ReleaseAndroidOptions): Promise<StoreManifest> {
  const { id, versionCode } = o;
  const app = APPS[id];
  const appDir = resolve(o.root, app.dir);
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
  const android = androidEntry({ info, versionName, apkPath, sha256: await sha256File(apk), sizeBytes: bytes.length, commit: o.commit, rolledBackFrom: o.rolledBackFrom });
  assertVersionStillFree(await o.fetchManifest(), id, versionCode);
  console.log(`▶ ${id}: uploading ${apkPath} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  for (let attempt = 1; ; attempt++) {
    try {
      await o.upload(apkPath, bytes, 'application/vnd.android.package-archive');
      break;
    } catch (e) {
      if (attempt === 5) throw e;
      console.log(`  upload attempt ${attempt} failed (${(e as Error).message}), retrying`);
    }
  }
  return upsertAndroidRelease(await o.fetchManifest(), { id, name: app.name, changelog: o.changelog }, android);
}
