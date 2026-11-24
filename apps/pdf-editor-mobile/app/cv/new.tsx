import { Button, Field, Header, Notice, Screen, Segmented, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { errorMessage } from '../../src/library/use-library';
import { generateBody } from '../../src/cv/generate';
import { type TemplateId } from '../../src/cv/model';
import { newCv, saveCv } from '../../src/cv/store';
import { TEMPLATE_LIST, TEMPLATES } from '../../src/cv/templates';
import { ai, aiReady } from '../../src/nexus/ai';

export default function NewCvScreen() {
  const [profile, setProfile] = useState('');
  const [role, setRole] = useState('');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [keys, setKeys] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void aiReady().then(setKeys);
  }, []);

  const create = async () => {
    if (!profile.trim()) return setError('Describe your experience first.');
    setBusy(true);
    setError(null);
    try {
      const cv = newCv(await generateBody(profile, role, ai.complete), template);
      saveCv(cv);
      router.replace({ pathname: '/cv/[id]', params: { id: cv.id } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="New CV" trailing={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      {keys === false ? (
        <Notice tone="accent" title="AI is off" action={<Button label="Add your keys" size="sm" onPress={() => router.push('/settings')} />}>
          Nexus writes CVs with your Gemini and Groq keys or through AI hub. Add your keys in AI settings, or turn on Nexus in AI hub.
        </Notice>
      ) : null}
      <View style={{ gap: space.md }}>
        <Field
          label="About you"
          value={profile}
          onChangeText={setProfile}
          multiline
          textAlignVertical="top"
          style={{ minHeight: 160 }}
          placeholder="Jobs with dates and what you did, education, skills, languages, certifications. Write it however it comes to you."
          error={error}
          hint="Nexus uses only what you write here and sends it to Groq or Gemini, whichever answers."
        />
        <Field label="Target role (optional)" value={role} onChangeText={setRole} placeholder="Data analyst" />
        <Segmented
          accessibilityLabel="Template"
          options={TEMPLATE_LIST.map((t) => ({ key: t.id, label: t.label }))}
          value={template}
          onChange={setTemplate}
        />
        <Text tone="muted">{TEMPLATES[template].blurb}</Text>
        <Button label="Create CV" busy={busy} disabled={keys === false} onPress={() => void create()} />
      </View>
    </Screen>
  );
}
