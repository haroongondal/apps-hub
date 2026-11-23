import { requireNativeModule } from 'expo';
import type { Kind, State, SuggestionRow } from '@apps-hub/autopilot-contract';

export interface Status {
  accessGranted: boolean;
  listenerConnected: boolean;
  lastCaptureAt: number | null;
  batteryUnrestricted: boolean;
  storeError: string | null;
  smsGranted: boolean;
}

export type AiKind = 'money' | 'message' | 'delivery' | 'bill' | 'reminder' | 'promotion' | 'account_alert' | 'other';

export interface AiInfo {
  kind: AiKind;
  summary: string;
  importance: 'high' | 'normal' | 'low';
  tags: string[];
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
  // The full email when it merged into this notification; text stays as captured.
  emailText: string | null;
  // What the AI made of it; null until it has been read. The original text is never changed.
  ai: AiInfo | null;
  mediaCount: number;
}

export interface MediaInfo {
  id: number;
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';
  mime: string;
  size: number;
}

export interface MediaStats {
  saved: number;
  bytes: number;
  unreadable: number;
  tooBig: number;
  lastMime: string | null;
}

export interface Todo {
  id: number;
  // The message the AI found it in; 0 for one the owner added by hand.
  itemId: number;
  text: string;
  dueAt: number | null;
  done: boolean;
}

export type ItemFilter =
  | { kind: 'all' }
  | { kind: 'app'; pkg: string }
  // Several packages that share one label (the merged rows of All apps).
  | { kind: 'apps'; pkgs: string[] }
  | { kind: 'conversation'; key: string }
  // One contact of one app: its chat, else its sender (the key a ContactRow carries).
  | { kind: 'contact'; pkg: string; key: string }
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
  label: string;
  // Newest first; more than one when same-label apps are merged (never for a contact app).
  pkgs: string[];
  lastAt: number;
  today: number;
  // SMS, Gmail, Teams and chat apps open a contact list; the rest open one list.
  byContact: boolean;
}

// One contact of one app, newest first.
export interface ContactRow {
  key: string;
  name: string;
  lastText: string;
  lastAt: number;
  today: number;
}

export interface HomeSummary {
  conversations: ConversationRow[];
  // Chat-like apps (byContact) with items of non-promotional contacts only; never capped.
  inbox: AppRow[];
  // Any visible item exists at all, in any app.
  hasItems: boolean;
  // High importance, last 7 days, newest first, at most 5.
  important: Item[];
  // Not done, due from the start of today (or undated, from the last 3 days), soonest first, at most 5.
  comingUp: Todo[];
}

export interface AppSetting {
  pkg: string;
  label: string;
  record: boolean;
  keepDays: number | null;
  // Only SMS and email apps are ever sent to the AI.
  aiEligible: boolean;
}

export interface SenderName {
  senderKey: string;
  sender: string;
  name: string;
}

export interface Txn {
  id: number;
  direction: 'in' | 'out';
  amount: number; // minor units
  currency: string;
  account: string;
  counterparty: string | null;
  txId: string | null;
  at: number;
  own: boolean;
  paired: boolean;
  itemIds: number[];
  category: string | null;
  // True when the owner chose the category; no AI path overwrites it.
  categorySet: boolean;
  // A clean name for the other side, set by the AI.
  label: string | null;
  // Found only by the AI (no bank pattern matched); counted in the totals.
  byAi: boolean;
}

export interface AccountTotal {
  account: string;
  currency: string;
  moneyIn: number;
  moneyOut: number;
  count: number;
}

// Own transfers are left out.
export interface MoneySummary {
  accounts: AccountTotal[];
  categories: CategoryTotal[];
  // Every person or shop, money in and out; own transfers are one row (own true, name null). name null otherwise = Unknown.
  parties: PartyTotal[];
}

export interface PartyTotal {
  name: string | null;
  own: boolean;
  currency: string;
  moneyIn: number;
  moneyOut: number;
  count: number;
}

