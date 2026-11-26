type Row = { id: string; name: string; username: string; totp?: boolean };
type Candidates = { locked: boolean; rows: Row[]; gated?: boolean };
type TotpState = { code: string; secondsLeft: number; period: number };

const MENU_CSS = `
  .menu { font: 13px system-ui, sans-serif; background: #fff; color: #1a1a1a; border: 1px solid #a21cafaa; border-radius: 8px;
    box-shadow: 0 6px 20px #0004; overflow: hidden; }
  button { display: block; width: 100%; text-align: left; padding: 8px 12px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  button:hover { background: #f5e6f7; }
  b { font-weight: 600; } span { opacity: .7; }
  @media (prefers-color-scheme: dark) { .menu { background: #1d1d20; color: #f2f2f2; } button:hover { background: #3a2640; } }`;

const send = async <T>(message: object): Promise<T | null> => {
  try {
    const reply = await chrome.runtime.sendMessage(message);
    return reply?.ok ? (reply.data as T) : null;
  } catch {
    return null; // the service worker is starting or the extension was reloaded
  }
};

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
};
const passwordFields = () => [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(visible);
const isUserField = (el: Element): el is HTMLInputElement =>
  el instanceof HTMLInputElement && ['text', 'email', 'tel'].includes(el.type) && !el.disabled && !el.readOnly && visible(el);

// DESIGN §15.2's bounded keyword heuristic, mirroring FormDetector.kt (including its Roman-Urdu words).
// "security code" and "card code" are excluded with the CVC words: they are payment fields, not codes.
const OTP_WORD = /(^|[^a-z0-9])(code|otp|pin|verification|2\s?fa|confirmation|tasdeeq|tasdiq|tasdeek)([^a-z0-9]|$)/i;
const OTP_NOT = /(^|[^a-z0-9])(cvc|cvv|csc|card|postal|post|zip|country|area|security)([^a-z0-9]|$)/i;
const camelLower = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

function fieldText(el: HTMLInputElement): string {
  const parts = [el.name, el.id, el.getAttribute('aria-label') ?? '', el.placeholder];
  for (const id of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) parts.push(document.getElementById(id)?.textContent ?? '');
  if (el.labels) for (const label of el.labels) parts.push(label.textContent ?? '');
  return parts.join(' ');
}

/** autocomplete="one-time-code" first, then a named code box that is numeric or 4–8 characters long. */
function isOtpField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement) || el.type === 'password' || el.disabled || el.readOnly || !visible(el)) return false;
  if (!['text', 'tel', 'number'].includes(el.type)) return false;
  const text = camelLower(fieldText(el));
  if (OTP_NOT.test(text)) return false;
  if (el.autocomplete.split(/\s+/).some((token) => token.toLowerCase() === 'one-time-code')) return true;
  if (!OTP_WORD.test(text)) return false;
  const numeric = el.type === 'number' || el.inputMode === 'numeric'
    || /(\[0-9\]|\\d|0-9)/.test(el.getAttribute('pattern') ?? '');
  return numeric || (el.maxLength >= 4 && el.maxLength <= 8);
}

const otpFields = (scope: ParentNode) =>
  [...scope.querySelectorAll<HTMLInputElement>('input')].filter((field): field is HTMLInputElement => isOtpField(field));
