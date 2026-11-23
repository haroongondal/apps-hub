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
  };
}

export interface ReleaseAndroidOptions {
  /** Checkout to build in: the repo root for a normal release, a temporary worktree for a rollback. */
  root: string;
  id: string;
  manifest: StoreManifest;
  versionCode: number;
  changelog: string;
  /** Full sha of the commit checked out at `root`. */
  commit: string;
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
  const android = androidEntry({ info, versionName, apkPath, sha256: await sha256File(apk), sizeBytes: bytes.length, commit: o.commit });
  const next = upsertAndroidRelease(o.manifest, { id, name: app.name, changelog: o.changelog }, android);
  console.log(`▶ ${id}: uploading ${apkPath} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  await o.upload(apkPath, bytes, 'application/vnd.android.package-archive');
  return next;
}
