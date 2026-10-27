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
  | 'FAILURE_TIMEOUT'
  // Store's own stages, from the download job:
  | 'FAILURE_DOWNLOAD'
  | 'DOWNLOADED'
  | 'INSTALLING';

export interface InstallProgress {
  packageName: string;
  bytes: number;
  /** -1 when the server sent no length. */
  total: number;
}

export interface InstallStatusEvent {
  packageName: string | null;
  status: InstallStatusName;
  statusCode: number;
  message: string | null;
}

interface StoreInstallerApi {
  getInstalledVersion(packageName: string): InstalledVersion | null;
  /** Starts a background download + install; progress arrives as `onInstallProgress`, the outcome as `onInstallStatus`. */
  installApk(url: string, packageName: string, name: string, sha256: string, certSha256: string): void;
  getActiveInstalls(): Promise<InstallProgress[]>;
  canRequestPackageInstalls(): boolean;
  openInstallPermissionSettings(): void;
  setCredentials(apiUrl: string, token: string): void;
  getCredentials(): { apiUrl: string; token: string } | null;
  clearCredentials(): void;
  scheduleUpdateCheck(hours: number): void;
  getUpdateCheckHours(): number;
  addListener(event: 'onInstallStatus', listener: (e: InstallStatusEvent) => void): { remove(): void };
  addListener(event: 'onInstallProgress', listener: (e: InstallProgress) => void): { remove(): void };
}

export default requireNativeModule<StoreInstallerApi>('StoreInstaller');
