import { Button, Field, Group, Text, space } from '@apps-hub/ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '../library/use-library';

import { MAX_NOTES, readAbout, saveAbout } from './about-you';
import { openKnowledge } from './worker';

export function AboutYouSettings() {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    void openKnowledge()
      .then((kn) => readAbout(kn.lib.db))
      .then((a) => (setName(a.name), setNotes(a.notes)))
      .catch((err) => setLine(errorMessage(err)));
  }, []);

  const save = async () => {
    try {
      await saveAbout((await openKnowledge()).lib.db, { name, notes });
      setLine('Saved.');
    } catch (err) {
      setLine(errorMessage(err));
    }
  };

  return (
    <Group title="About you" footer="Stays on this phone. Nexus sends it to the AI only with a question about you, so answers can tell your documents from other people's.">
      <View style={{ padding: space.lg, gap: space.md }}>
        <Field label="Your name" value={name} onChangeText={setName} placeholder="As it is on your documents" />
        <Field
          label="Anything else Nexus should know (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={MAX_NOTES}
          textAlignVertical="top"
          style={{ minHeight: 96, maxHeight: 240 }}
          placeholder="Family, health, work, anything you want in your answers"
        />
        <Button label="Save" variant="secondary" onPress={() => void save()} />
        {line ? <Text tone="muted">{line}</Text> : null}
      </View>
    </Group>
  );
}
