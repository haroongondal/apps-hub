import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Button, Field, Group, Header, Notice, Row, Screen, Segmented, confirmAction } from '@apps-hub/ui';
import Vault, { type EntryInput, type PassFormat, type TotpInfo } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { editableWifi, normalisePassCode, validateExpiry, validatePass, validateWifi, wifiCode, type WifiSecurity } from './forms.ts';
import { BackButton, SecretField } from './parts.tsx';

// Wi-Fi is a pass whose code is a WIFI: string (forms.ts), so it is a screen kind and not an entry type.
type Kind = EntryInput['type'] | 'wifi';

const KINDS = [
  { key: 'login', label: 'Login' },
  { key: 'card', label: 'Card' },
  { key: 'note', label: 'Note' },
  { key: 'pass', label: 'Pass' },
  { key: 'wifi', label: 'Wi-Fi' },
] as const;

const SECURITY = [
  { key: 'WPA', label: 'Password' },
  { key: 'nopass', label: 'Open' },
] as const;

const FORMATS = [
  { key: 'qr', label: 'QR' },
  { key: 'code128', label: 'Code 128' },
  { key: 'ean13', label: 'EAN-13' },
] as const;

// totp stays null when untouched: the stored code, if any, is then left alone by the save.
const BLANK = { name: '', username: '', password: '', sites: '', holder: '', number: '', expMonth: '', expYear: '', cvc: '', note: '', text: '', code: '', format: 'qr' as PassFormat, expiresOn: '', security: 'WPA' as WifiSecurity, totp: null as string | null };
type Draft = typeof BLANK;

// An empty box means "not set"; anything else must be a whole number in range.
function whole(text: string, min: number, max: number): number | null | undefined {
  if (text.trim() === '') return null;
  const n = /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  return n >= min && n <= max ? n : undefined;
}

function build(kind: Kind, d: Draft, keepApps: string[] | null): EntryInput | string {
  const name = d.name.trim();
  if (!name) return 'Give this entry a name.';
  if (kind === 'login') {
    const login: EntryInput = { type: 'login', name, username: d.username.trim(), password: d.password, sites: d.sites.split(/[\s,]+/).filter(Boolean), note: d.note };
    if (d.totp !== null) login.totp = d.totp;
    return keepApps ? { ...login, apps: keepApps } : login;
  }
  if (kind === 'note') return { type: 'note', name, text: d.text };
  if (kind === 'wifi') {
    const problem = validateWifi(name, d.password, d.security) ?? validateExpiry(d.expiresOn);
    return problem ?? { type: 'pass', name, code: wifiCode(name, d.password, d.security), format: 'qr', note: d.note, expiresOn: d.expiresOn.trim() };
  }
  if (kind === 'pass') {
    const problem = validatePass(name, d.code, d.format) ?? validateExpiry(d.expiresOn);
    return problem ?? { type: 'pass', name, code: normalisePassCode(d.code, d.format), format: d.format, note: d.note, expiresOn: d.expiresOn.trim() };
  }
  const expMonth = whole(d.expMonth, 1, 12);
  const expYear = whole(d.expYear, 2000, 2999);
  if (expMonth === undefined) return 'Enter the expiry month as a number from 1 to 12.';
  if (expYear === undefined) return 'Enter the expiry year with four digits, such as 2029.';
  return { type: 'card', name, holder: d.holder.trim(), number: d.number.replace(/\s/g, ''), expMonth, expYear, cvc: d.cvc.trim(), note: d.note };
}

interface Props {
  id: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
  onLocked: () => void;
}

