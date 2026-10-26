import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

export interface ApkInfo {
  packageName: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
}

export function parseBadging(out: string): ApkInfo {
  const pkg = out.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m);
  const minSdk = out.match(/^(?:minSdkVersion|sdkVersion):'(\d+)'/m);
  if (!pkg || !minSdk) throw new Error('could not parse `aapt2 dump badging` output');
  return { packageName: pkg[1], versionCode: Number(pkg[2]), versionName: pkg[3], minSdk: Number(minSdk[1]) };
}

export function parseSignerSha256(out: string): string[] {
  return [...out.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$/gm)].map((m) => m[1]);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const buildTools = () =>
  join(process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools', 'build-tools', '36.0.0');

export function inspectApk(apk: string): ApkInfo & { signers: string[] } {
  const badging = execFileSync(join(buildTools(), 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' });
  const certs = execFileSync(join(buildTools(), 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' });
  return { ...parseBadging(badging), signers: parseSignerSha256(certs) };
}

const SIGNING_BLOCK = `
        // Shared apps-hub release key; credentials live in ~/.gradle/gradle.properties (docs/app-store.md).
        if (findProperty('APPS_HUB_RELEASE_STORE_FILE')) {
            release {
                storeFile file(findProperty('APPS_HUB_RELEASE_STORE_FILE'))
                storePassword findProperty('APPS_HUB_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('APPS_HUB_RELEASE_KEY_ALIAS')
                keyPassword findProperty('APPS_HUB_RELEASE_KEY_PASSWORD')
            }
        }`;

/** Wires an Expo-template app/build.gradle to the shared release key and -PappsHubVersion* overrides. Idempotent. */
export function applyAppsHubGradle(src: string): string {
  if (src.includes('APPS_HUB_RELEASE_STORE_FILE')) return src;
  const steps: [RegExp, string][] = [
    [
      /^( +)versionCode (\d+)\n +versionName "([^"]*)"/m,
      `$1// tools/release passes these; plain builds keep the defaults.\n$1versionCode findProperty('appsHubVersionCode')?.toInteger() ?: $2\n$1versionName findProperty('appsHubVersionName') ?: "$3"`,
    ],
    [/(signingConfigs \{\n +debug \{[^}]*\})/, `$1${SIGNING_BLOCK}`],
    [
      /(release \{\n) +\/\/ Caution![^\n]*\n +\/\/ see [^\n]*\n( +)signingConfig signingConfigs\.debug/,
      `$1$2signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug`,
    ],
  ];
  return steps.reduce((text, [pattern, replacement]) => {
    if (!pattern.test(text)) throw new Error(`app/build.gradle no longer matches the Expo template (${pattern})`);
    return text.replace(pattern, replacement);
  }, src);
}

export function assembleRelease(appDir: string, versionCode: number, versionName: string): string {
  const androidDir = join(appDir, 'android');
  execFileSync(
    './gradlew',
    [':app:assembleRelease', `-PappsHubVersionCode=${versionCode}`, `-PappsHubVersionName=${versionName}`],
    {
      cwd: androidDir,
      stdio: 'inherit',
      env: { JAVA_HOME: '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', ...process.env },
    },
  );
  return join(androidDir, 'app/build/outputs/apk/release/app-release.apk');
}