const formScope = (field: HTMLInputElement): ParentNode => field.form ?? document;
const grouped = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}`
  : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code);

function usernameFor(pw: HTMLInputElement): HTMLInputElement | null {
  const before = [...(pw.form ?? document).querySelectorAll('input')].filter(isUserField)
    .filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  return before.at(-1) ?? null;
}

function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillForm(username: string, password: string, near?: HTMLInputElement): ParentNode {
  const all = passwordFields();
  const pw = (near && all.find((p) => p === near || usernameFor(p) === near)) ?? all[0];
  const user = pw ? usernameFor(pw) : near && isUserField(near) ? near : null;
  if (user && username) setValue(user, username);
  if (pw) setValue(pw, password);
  return pw?.form ?? near?.form ?? document;
}

/** §15.2: a chosen login's code targets every otp field in that form, never another form on the page. */
function fillCodes(state: TotpState | null, scope: ParentNode) {
  if (!state) return;
  for (const field of otpFields(scope)) setValue(field, state.code);
}

let menu: HTMLElement | null = null;
let menuField: HTMLInputElement | null = null;
let menuVisible = false;
let watcher: IntersectionObserver | null = null;

function hideMenu() {
  watcher?.disconnect();
  watcher = null;
  menuVisible = false;
  menu?.remove();
  menu = null;
  menuField = null;
}

function showMenu(field: HTMLInputElement, items: { html: [string, string]; run: () => void }[]) {
  hideMenu();
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = MENU_CSS;
  const list = document.createElement('div');
  list.className = 'menu';
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    const [strong, rest] = item.html;
    const b = document.createElement('b');
    b.textContent = strong;
    const span = document.createElement('span');
    span.textContent = rest;
    button.append(b, ' ', span);
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.isTrusted && menuVisible) item.run();
    });
    list.append(button);
  }
  root.append(style, list);
  const r = field.getBoundingClientRect();
  Object.assign(host.style, { position: 'fixed', top: `${r.bottom + 2}px`, left: `${r.left}px`, minWidth: `${Math.max(r.width, 220)}px`, zIndex: '2147483647' });
  document.documentElement.append(host);
  menu = host;
  menuField = field;
  // Intersection Observer v2 reports isVisible=false when the page hides, fades or covers the menu; clicks are ignored until it says true.
  watcher = new IntersectionObserver((entries) => { menuVisible = (entries.at(-1) as (IntersectionObserverEntry & { isVisible?: boolean }) | undefined)?.isVisible === true; }, { threshold: 0.1, trackVisibility: true, delay: 100 } as IntersectionObserverInit);
  watcher.observe(host);
}

async function offerLogins(field: HTMLInputElement) {
  const found = await send<Candidates>({ type: 'candidates' });
  if (!found || document.activeElement !== field || field.value !== '') return;
  if (found.locked) return showMenu(field, [{ html: ['Strongroom is locked', 'Click to unlock'], run: () => void send({ type: 'openPopup' }) }]);
  if (found.rows.length === 0) return;
  showMenu(field, found.rows.map((row) => ({
    html: [row.name, row.username],
    run: async () => {
      const creds = await send<{ username: string; password: string; code: TotpState | null }>({ type: 'fill', id: row.id });
      hideMenu();
      if (creds) fillCodes(creds.code, fillForm(creds.username, creds.password, field));
    },
  })));
}

async function offerCodes(field: HTMLInputElement) {
  const found = await send<Candidates>({ type: 'candidates' });
  if (!found || document.activeElement !== field || field.value !== '') return;
  if (found.locked) return showMenu(field, [{ html: ['Strongroom is locked', 'Click to unlock'], run: () => void send({ type: 'openPopup' }) }]);
  const coded = found.rows.filter((row) => row.totp);
  if (coded.length === 0) return;
  // With the fingerprint on every code fetch asks for a touch, so nothing is previewed: the menu lists the logins and the click fetches the code.
  const states = await Promise.all(coded.map(async (row) => ({ row, state: found.gated ? null : await send<TotpState | null>({ type: 'totpCode', id: row.id }) })));
  if (document.activeElement !== field || field.value !== '') return;
  const items = states.filter((entry): entry is { row: Row; state: TotpState | null } => found.gated === true || entry.state !== null);
  if (items.length === 0) return;
  showMenu(field, items.map(({ row, state }) => ({
    html: [state ? grouped(state.code) : 'Use code', `· ${row.name}`],
    run: async () => {
      // A displayed code goes stale; fetch the current one at click time and never fill the menu's copy.
      const current = await send<TotpState | null>({ type: 'totpCode', id: row.id });
      const scope = formScope(field);
      hideMenu();
      if (current) fillCodes(current, scope);
    },
  })));
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !visible(el)) return;
  if (isOtpField(el)) return void offerCodes(el);
  const isLoginField = el.type === 'password' || (isUserField(el) && (el.autocomplete.includes('username') || passwordFields().some((p) => usernameFor(p) === el)));
  if (isLoginField) void offerLogins(el);
});
document.addEventListener('focusout', (e) => e.target === menuField && hideMenu());
document.addEventListener('input', (e) => e.target === menuField && hideMenu(), true);
document.addEventListener('keydown', (e) => e.key === 'Escape' && hideMenu(), true);
window.addEventListener('scroll', hideMenu, true);
window.addEventListener('resize', hideMenu);

let lastReport = { value: '', at: 0 };
function report(pw: HTMLInputElement) {
  if (!pw.value || (pw.value === lastReport.value && Date.now() - lastReport.at < 2000)) return;
  lastReport = { value: pw.value, at: Date.now() };
  void send({ type: 'capture', username: usernameFor(pw)?.value ?? '', password: pw.value });
}
const filledPassword = (scope: ParentNode) => [...scope.querySelectorAll<HTMLInputElement>('input[type=password]')].find((p) => p.value);

// A script's own el.click() or synthetic key event is not a sign-in; only the person's real input counts.
// On window, registered at document_start, so a page that stops the event in its own early capture listener cannot hide the sign-in.
window.addEventListener('submit', (e) => {
  const pw = e.isTrusted && e.target instanceof HTMLFormElement ? filledPassword(e.target) : undefined;
  if (pw) report(pw);
}, true);
window.addEventListener('keydown', (e) => {
  if (e.isTrusted && e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'password') report(e.target);
}, true);
window.addEventListener('click', (e) => {
  const button = e.isTrusted && e.target instanceof Element ? e.target.closest('button, input[type=submit], [role=button]') : null;
  const pw = button && filledPassword(button.closest('form') ?? document);
  if (pw) report(pw);
}, true);

// The popup names a login by id only; the worker then checks the page this script is really running on.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'fillForm') return;
  void send<{ username: string; password: string; code: TotpState | null }>({ type: 'fill', id: String(message.id) }).then((creds) => {
    if (creds) fillCodes(creds.code, fillForm(creds.username, creds.password));
    sendResponse({ filled: creds !== null });
  });
  return true;
});
export {};