export function EditScreen({ id, onBack, onSaved, onLocked }: Props) {
  const [kind, setKind] = useState<Kind>('login');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [totp, setTotp] = useState<TotpInfo | null>(null);
  const [loaded, setLoaded] = useState(id === null);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [keepApps, setKeepApps] = useState<string[] | null>(null);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setError(messageOf(e)));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const totpLabel = totp ? [totp.issuer, totp.account, `${totp.digits} digits, every ${totp.period} s`].filter(Boolean).join(' · ') : '';

  // The entry being edited is the one place, besides Show, where a stored password, card number, security code or pass code reaches JS.
  useEffect(() => {
    if (id === null) return;
    try {
      const e = Vault.entry(id);
      if (!e) return setError('That entry is gone. Go back to the list and pick another.');
      const fields: Partial<Draft> = { name: e.name, note: e.note, text: e.text ?? '' };
      if (e.type === 'login') Object.assign(fields, { username: e.username ?? '', sites: (e.sites ?? []).join('\n'), password: Vault.reveal(id, 'password') });
      setTotp(e.totp ?? null);
      if (e.type === 'card') {
        Object.assign(fields, { holder: e.holder ?? '', expMonth: e.expMonth ? String(e.expMonth) : '', expYear: e.expYear ? String(e.expYear) : '' });
        Object.assign(fields, { number: Vault.reveal(id, 'number'), cvc: Vault.reveal(id, 'cvc') });
      }
      let shownKind: Kind = e.type;
      if (e.type === 'pass') {
        const code = Vault.reveal(id, 'code');
        Object.assign(fields, { format: e.format ?? 'qr', code, expiresOn: e.expiresOn ?? '' });
        const wifi = editableWifi(e.name, code, e.format ?? 'qr');
        if (wifi) (shownKind = 'wifi'), Object.assign(fields, { password: wifi.password, security: wifi.security });
      }
      setKind(shownKind);
      setApps(e.apps ?? []);
      set(fields);
      setLoaded(true);
    } catch (e) {
      fail(e);
    }
  }, [id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && setShown(false));
    return () => sub.remove();
  }, []);

  const linked = keepApps ?? apps;

  const unlink = (app: string) =>
    confirmAction({
      title: `Unlink ${app}?`,
      message: 'Strongroom stops offering this login in that app once you save. You can link it again by filling it there.',
      confirmLabel: 'Unlink',
      onConfirm: () => setKeepApps(linked.filter((a) => a !== app)),
    });

  const save = () => {
    const input = build(kind, draft, keepApps);
    if (typeof input === 'string') return setError(input);
    try {
      onSaved(Vault.save(id, input));
    } catch (e) {
      fail(e);
    }
  };

  // The scanner holds the secret until the save stores it; only the parsed shape is shown here.
  const scan = () => {
    Vault.scanQr()
      .then((r) => {
        if (!r) return; // cancelled: the entry stays as it was
        set({ totp: r.raw });
        setTotp(r);
        setError(null);
      })
      .catch(fail);
  };

  const dropTotp = () => {
    set({ totp: '' });
    setTotp(null);
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title={id === null ? 'Add an entry' : 'Edit entry'} />
      {id === null && <Segmented options={KINDS} value={kind} onChange={setKind} accessibilityLabel="Entry type" />}
      {loaded && (
        <>
          <Field label={kind === 'wifi' ? 'Network name' : 'Name'} value={draft.name} onChangeText={(name) => set({ name })} autoCorrect={false} />
          {kind === 'login' && (
            <>
              <Field label="Username" value={draft.username} onChangeText={(username) => set({ username })} autoCapitalize="none" autoCorrect={false} />
              <SecretField label="Password" shown={shown} value={draft.password} onChangeText={(password) => set({ password })} />
              <Field
                label="Websites"
                hint="One per line, such as example.com. Strongroom fills the login on these sites."
                value={draft.sites}
                onChangeText={(sites) => set({ sites })}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              <Field
                label="Authenticator code"
                hint={totp ? undefined : 'Optional. Scan the QR code the site shows for its authenticator app.'}
                value={totpLabel}
                editable={false}
              />
              <Button label={totp ? 'Replace QR code' : 'Scan QR code'} variant="ghost" onPress={scan} />
              {totp && <Button label="Remove code" variant="ghost" onPress={dropTotp} />}
              {linked.length > 0 && (
                <Group title="Linked apps" footer="Strongroom fills this login in these apps. Unlinking takes effect when you save.">
                  {linked.map((a) => (
                    <Row key={a} title={a} mono trailing={<Button label="Unlink" variant="ghost" size="sm" onPress={() => unlink(a)} accessibilityHint="Stops filling this login in that app" />} />
                  ))}
                </Group>
              )}
            </>
          )}
          {kind === 'card' && (
            <>
              <Field label="Name on card" value={draft.holder} onChangeText={(holder) => set({ holder })} autoCorrect={false} />
              <SecretField label="Card number" shown={shown} value={draft.number} onChangeText={(number) => set({ number })} keyboardType="number-pad" mono />
              <Field label="Expiry month" hint="1 to 12" value={draft.expMonth} onChangeText={(expMonth) => set({ expMonth })} keyboardType="number-pad" />
              <Field label="Expiry year" hint="Four digits, such as 2029" value={draft.expYear} onChangeText={(expYear) => set({ expYear })} keyboardType="number-pad" />
              <SecretField label="Security code" shown={shown} value={draft.cvc} onChangeText={(cvc) => set({ cvc })} keyboardType="number-pad" mono />
            </>
          )}
          {kind === 'pass' && (
            <>
              <SecretField label="Code" hint="The number or text the barcode stands for." shown={shown} value={draft.code} onChangeText={(code) => set({ code })} mono />
              <Segmented options={FORMATS} value={draft.format} onChange={(format) => set({ format })} accessibilityLabel="Barcode format" />
            </>
          )}
          {kind === 'wifi' && (
            <>
              <Segmented options={SECURITY} value={draft.security} onChange={(security) => set({ security })} accessibilityLabel="Network security" />
              {draft.security === 'WPA' && <SecretField label="Wi-Fi password" shown={shown} value={draft.password} onChangeText={(password) => set({ password })} />}
            </>
          )}
          {(kind === 'pass' || kind === 'wifi') && (
            <Field
              label="Expires on"
              hint="Optional, as year-month-day, such as 2027-03-31."
              value={draft.expiresOn}
              onChangeText={(expiresOn) => set({ expiresOn })}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          {kind === 'note' ? (
            <SecretField label="Note" value={draft.text} onChangeText={(text) => set({ text })} shown multiline minHeight={160} />
          ) : (
            <SecretField label="Note" value={draft.note} onChangeText={(note) => set({ note })} shown multiline />
          )}
          {kind !== 'note' && <Button label={shown ? 'Hide secrets' : 'Show secrets'} variant="ghost" onPress={() => setShown((s) => !s)} />}
          {error && <Notice tone="danger">{error}</Notice>}
          <Button label="Save" onPress={save} block />
        </>
      )}
      {!loaded && error && <Notice tone="danger">{error}</Notice>}
    </Screen>
  );
}
