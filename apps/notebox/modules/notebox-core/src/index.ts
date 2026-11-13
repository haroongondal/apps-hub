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

export interface NoteboxCoreApi {
  getStatus(): Status;
  openNotificationAccess(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  reconnect(): void;
  authenticate(): Promise<{ ok: boolean; message: string | null }>;
  home(startOfDay: number): HomeSummary;
  // Newest first; before is the postedAt of the last item already shown, null for the first page.
  listItems(filter: ItemFilter, before: number | null, limit: number): Item[];
  listApps(): AppSetting[];
  setRecord(pkg: string, record: boolean, deleteSaved: boolean): void;
  setKeep(pkg: string, days: number | null): void;
  renameSender(senderKey: string, name: string | null): void;
  listSenderNames(): SenderName[];
  addListener(event: 'onCaptured', listener: (e: { count: number }) => void): { remove(): void };
}

const NoteboxCore = requireNativeModule<NoteboxCoreApi>('NoteboxCore');

export const addCapturedListener = (cb: () => void): { remove(): void } => NoteboxCore.addListener('onCaptured', () => cb());

export { NoteboxCore };

export default NoteboxCore;
