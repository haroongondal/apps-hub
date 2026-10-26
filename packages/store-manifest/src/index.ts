import { z } from 'zod';

/** SHA-256 of the shared apps-hub release signing cert (~/.config/apps-hub/release.jks). Public; pinned by the store. */
export const SIGNING_CERT_SHA256 = 'e3af4a92b1e858ede650bf53521c9be86702036100b2dc07393a262748d0317d';

export const MANIFEST_PATH = 'manifest.json';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256');

export const AndroidReleaseSchema = z.object({
  packageName: z.string().min(1),
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1),
  minSdk: z.number().int().positive(),
  apkPath: z.string().min(1),
  sha256: hex64,
  signingCertSha256: hex64,
  sizeBytes: z.number().int().positive(),
});

export const IosReleaseSchema = z.object({
  bundleId: z.string().min(1),
  buildNumber: z.string().regex(/^\d+$/),
  versionName: z.string().min(1),
  ipaPath: z.string().min(1),
  manifestPlistPath: z.string().min(1),
  sha256: hex64,
});

export const StoreAppSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  iconUrl: z.url().optional(),
  changelog: z.string(),
  android: AndroidReleaseSchema.optional(),
  ios: IosReleaseSchema.optional(),
});

export const StoreManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  apps: z.array(StoreAppSchema),
});

export type AndroidRelease = z.infer<typeof AndroidReleaseSchema>;
export type IosRelease = z.infer<typeof IosReleaseSchema>;
export type StoreApp = z.infer<typeof StoreAppSchema>;
export type StoreManifest = z.infer<typeof StoreManifestSchema>;

export function emptyManifest(now = new Date()): StoreManifest {
  return { schemaVersion: 1, generatedAt: now.toISOString(), apps: [] };
}

export function nextVersionCode(manifest: StoreManifest, appId: string): number {
  const current = manifest.apps.find((a) => a.id === appId)?.android?.versionCode ?? 1;
  return current + 1;
}

export function upsertAndroidRelease(
  manifest: StoreManifest,
  app: { id: string; name: string; changelog: string },
  android: AndroidRelease,
  now = new Date(),
): StoreManifest {
  const existing = manifest.apps.find((a) => a.id === app.id);
  if (existing?.android && android.versionCode <= existing.android.versionCode) {
    throw new Error(`${app.id}: versionCode ${android.versionCode} must exceed published ${existing.android.versionCode}`);
  }
  const updated: StoreApp = { ...existing, ...app, android };
  const apps = existing ? manifest.apps.map((a) => (a.id === app.id ? updated : a)) : [...manifest.apps, updated];
  return StoreManifestSchema.parse({ ...manifest, generatedAt: now.toISOString(), apps });
}