// Money out only; own transfers are left out.
export interface CategoryTotal {
  category: string;
  currency: string;
  total: number;
  count: number;
}

export type ReportKind = 'weekly' | 'monthly';

export interface ReportRow {
  id: number;
  kind: ReportKind;
  periodStart: number;
  periodEnd: number;
  // The week so far, made by hand; replaced by the real report when due.
  partial: boolean;
  createdAt: number;
  // waiting: held back (daily AI limit); failed: gave up after its tries, Try again remakes it.
  status: 'ready' | 'waiting' | 'failed';
  message: string | null;
  // The notification line; null until ready.
  headline: string | null;
}

// Amounts are minor units, dates are YYYY-MM-DD local, share and change are percent numbers (change null = nothing to compare).
export interface ReportCurrency {
  currency: string;
  totals: { in: number; out: number; net: number; count: number };
  own: { in: number; out: number; transfers: { from: string; to: string; amount: number; date: string }[] };
  categories: { name: string; direction: 'in' | 'out'; amount: number; count: number; share: number; change: number | null }[];
  parties: { name: string; in: number; out: number; count: number }[];
  accounts: { name: string; in: number; out: number; count: number }[];
  daily: { date: string; out: number }[];
  largest: { date: string; name: string; amount: number; category: string }[];
  fees: { amount: number; count: number };
  cash: { amount: number; count: number };
}

export interface ReportData {
  currencies: ReportCurrency[];
  insights: string[];
}

export interface AiStatus {
  baseUrl: string;
  model: string;
  knownModel: string | null;
  // Only the last four characters of each key ever reach JS.
  keys: { id: number; ending: string }[];
  capUsd: number | null; // null = no limit
  spentTodayUsd: number;
  queued: number;
  lastRunAt: number | null;
  error: string | null;
  on: boolean;
}

export interface KnownModelInfo {
  name: string;
  baseUrl: string;
  model: string;
}

export interface GmailStatus {
  address: string | null;
  lastSyncAt: number | null;
  error: string | null;
  // Download emails from these senders (address or name substring, lowercase).
  senders: string[];
}

// What Autopilot may do, as Kotlin stores it (AutopilotSettings.toJson). Amounts are minor units (x100).
export interface AutopilotSettings {
  // The kinds of suggestion switched on.
  kinds: Kind[];
  // Money surprise: a debit is a surprise at multiple x the category median and at least minMinor, or at least hugeMinor on its own.
  multiple: number;
  minMinor: number;
  hugeMinor: number;
  // The chats picked for Autopilot, each as "pkg|conversationKey" (PickableChat.id).
  pickedChats: string[];
  // The apps Deputy may look in (package names); empty = the phone's contacts, maps, calendar and photos apps.
  lookIn: string[];
  bankApp: string | null;
  alarmBefore: boolean;
}

export interface PickableChat {
  // "pkg|conversationKey": the form AutopilotSettings.pickedChats holds.
  id: string;
  name: string;
  app: string;
}

// One local day from Health Connect; null = no data for that metric. hrLow is the lowest 5-minute average with at least 2 readings, not a medical measure.
export interface HealthDay {
  day: string; // YYYY-MM-DD
  steps: number | null;
  sleepMinutes: number | null;
  hrAvg: number | null;
  hrLow: number | null;
}

export interface HealthStatus {
  // missing: Health Connect is not on the phone; update: it needs an update first.
  availability: 'available' | 'missing' | 'update';
  steps: boolean;
  sleep: boolean;
  heartRate: boolean;
}

// Times are "HH:MM" local wall time, days ISO weekdays (Monday 1 to Sunday 7), dates YYYY-MM-DD. A stopped medicine (active false) keeps its history and has no new doses.
export interface Medicine {
  id: number;
  name: string;
  dose: string;
  times: string[];
  days: number[];
  startDay: string;
  endDay: string | null;
  active: boolean;
  createdAt: number;
}

