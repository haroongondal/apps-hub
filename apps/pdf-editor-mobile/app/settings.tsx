import { AiError } from '@apps-hub/knowledge-core';
import { Button, Field, Group, Header, Notice, Row, Screen, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { errorMessage } from '../src/library/use-library';
import { addKey, checkKey, getKeys, removeKey, type Service } from '../src/nexus/ai';
import { kick, openKnowledge } from '../src/nexus/worker';

const SERVICES: { id: Service; name: string; placeholder: string; hint: string }[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    placeholder: 'AIza…',
    hint: 'Create one in Google AI Studio, under Get API key. On the free tier Google may use what Nexus sends to improve its products. Nexus keeps the key in Android\'s encrypted storage.',
  },
  {
    id: 'groq',
    name: 'Groq',
    placeholder: 'gsk_…',
    hint: 'Create one at console.groq.com, under API Keys. Nexus keeps the key in Android\'s encrypted storage.',
  },
];

function KeyPanel({ service, saved, onChange }: { service: (typeof SERVICES)[number]; saved: string[]; onChange: (keys: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const key = draft.trim();
    if (!key) return setError(`Paste your ${service.name} key first.`);
    setBusy(true);
    setError(null);
    try {
      await checkKey(service.id, key); // proves the key works before anything is queued on it
      await addKey(service.id, key);
      setDraft('');
      onChange(await getKeys(service.id));
      await kick();
    } catch (err) {
      setError(err instanceof AiError ? err.message : `The key could not be checked: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    await removeKey(service.id, index);
    onChange(await getKeys(service.id));
  };

  return (
    <>
      {saved.length > 0 ? (
        <Group title={`${service.name} ${saved.length === 1 ? 'key' : 'keys'}`} footer={saved.length > 1 ? 'Nexus uses them in this order. When one is refused or at its limit, it moves to the next.' : undefined}>
          {saved.map((key, i) => (
            <Row key={key} title="Saved on this phone" subtitle={`Ends in ${key.slice(-4)}`} trailing={<Button label="Remove" size="sm" variant="danger" onPress={() => void remove(i)} />} />
          ))}
        </Group>
      ) : null}
      <View style={{ gap: space.md }}>
        <Field
          label={saved.length > 0 ? `Add another ${service.name} key` : `${service.name} API key`}
          value={draft}
          onChangeText={setDraft}
          placeholder={service.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          mono
          error={error}
          hint={service.hint}
        />
        <Button label="Check and save" busy={busy} onPress={() => void save()} />
      </View>
    </>
  );
}

export default function SettingsScreen() {
  const [keys, setKeys] = useState<Record<Service, string[]>>({ gemini: [], groq: [] });
  const [queued, setQueued] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getKeys('gemini'), getKeys('groq')]).then(([gemini, groq]) => setKeys({ gemini, groq }));
  }, []);

  const ready = keys.gemini.length > 0 && keys.groq.length > 0;

  const processAll = async () => {
    const n = await (await openKnowledge()).enqueueMissing();
    await kick();
    setQueued(n === 0 ? 'Everything is already queued or processed.' : `Queued ${n} ${n === 1 ? 'item' : 'items'}.`);
  };

  return (
    <Screen scroll>
      <Header title="AI settings" trailing={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <Notice tone="neutral" title="What leaves this phone">
        With both keys saved, Nexus sends Google the text of your notes, PDFs and scans, and your photos, to find ideas and read images. It sends
        Groq the text of your notes, PDFs and scans, to build the graph and answer questions, and your voice recordings, to transcribe them. Your
        files stay on this phone. Without the keys nothing is sent.
      </Notice>
      {SERVICES.map((s) => (
        <KeyPanel key={s.id} service={s} saved={keys[s.id]} onChange={(list) => setKeys((k) => ({ ...k, [s.id]: list }))} />
      ))}
      {ready ? (
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
