import { SIGNING_CERT_SHA256, type StoreApp } from '@apps-hub/store-manifest';

export const STORE_PACKAGE = 'com.haroon.store';

export interface Installed {
  versionCode: number;
  versionName: string | null;
  installer: string | null;
  signingCertSha256: string[];
}

export interface AppStatus {
  kind: 'unavailable' | 'not-installed' | 'installed' | 'update';
  label: string;
  action: 'Install' | 'Update' | 'Reinstall' | null;
  warning?: string;
}

export function appStatus(app: StoreApp, installed: Installed | null): AppStatus {
  const release = app.android;
  if (!release) return { kind: 'unavailable', label: 'No Android build', action: null };
  if (!installed) return { kind: 'not-installed', label: 'Not installed', action: 'Install' };

  const current = `v${installed.versionName ?? '?'} (${installed.versionCode})`;
  if (!installed.signingCertSha256.includes(SIGNING_CERT_SHA256)) {
    return {
      kind: 'installed',
      label: `Installed ${current}`,
      action: null,
      warning: 'Signed with a different key. Uninstall it once, then install it from here.',
    };
  }
  const foreign =
    release.packageName !== STORE_PACKAGE && installed.installer !== STORE_PACKAGE
      ? 'Not installed by Store: the next update asks once, later ones are silent.'
      : undefined;
  if (installed.versionCode < release.versionCode) {
    return {
      kind: 'update',
      label: `Update: ${current} → v${release.versionName} (${release.versionCode})`,
      action: 'Update',
      warning: foreign,
    };
  }
  return { kind: 'installed', label: `Installed ${current}`, action: foreign ? 'Reinstall' : null, warning: foreign };
}