// id null creates a new medicine.
export interface MedicineInput {
  id: number | null;
  name: string;
  dose: string;
  times: string[];
  days: number[];
  startDay: string;
  endDay: string | null;
}

// pending: due and still open to mark; upcoming: not due yet. A dose is open until 4 hours after it is due or the medicine's next dose (windowEnd).
export type DoseStatus = 'taken' | 'skipped' | 'missed' | 'pending' | 'upcoming';

export interface DoseRow {
  medicineId: number;
  dueAt: number;
  windowEnd: number;
  status: DoseStatus;
  markedAt: number | null; // null until marked
}

// Counts only. percent = taken / (taken + skipped + missed), null when nothing counted yet; streak in days. medicineId null = all medicines.
export interface AdherenceRow {
  medicineId: number | null;
  taken: number;
  skipped: number;
  missed: number;
  percent: number | null;
  streak: number;
}

export interface AdherenceReport {
  period: 'week' | 'month';
  fromDay: string;
  toDay: string;
  all: AdherenceRow;
  medicines: AdherenceRow[];
}

export type JournalTag = 'headache' | 'tired' | 'stomach ache' | 'cough' | 'pain' | 'anxious' | 'low mood' | 'poor sleep' | 'dizzy' | 'nausea';

export interface JournalEntry {
  id: number;
  at: number;
  mood: number; // 1 to 5
  tags: JournalTag[];
  note: string; // at most 2000 characters
}

// id null creates a new entry.
export interface JournalInput {
  id: number | null;
  at: number;
  mood: number;
  tags: JournalTag[];
  note: string;
}

export interface DoctorInclude {
  steps: boolean;
  sleep: boolean;
  heartRate: boolean;
  medicines: boolean;
  journal: boolean;
}

// text is exactly what doctorSummarize sends; error (plain words) when the range or the choice is not valid, then text and hash are null.
export interface DoctorPreview {
  text: string | null;
  hash: string | null;
  chars: number;
  error: string | null;
}

export interface DoctorSummary {
  summary: string | null;
  error: string | null;
}

