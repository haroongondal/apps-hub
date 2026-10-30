import React, { useEffect, useState } from 'react';
import { Button, Field, Header, Notice, Screen, Segmented } from '@apps-hub/ui';
import Vault, { type EntryInput } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { BackButton, SecretField } from './parts.tsx';

type Kind = EntryInput['type'];

const KINDS = [
  { key: 'login', label: 'Login' },
  { key: 'card', label: 'Card' },
  { key: 'note', label: 'Note' },
] as const;

const BLANK = { name: '', username: '', password: '', sites: '', holder: '', number: '', expMonth: '', expYear: '', cvc: '', note: '', text: '' };
type Draft = typeof BLANK;

// An empty box means "not set"; anything else must be a whole number in range.
function whole(text: string, min: number, max: number): number | null | undefined {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function build(kind: Kind, d: Draft): EntryInput | string {
  const name = d.name.trim();
  if (!name) return 'Give this entry a name.';
  if (kind === 'login') return { type: 'login', name, username: d.username.trim(), password: d.password, sites: d.sites.split(/[\s,]+/).filter(Boolean), note: d.note };
  if (kind === 'note') return { type: 'note', name, text: d.text };
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
  const [loaded, setLoaded] = useState(id === null);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setError(messageOf(e)));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // The entry being edited is the one place, besides Show, where a stored password, card number or security code reaches JS.
  useEffect(() => {
    if (id === null) return;
    try {
      const e = Vault.entry(id);
      if (!e) return setError('That entry is gone. Go back to the list and pick another.');
      const fields: Partial<Draft> = { name: e.name, note: e.note, text: e.text ?? '' };
      if (e.type === 'login') Object.assign(fields, { username: e.username ?? '', sites: (e.sites ?? []).join('\n'), password: Vault.reveal(id, 'password') });
      if (e.type === 'card') {
        Object.assign(fields, { holder: e.holder ?? '', expMonth: e.expMonth ? String(e.expMonth) : '', expYear: e.expYear ? String(e.expYear) : '' });
        Object.assign(fields, { number: Vault.reveal(id, 'number'), cvc: Vault.reveal(id, 'cvc') });
      }
      setKind(e.type);
      set(fields);
      setLoaded(true);
    } catch (e) {
      fail(e);
    }
  }, [id]);

  const save = () => {
    const input = build(kind, draft);
    if (typeof input === 'string') return setError(input);
    try {
      onSaved(Vault.save(id, input));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title={id === null ? 'Add an entry' : 'Edit entry'} />
      {id === null && <Segmented options={KINDS} value={kind} onChange={setKind} accessibilityLabel="Entry type" />}
      {loaded && (
        <>
          <Field label="Name" value={draft.name} onChangeText={(name) => set({ name })} autoCorrect={false} />
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
                keyboardType="url"
                multiline
              />
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
          {kind === 'note' ? (
            <Field label="Note" value={draft.text} onChangeText={(text) => set({ text })} multiline style={{ minHeight: 160, textAlignVertical: 'top', paddingTop: 12 }} />
          ) : (
            <Field label="Note" value={draft.note} onChangeText={(note) => set({ note })} multiline />
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
