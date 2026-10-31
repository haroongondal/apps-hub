import React, { useEffect, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Sheet, Text, space } from '@apps-hub/ui';
import Vault, { type EntryView } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { BackButton, HIDE_FROM_ACCESSIBILITY } from './parts.tsx';

type Secret = 'password' | 'number' | 'cvc';
type Copyable = Secret | 'username';

const MASK = '••••••••••••';
const LABEL: Record<Copyable, string> = { username: 'Username', password: 'Password', number: 'Card number', cvc: 'Security code' };

interface Props {
  id: string;
  onBack: () => void;
  onEdit: () => void;
  onLocked: () => void;
}

export function EntryScreen({ id, onBack, onEdit, onLocked }: Props) {
  const [entry, setEntry] = useState<EntryView | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<Secret, string>>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setMessage({ tone: 'danger', text: messageOf(e) }));

  useEffect(() => {
    try {
      const found = Vault.entry(id);
      if (found) setEntry(found);
      else setMessage({ tone: 'danger', text: 'That entry is gone. Go back to the list and pick another.' });
    } catch (e) {
      fail(e);
    }
  }, [id]);

  // A shown secret doesn't outlive the app being in front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && setRevealed({}));
    return () => sub.remove();
  }, []);

  const show = (field: Secret) => {
    try {
      setRevealed((r) => ({ ...r, [field]: Vault.reveal(id, field) }));
    } catch (e) {
      fail(e);
    }
  };

  const copy = (field: Copyable) => {
    try {
      Vault.copy(id, field);
      setMessage({ tone: 'ok', text: `${LABEL[field]} copied. The clipboard clears in 30 seconds.` });
    } catch (e) {
      fail(e);
    }
  };

  const remove = () => {
    setDeleting(false);
    try {
      Vault.remove(id);
      onBack();
    } catch (e) {
      fail(e);
    }
  };

  const value = (text: string, secret = false) => (
    <Text variant="data" {...(secret ? HIDE_FROM_ACCESSIBILITY : {})}>
      {text}
    </Text>
  );

  const secretRow = (field: Secret, empty?: string) => (
    <Row
      key={field}
      title={LABEL[field]}
      subtitle={value(revealed[field] ?? empty ?? MASK, revealed[field] !== undefined)}
      trailing={
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {revealed[field] === undefined ? (
            <Button label="Show" size="sm" variant="ghost" onPress={() => show(field)} accessibilityHint={`Shows the ${LABEL[field].toLowerCase()} on screen`} />
          ) : (
            <Button label="Hide" size="sm" variant="ghost" onPress={() => setRevealed((r) => ({ ...r, [field]: undefined }))} />
          )}
          <Button label="Copy" size="sm" variant="ghost" onPress={() => copy(field)} />
        </View>
      }
    />
  );

  const fields: ReactNode[] = [];
  if (entry?.type === 'login') {
    fields.push(
      <Row key="username" title="Username" subtitle={value(entry.username ?? '')} trailing={<Button label="Copy" size="sm" variant="ghost" onPress={() => copy('username')} />} />,
      secretRow('password'),
    );
    const places = [...(entry.sites ?? []), ...(entry.apps ?? [])];
    if (places.length) fields.push(<Row key="places" title="Websites and apps" subtitle={value(places.join('\n'))} />);
  } else if (entry?.type === 'card') {
    fields.push(
      <Row key="holder" title="Name on card" subtitle={value(entry.holder ?? '')} />,
      secretRow('number', `•••• ${entry.last4 ?? ''}`),
      <Row key="expiry" title="Expires" subtitle={value(expiry(entry))} />,
      secretRow('cvc'),
    );
  } else if (entry?.type === 'note') {
    fields.push(<Row key="text" title="Note" subtitle={value(entry.text ?? '')} />);
  }
  if (entry && entry.type !== 'note' && entry.note) fields.push(<Row key="note" title="Note" subtitle={value(entry.note)} />);

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title={entry?.name ?? 'Entry'} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {entry && (
        <>
          <Group>{fields}</Group>
          <Button label="Edit" variant="secondary" onPress={onEdit} block />
          <Button label="Delete" variant="danger" onPress={() => setDeleting(true)} block />
        </>
      )}
      <Sheet visible={deleting} onClose={() => setDeleting(false)} title="Delete this entry?" doneLabel="Cancel">
        <Text>{`${entry?.name ?? 'This entry'} will be removed from your vault. This can't be undone.`}</Text>
        <Button label="Delete" variant="danger" onPress={remove} block />
      </Sheet>
    </Screen>
  );
}

function expiry(e: EntryView): string {
  if (!e.expMonth && !e.expYear) return 'Not set';
  return `${e.expMonth ? String(e.expMonth).padStart(2, '0') : '--'}/${e.expYear ?? '----'}`;
}
