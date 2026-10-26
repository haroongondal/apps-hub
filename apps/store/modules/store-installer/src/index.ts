import { requireNativeModule } from 'expo';

export interface InstalledVersion {
  versionCode: number;
  versionName: string | null;
  /** Installer of record (null if sideloaded via adb/file manager on some OEMs). */
  installer: string | null;
  signingCertSha256: string[];
}

export type InstallStatusName =
  | 'SUCCESS'
  | 'PENDING_USER_ACTION'
  | 'FAILURE'
  | 'FAILURE_ABORTED'
  | 'FAILURE_BLOCKED'
  | 'FAILURE_CONFLICT'
  | 'FAILURE_INCOMPATIBLE'
  | 'FAILURE_INVALID'
  | 'FAILURE_STORAGE'
  | 'FAILURE_TIMEOUT';

export interface InstallStatusEvent {
  packageName: string | null;
  status: InstallStatusName;
  statusCode: number;
  message: string | null;
}

interface StoreInstallerApi {
  getInstalledVersion(packageName: string): InstalledVersion | null;
  /** Resolves with the PackageInstaller session id once committed; the outcome arrives as `onInstallStatus`. */
  installApk(url: string, packageName: string, sha256: string, certSha256: string): Promise<number>;
  canRequestPackageInstalls(): boolean;
  openInstallPermissionSettings(): void;
  setCredentials(apiUrl: string, token: string): void;
  getCredentials(): { apiUrl: string; token: string } | null;
  clearCredentials(): void;
  scheduleUpdateCheck(hours: number): void;
  getUpdateCheckHours(): number;
  addListener(event: 'onInstallStatus', listener: (e: InstallStatusEvent) => void): { remove(): void };
}

export default requireNativeModule<StoreInstallerApi>('StoreInstaller');
