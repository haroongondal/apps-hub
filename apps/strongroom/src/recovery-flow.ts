import type { EmailRecoveryStatus, LostAccessState } from 'strongroom-vault';
import { hasCode, messageOf } from './call.ts';
import type { SyncTone } from './sync-flow.ts';

export type EmailRecoveryAction = 'turnOn' | 'enterCode' | 'turnOff' | 'cancel' | 'newKey';
export type LostAccessAction = 'request' | 'enterCode';

export const EMAIL_DISCLOSURE: string[] = [
  'Whoever controls that inbox can start a recovery of your vault.',
  'Every recovery waits 24 hours before it can finish, and you can cancel it during that time.',
  'Recovery replaces your master password. Your recovery key stays the same.',
  'Keep the email we send now: its code is needed for the last step of a recovery.',
];

export const NEW_KEY_ESCROW_WARNING = 'A new recovery key turns email recovery off. You can turn it on again in Settings.';

const MAX_EMAIL = 320;
// The Worker's own check (escrowOf in tools/vault-api), so nothing passes here that it would answer 400.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The same trim the native side applies, so a spaced or capitalised address passes here and there.
export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (e === '') return 'Enter your email address.';
  if (e.length > MAX_EMAIL) return "That email address is too long. Use one that's 320 characters or fewer.";
  return EMAIL_SHAPE.test(e) ? null : "That email address isn't valid. Check it and try again.";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Rounds down, so a warning never promises a longer cancel window than there is.
function timeLeft(releaseAt: number, now: number): string {
  const hours = Math.floor((releaseAt - now) / 3_600_000);
  return hours < 1 ? 'less than an hour' : `about ${plural(hours, 'hour', 'hours')}`;
}

export interface EmailRecoveryView {
  title: string;
  subtitle: string;
  tone: SyncTone;
  actions: EmailRecoveryAction[];
}

// keyUnseen is local, so it warns whatever the server could or couldn't say; the other actions stay as the state offers them.
export function emailRecoveryView(s: EmailRecoveryStatus): EmailRecoveryView {
  const v = stateView(s);
  if (!s.keyUnseen) return v;
  return {
    title: "Your recovery key changed but you haven't saved it",
    subtitle: 'Make a new one now and write it down. Until you do, you may have no recovery key that works.',
    tone: 'danger',
    actions: ['newKey', ...v.actions],
  };
}

function stateView(s: EmailRecoveryStatus): EmailRecoveryView {
  if (!s.available) return { title: "Email recovery isn't available in this build.", subtitle: 'This build has no vault server to keep it with.', tone: 'neutral', actions: [] };
  if (!s.checked) {
    return { title: 'Email recovery', subtitle: "Couldn't check email recovery. Make sure this phone is online, then open this screen again.", tone: 'warn', actions: [] };
  }
  if (s.pendingRecovery !== null) {
    const confirmed = s.pendingRecovery.releaseAt !== null;
    return {
      title: 'A recovery was requested',
      subtitle: confirmed
        ? "Someone asked to recover your vault by email. If that wasn't you, cancel it now."
        : "A recovery was requested, but nothing happens until the link in the email is opened. If that wasn't you, cancel it.",
      tone: confirmed ? 'danger' : 'warn',
      actions: ['cancel', 'turnOff'],
    };
  }
  if (s.waitingForCode) {
    return { title: 'Enter the code we emailed', subtitle: 'Email recovery turns on once you type the code from your inbox. If it never arrives, turn email recovery off and try again.', tone: 'warn', actions: ['enterCode', 'turnOff'] };
  }
  if (s.enrolled) return { title: 'Email recovery is on', subtitle: 'If you lose both your master password and your recovery key, you can ask for a recovery by email. Keep the email we sent when you turned this on: its code is needed to finish.', tone: 'ok', actions: ['turnOff'] };
  if (s.wasTurnedOff) {
    return { title: 'Email recovery is off', subtitle: 'It was turned off, for example by making a new recovery key. Turn it on again to use it.', tone: 'warn', actions: ['turnOn'] };
  }
  return { title: 'Email recovery is off', subtitle: 'Turn it on to ask for a recovery by email if you lose both your master password and your recovery key. We send one email with a code now. Keep it, because the code is needed to finish a recovery.', tone: 'neutral', actions: ['turnOn'] };
}

export interface Notice {
  title: string;
  body: string;
}

// Only a confirmed request (releaseAt is a number) warns: an unconfirmed one can't progress without the owner's inbox.
export function pendingBanner(s: EmailRecoveryStatus | null, now: number): Notice | null {
  const releaseAt = s?.checked ? s.pendingRecovery?.releaseAt : null;
  if (typeof releaseAt !== 'number') return null;
  return {
    title: 'Someone asked to recover your vault',
    body:
      releaseAt > now
        ? `If that was you, do nothing. If it wasn't, cancel it now. The wait ends in ${timeLeft(releaseAt, now)}, and then the code we emailed can open your vault.`
        : "The 24-hour wait is over, so the code we emailed can now open your vault. If that wasn't you, cancel it now.",
  };
}

const clock = (ms: number) => new Date(ms).toLocaleString();

export function lostAccessView(s: LostAccessState, now: number, format: (ms: number) => string = clock): Notice & { actions: LostAccessAction[] } {
  switch (s.state) {
    case 'none':
      return {
        title: 'I also lost my recovery key',
        body: 'Strongroom emails you a link. Open it to start a 24-hour wait, which gives the real owner time to cancel. To finish you also need the code from the email sent when email recovery was turned on.',
        actions: ['request'],
      };
    case 'waiting':
      if (s.releaseAt === null) return { title: 'Check your email', body: 'Open the link we emailed you to start the 24-hour wait, then come back here.', actions: [] };
      return {
        title: 'Waiting for the 24 hours to pass',
        body: s.releaseAt > now ? `Your vault can be recovered at ${format(s.releaseAt)}, in ${timeLeft(s.releaseAt, now)}. Come back then.` : 'The wait is over. Open this screen again in a moment to continue.',
        actions: [],
      };
    default:
      return { title: 'Enter your code', body: 'The wait is over. Enter the code from the email sent when you turned on email recovery, and choose a new master password.', actions: ['enterCode'] };
  }
}

const MESSAGES: Record<string, string> = {
  BAD_EMAIL: "That email address isn't valid. Check it and try again.",
  SYNC_OFF: 'Turn on sync first. Email recovery keeps its copy on your vault server.',
  SYNC_FIRST: "This phone has changes it hasn't synced yet. Choose Sync now, then try again.",
  LOST_STILL_ALIVE: 'A recovery request is already counting down on this account. Wait for it to finish, or cancel it from a device that is signed in.',
  LOST_NOT_READY: "The 24-hour wait isn't over yet. Try again once it ends.",
  LOST_DIFFERENT_ACCOUNT: "This phone is already set up with another Strongroom account, so it can't open this vault. Use a phone or a fresh install that has no Strongroom account.",
};

export function explainRecovery(e: unknown): string {
  for (const code of Object.keys(MESSAGES)) if (hasCode(e, code)) return MESSAGES[code];
  return messageOf(e);
}
