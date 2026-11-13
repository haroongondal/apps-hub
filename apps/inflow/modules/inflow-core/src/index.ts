import { requireNativeModule } from 'expo';

export interface Status {
  accessGranted: boolean;
  listenerConnected: boolean;
  lastCaptureAt: number | null;
  batteryUnrestricted: boolean;
  storeError: string | null;
}

export interface Item {
  id: number;
  pkg: string;
  appLabel: string;
  sender: string | null;
  senderKey: string | null;
  displayName: string | null;
  conversation: string | null;
  conversationKey: string | null;
  title: string | null;
  text: string;
  postedAt: number;
  deletedBySender: boolean;
}

export type ItemFilter =
  | { kind: 'all' }
  | { kind: 'app'; pkg: string }
  | { kind: 'conversation'; key: string }
  | { kind: 'sender'; name: string }
  | { kind: 'search'; query: string };

export interface ConversationRow {
  key: string;
  pkg: string;
  appLabel: string;
  name: string;
  lastText: string;
  lastAt: number;
  today: number;
}

export interface AppRow {
  pkg: string;
  label: string;
  lastAt: number;
  today: number;
}

export interface HomeSummary {
  conversations: ConversationRow[];
  apps: AppRow[];
}

export interface AppSetting {
  pkg: string;
  label: string;
  record: boolean;
  keepDays: number | null;
}

export interface SenderName {
  senderKey: string;
  sender: string;
  name: string;
}

export interface InflowCoreApi {
  getStatus(): Status;
  openNotificationAccess(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  reconnect(): void;
  authenticate(): Promise<{ ok: boolean; message: string | null }>;
  home(startOfDay: number): HomeSummary;
  // Newest first; before and beforeId are the postedAt and id of the last item shown, null for the first page.
  listItems(filter: ItemFilter, before: number | null, limit: number, beforeId: number | null): Item[];
  listApps(): AppSetting[];
  setRecord(pkg: string, record: boolean, deleteSaved: boolean): void;
  setKeep(pkg: string, days: number | null): void;
  renameSender(senderKey: string, name: string | null): void;
  listSenderNames(): SenderName[];
  addListener(event: 'onCaptured', listener: (e: { count: number }) => void): { remove(): void };
}

const InflowCore = requireNativeModule<InflowCoreApi>('InflowCore');

export const addCapturedListener = (cb: () => void): { remove(): void } => InflowCore.addListener('onCaptured', () => cb());

export { InflowCore };

export default InflowCore;
