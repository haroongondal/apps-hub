import type { EmailRecoveryStatus, LostAccessState } from 'strongroom-vault';
import { hasCode, messageOf } from './call.ts';
import type { SyncTone } from './sync-flow.ts';

export type EmailRecoveryAction = 'turnOn' | 'enterCode' | 'turnOff' | 'cancel';
export type LostAccessAction = 'request' | 'enterCode';

export const EMAIL_DISCLOSURE: string[] = [
  'Whoever controls that inbox can start a recovery of your vault.',
  'Every recovery waits 24 hours before it can finish, and you can cancel it during that time.',
  'Recovery replaces your master password. Your recovery key stays the same.',
];

export const NEW_KEY_ESCROW_WARNING = 'A new recovery key turns email recovery off. You can turn it on again in Settings.';

const MAX_EMAIL = 320;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

// The same trim the native side applies, so a spaced or capitalised address passes here and there.
export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (e === '') return 'Enter your email address.';
  if (e.length > MAX_EMAIL) return "That email address is too long. Use one that's 320 characters or fewer.";
  return EMAIL_SHAPE.test(e) ? null : "That email address isn't valid. Check it and try again.";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Rounds up, so "in about 1 hour" never shows while 70 minutes remain.
function timeLeft(releaseAt: number, now: number): string {
  const minutes = Math.ceil((releaseAt - now) / 60_000);
  return minutes < 60 ? plural(minutes, 'minute', 'minutes') : plural(Math.ceil(minutes / 60), 'hour', 'hours');
}

export interface EmailRecoveryView {
  title: string;
  subtitle: string;
  tone: SyncTone;
  actions: EmailRecoveryAction[];
}

export function emailRecoveryView(s: EmailRecoveryStatus): EmailRecoveryView {
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
      tone: 'danger',
      actions: ['cancel', 'turnOff'],
    };
  }
  if (s.waitingForCode) {
    return { title: 'Enter the code we emailed', subtitle: 'Email recovery turns on once you type the code from your inbox. If it never arrives, turn email recovery off and try again.', tone: 'warn', actions: ['enterCode', 'turnOff'] };
  }
  if (s.enrolled) return { title: 'Email recovery is on', subtitle: 'If you lose both your master password and your recovery key, you can recover your vault with a code sent to your email.', tone: 'ok', actions: ['turnOff'] };
  if (s.wasTurnedOff) {
    return { title: 'Email recovery is off', subtitle: 'It was turned off, for example by making a new recovery key. Turn it on again to use it.', tone: 'warn', actions: ['turnOn'] };
  }
  return { title: 'Email recovery is off', subtitle: 'Turn it on to recover your vault with a code sent to your email if you lose both your master password and your recovery key.', tone: 'neutral', actions: ['turnOn'] };
}

export interface Notice {
  title: string;
  body: string;
}

// Only a confirmed request (releaseAt is a number) warns: an unconfirmed one can't progress without the owner's inbox.
export function pendingBanner(s: EmailRecoveryStatus | null, now: number): Notice | null {
  const releaseAt = s?.pendingRecovery?.releaseAt;
  if (typeof releaseAt !== 'number') return null;
  return {
    title: 'Someone asked to recover your vault',
    body:
      releaseAt > now
        ? `If that was you, do nothing. If it wasn't, cancel it now. The wait ends in about ${timeLeft(releaseAt, now)}, and then the code we emailed can open your vault.`
        : "The 24-hour wait is over, so the code we emailed can now open your vault. If that wasn't you, cancel it now.",
  };
}

export function lostAccessView(s: LostAccessState, now: number): Notice & { actions: LostAccessAction[] } {
  switch (s.state) {
    case 'none':
      return {
        title: 'I also lost my recovery key',
        body: 'Strongroom emails a code to the address you set up for email recovery. You then wait 24 hours, which gives the real owner time to cancel.',
        actions: ['request'],
      };
    case 'waiting':
      if (s.releaseAt === null) return { title: 'Check your email', body: 'Open the link we emailed you to start the 24-hour wait, then come back here.', actions: [] };
      return {
        title: 'Waiting for the 24 hours to pass',
        body: s.releaseAt > now ? `Your vault can be recovered in about ${timeLeft(s.releaseAt, now)}. Come back then.` : 'The wait is over. Open this screen again in a moment to continue.',
        actions: [],
      };
    default:
      return { title: 'Enter your code', body: 'The wait is over. Enter the code we emailed you and choose a new master password.', actions: ['enterCode'] };
  }
}

const MESSAGES: Record<string, string> = {
  BAD_EMAIL: "That email address isn't valid. Check it and try again.",
  SYNC_OFF: 'Turn on sync first. Email recovery keeps its copy on your vault server.',
  SYNC_FIRST: "This phone has changes it hasn't synced yet. Choose Sync now, then try again.",
  LOST_STILL_ALIVE: 'A recovery request is already under way. Check your email for the link, or wait for the 24 hours to pass.',
  LOST_NOT_READY: "The 24-hour wait isn't over yet. Try again once it ends.",
  LOST_DIFFERENT_ACCOUNT: "That code belongs to a different vault account. Check that you're using the code from the latest email.",
};

export function explainRecovery(e: unknown): string {
  for (const code of Object.keys(MESSAGES)) if (hasCode(e, code)) return MESSAGES[code];
  return messageOf(e);
}
