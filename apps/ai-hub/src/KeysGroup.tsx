import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Row, confirmAction, space } from '@apps-hub/ui';
import { addKey, clearKeys, keys, removeKey, type KeyInfo } from 'ai-hub-core';
import { keysUnreadable, plainError } from './format.ts';

export function KeysGroup() {
  const [list, setList] = useState<KeyInfo[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => keys().then(setList).catch((e) => setError(plainError(e))), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await addKey(draft);
      setDraft('');
    });

  const confirmClear = () =>
    confirmAction({
      title: 'Remove all keys?',
      message: 'You will need to add your Gemini and Groq keys again.',
      confirmLabel: 'Remove all keys',
      onConfirm: () => run(clearKeys),
    });

  const confirmRemove = (key: KeyInfo) =>
    confirmAction({
      title: `Remove ${key.label}?`,
      confirmLabel: 'Remove',
      onConfirm: () => run(() => removeKey(key.index)),
    });

  return (
    <View style={{ gap: space.md }}>
      <Group title="Keys">
        {list.map((key) => (
          <Row
            key={key.index}
            title={key.label}
            trailing={<Button label="Remove" variant="secondary" size="sm" disabled={busy} onPress={() => confirmRemove(key)} accessibilityLabel={`Remove ${key.label}`} />}
          />
        ))}
        <Row title="Add a key">
          <Field
            label="Gemini or Groq key"
            hint="Starts with AIza or AQ. for Gemini, or gsk_ for Groq."
            value={draft}
            onChangeText={setDraft}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            mono
          />
          <Button label="Add key" onPress={add} busy={busy} disabled={draft.trim().length === 0} />
        </Row>
      </Group>
      {list.length === 0 && !error && <Notice>Add a Gemini or Groq key to start.</Notice>}
      {error && (
        <Notice tone="danger" action={keysUnreadable(error) ? <Button label="Remove all keys" variant="secondary" tone="danger" onPress={confirmClear} /> : undefined}>
          {error}
        </Notice>
      )}
    </View>
  );
}
