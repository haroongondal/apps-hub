import { Button, Field, Header, Screen, Segmented, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { errorMessage } from '../../src/library/use-library';
import { generateBody } from '../../src/cv/generate';
import { type TemplateId } from '../../src/cv/model';
import { newCv, saveCv } from '../../src/cv/store';
import { TEMPLATE_LIST, TEMPLATES } from '../../src/cv/templates';
import { ai } from '../../src/nexus/ai';
import { HubNotice, useHubState } from '../../src/nexus/hub-notice';

export default function NewCvScreen() {
  const [profile, setProfile] = useState('');
  const [role, setRole] = useState('');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hub = useHubState();

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
      <HubNotice state={hub} />
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
          hint="Nexus uses only what you write here and sends it to Groq or Gemini, whichever answers, through AI hub."
        />
        <Field label="Target role (optional)" value={role} onChangeText={setRole} placeholder="Data analyst" />
        <Segmented
          accessibilityLabel="Template"
          options={TEMPLATE_LIST.map((t) => ({ key: t.id, label: t.label }))}
          value={template}
          onChange={setTemplate}
        />
        <Text tone="muted">{TEMPLATES[template].blurb}</Text>
        <Button label="Create CV" busy={busy} disabled={hub !== null && hub !== 'ready'} onPress={() => void create()} />
      </View>
    </Screen>
  );
}
