import { AiError } from '@apps-hub/knowledge-core';
import { Button, Field, Group, Header, Notice, Row, Screen, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { errorMessage } from '../src/library/use-library';
import { getApiKey, portFor, setApiKey } from '../src/nexus/ai';
import { kick, openKnowledge } from '../src/nexus/worker';

export default function SettingsScreen() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);

  useEffect(() => {
    void getApiKey().then(setSaved);
  }, []);

  const save = async () => {
    const key = draft.trim();
    if (!key) return setError('Paste your OpenAI API key first.');
    setBusy(true);
    setError(null);
    try {
      await portFor(key).embed(['Nexus key check']); // proves the key works before anything is queued on it
      await setApiKey(key);
      setSaved(key);
      setDraft('');
      await kick();
    } catch (err) {
      setError(err instanceof AiError ? err.message : `The key could not be checked: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await setApiKey(null);
    setSaved(null);
  };

  const processAll = async () => {
    const n = await (await openKnowledge()).enqueueMissing();
    await kick();
    setQueued(n === 0 ? 'Everything is already queued or processed.' : `Queued ${n} ${n === 1 ? 'item' : 'items'}.`);
  };

  return (
    <Screen scroll>
      <Header title="AI settings" trailing={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <Notice tone="neutral" title="What leaves this phone">
        With a key saved, Nexus sends OpenAI the text of your notes, PDFs and scans, your voice recordings and your photos, to transcribe them, find
        ideas and answer questions. Your files stay on this phone. Without a key nothing is sent.
      </Notice>
      {saved ? (
        <Group title="OpenAI key">
          <Row title="Saved on this phone" subtitle={`Ends in ${saved.slice(-4)}`} trailing={<Button label="Remove" size="sm" variant="danger" onPress={() => void remove()} />} />
        </Group>
      ) : null}
      <View style={{ gap: space.md }}>
        <Field
          label={saved ? 'Replace the key' : 'OpenAI API key'}
          value={draft}
          onChangeText={setDraft}
          placeholder="sk-…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          mono
          error={error}
          hint="Create one at platform.openai.com under API keys. Nexus keeps it in Android's encrypted storage."
        />
        <Button label="Check and save" busy={busy} onPress={() => void save()} />
      </View>
      {saved ? (
        <Group title="Your library" footer="New notes, recordings, photos and opened PDFs are queued as you add them. Use this for older items.">
          <View style={{ padding: space.lg, gap: space.md }}>
            <Button label="Process everything already here" variant="secondary" onPress={() => void processAll().catch((err) => setQueued(errorMessage(err)))} />
            {queued ? <Text tone="muted">{queued}</Text> : null}
          </View>
        </Group>
      ) : null}
    </Screen>
  );
}