export interface InflowCoreApi {
  getStatus(): Status;
  openNotificationAccess(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  reconnect(): void;
  authenticate(): Promise<{ ok: boolean; message: string | null }>;
  home(startOfDay: number): HomeSummary;
  // Every app, newest first; same-label apps that are not contact apps are merged.
  apps(startOfDay: number): AppRow[];
  // Newest first; before and beforeId are the postedAt and id of the last item shown, null for the first page.
  listItems(filter: ItemFilter, before: number | null, limit: number, beforeId: number | null): Item[];
  listApps(): AppSetting[];
  setRecord(pkg: string, record: boolean, deleteSaved: boolean): void;
  setKeep(pkg: string, days: number | null): void;
  renameSender(senderKey: string, name: string | null): void;
  listSenderNames(): SenderName[];
  // Inbox rows newer than the last import; the first call imports everything.
  importSms(): Promise<{ imported: number }>;
  // at >= from and at < to.
  money(from: number, to: number): MoneySummary;
  // Newest first, paged like listItems.
  listTxns(account: string | null, before: number | null, limit: number, beforeId: number | null): Txn[];
  setOwnTransfer(txnId: number, own: boolean): void;
  // Paged on the lastAt and key of the last row shown, null for the first page. promo false = the main list, true = the Promotions list only.
  contacts(pkg: string, startOfDay: number, before: number | null, beforeKey: string | null, limit: number, promo: boolean): ContactRow[];
  // The senders of this app that are folded into Promotions.
  promotions(pkg: string): { senders: number; lastAt: number | null };
  // null = the item is not an SMS item or is gone; otherwise whether its sender is in Promotions now.
  smsPromotion(itemId: number): boolean | null;
  // The owner's choice for one sender (key = item.conversationKey ?? item.senderKey); it wins over the automatic rule.
  setPromotion(key: string, promotional: boolean): void;
  // All time, per currency. own true = transfers between the owner's accounts (name ignored).
  partyTotals(name: string | null, own: boolean): { currency: string; moneyIn: number; moneyOut: number; count: number }[];
  // Newest first, paged like listTxns.
  listPartyTxns(name: string | null, own: boolean, before: number | null, limit: number, beforeId: number | null): Txn[];
  // null when the keep-for period removed the item.
  getItem(id: number): Item | null;
  // Removes the message with its AI result, to-dos and media; a later SMS or email import does not bring it back. False when it was already gone.
  deleteItem(id: number): boolean;
  // deleteItem for every message of one conversation (ConversationRow.key or Item.conversationKey). Returns how many were deleted.
  deleteConversation(key: string): number;
  // The owner's clean name for a transaction; null or blank clears it. Returns the error copy, or null once saved. The category is set with setCategory.
  setTxnLabel(txnId: number, label: string | null): string | null;
  // Removes the transaction; the messages it came from stay and are not read into a transaction again. False when it was already gone.
  deleteTxn(txnId: number): boolean;
  getOwnerName(): string | null;
  // Blank or null clears it.
  setOwnerName(name: string | null): void;
  gmailStatus(): GmailStatus;
  // Tests the sign-in, then saves it; seeds senders when the list is empty and starts a sync. The password never comes back to JS.
  connectGmail(address: string, appPassword: string): Promise<{ ok: boolean; message: string | null }>;
  // Forgets the address and password; keeps senders and saved emails.
  disconnectGmail(): void;
  // Trimmed and lowercased; blank is ignored.
  addGmailSender(query: string): void;
  // Keeps emails already saved.
  removeGmailSender(query: string): void;
  // Sends onCaptured when it imported anything.
  syncGmail(): Promise<{ imported: number }>;
  aiStatus(): AiStatus;
  knownModels(): KnownModelInfo[];
  // Returns the validation copy for a non-https address or a bad price, or null once saved. Null prices = the built-in ones.
  setAiModel(baseUrl: string, model: string, prices: { inputPerM: number; cachedPerM: number; outputPerM: number } | null): string | null;
  addAiKey(apiKey: string): string | null;
  removeAiKey(id: number): void;
  testAiKey(id: number): Promise<string | null>;
  // Returns the error copy for a limit outside 0.01 to 100, or null once saved.
  setAiCap(usd: number | null): string | null;
  sendAiNow(): Promise<{ sent: number; saved: number; stoppedByCap: boolean; error: string | null }>;
  setAiBlocked(blockKey: string, blocked: boolean): void;
  listAiBlocks(): string[];
  setTodoDone(id: number, done: boolean): void;
  // Done ones last when includeDone; the owner's own to-dos have itemId 0.
  listTodos(includeDone: boolean): Todo[];
  // Add and edit return the error copy for blank text, or null once saved. dueAt null = no date.
  addTodo(text: string, dueAt: number | null): string | null;
  updateTodo(id: number, text: string, dueAt: number | null): string | null;
  deleteTodo(id: number): void;
  ask(question: string): Promise<{ answer: string | null; error: string | null; from: number; to: number; items: number; txns: number }>;
  mediaFor(itemId: number): MediaInfo[];
  // Base64 of the decrypted bytes; only for images and stickers up to 8 MB, otherwise it throws.
  readMedia(mediaId: number): string;
  // Decrypts to a temporary file and opens it in another app.
  openMedia(mediaId: number): void;
  mediaStats(): MediaStats;
  galleryBetween(fromMs: number, toMs: number): Array<{ uri: string; takenAt: number }>;
  attachReceipt(itemId: number, uri: string): void;
  categories(): { out: string[]; in: string[] };
  // null = back to the AI's choice.
  setCategory(txnId: number, category: string | null): void;
  // Newest period first.
  listReports(): ReportRow[];
  getReport(id: number): { row: ReportRow; data: ReportData | null } | null;
  // Weekly, partial, the week so far.
  makeReportNow(): Promise<{ ok: boolean; message: string | null }>;
  retryReport(id: number): Promise<{ ok: boolean; message: string | null }>;
  notificationsAllowed(): boolean;
  askNotifications(): Promise<boolean>;
  // The report id from a tapped notification, cleared once read.
  takeOpenReport(): number | null;
  // Newest first, at most limit (200 at most); expired suggestions are swept first.
  suggestions(states: State[], limit: number): SuggestionRow[];
  // The owner's Run: the text to tell them when it could not start, null once it did.
  runSuggestion(id: number): string | null;
  skipSuggestion(id: number): void;
  autopilotSettings(): AutopilotSettings;
  // Bad values fall back to their defaults; a picked chat without a "|" is dropped.
  setAutopilotSettings(settings: AutopilotSettings): void;
  // Chats of messaging apps (not SMS or email, which already reach the AI), newest first, at most 200.
  pickableChats(): PickableChat[];
  healthStatus(): Promise<HealthStatus>;
  // Opens Health Connect's own screen; true when steps, sleep and heart rate are all allowed afterwards.
  requestHealthPermissions(): Promise<boolean>;
  // Reads the last `days` local days (clamped to 1..90; 30 is the usual) and replaces them in the store. days in the result = rows saved.
  refreshHealth(days: number): Promise<{ ok: boolean; message: string | null; days: number }>;
  // fromDay <= day <= toDay (YYYY-MM-DD), oldest first; days without data have no row.
  healthDays(fromDay: string, toDay: string): HealthDay[];
  // Stopped medicines last.
  medicines(): Medicine[];
  // Returns the problem in plain words, or null once saved. Works without the notification permission.
  saveMedicine(m: MedicineInput): string | null;
  stopMedicine(id: number): void;
  // Also deletes its dose history.
  deleteMedicine(id: number): void;
  // fromDay <= day <= toDay (at most a year), oldest first: every logged dose plus the scheduled ones not logged yet.
  dosesBetween(fromDay: string, toDay: string): DoseRow[];
  // Also later, as a correction (a missed dose can become taken); up to an hour before it is due. Returns the problem in plain words, or null once saved.
  markDose(medicineId: number, dueAt: number, status: 'taken' | 'skipped'): string | null;
  // week = the last 7 days, month = the last 30, today included.
  adherence(period: 'week' | 'month'): AdherenceReport;
  // False when notifications (askNotifications asks) or the medicine reminders channel are off.
  medicineRemindersAllowed(): boolean;
  // Newest first, at < beforeAt (null for the first page), at most limit (200 at most).
  journalList(beforeAt: number | null, limit: number): JournalEntry[];
  // Returns the problem in plain words, or null once saved.
  saveJournal(entry: JournalInput): string | null;
  deleteJournal(id: number): void;
  doctorPreview(fromDay: string, toDay: string, include: DoctorInclude): Promise<DoctorPreview>;
  // R12: refuses (error) when the data no longer hashes to the previewed hash. The summary is untrusted model text: show it as plain text only.
  doctorSummarize(fromDay: string, toDay: string, include: DoctorInclude, hash: string): Promise<DoctorSummary>;
  // false = the owner closed the file picker.
  saveDoctorPdf(summary: string, fromDay: string, toDay: string): Promise<boolean>;
  healthInAsk(): boolean;
  setHealthInAsk(on: boolean): void;
  addListener(event: 'onCaptured' | 'onSuggestions', listener: (e: { count: number }) => void): { remove(): void };
}

const InflowCore = requireNativeModule<InflowCoreApi>('InflowCore');

export const addCapturedListener = (cb: () => void): { remove(): void } => InflowCore.addListener('onCaptured', () => cb());

// count is the number of waiting suggestions.
export const addSuggestionsListener = (cb: () => void): { remove(): void } => InflowCore.addListener('onSuggestions', () => cb());

export { InflowCore };

export default InflowCore;
