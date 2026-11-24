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
import { checkHub, hubAi } from '../../src/nexus/hub';
import type { HubStatus } from '../../src/nexus/hub-port';

export default function NewCvScreen() {
  const [profile, setProfile] = useState('');
  const [role, setRole] = useState('');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void checkHub().then(setHub);
  }, []);

  const create = async () => {
    if (!profile.trim()) return setError('Describe your experience first.');
    setBusy(true);
    setError(null);
    try {
      const cv = newCv(await generateBody(profile, role, hubAi), template);
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
      {hub?.ok === false ? (
        <Notice tone="accent" title="AI hub isn't ready">
          {hub.message}
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
          hint="Nexus uses only what you write here and sends it to AI hub, which asks Groq or Gemini."
        />
        <Field label="Target role (optional)" value={role} onChangeText={setRole} placeholder="Data analyst" />
        <Segmented
          accessibilityLabel="Template"
          options={TEMPLATE_LIST.map((t) => ({ key: t.id, label: t.label }))}
          value={template}
          onChange={setTemplate}
        />
        <Text tone="muted">{TEMPLATES[template].blurb}</Text>
        <Button label="Create CV" busy={busy} disabled={hub?.ok === false} onPress={() => void create()} />
      </View>
    </Screen>
  );
}
