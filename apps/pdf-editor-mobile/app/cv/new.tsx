import { Button, Field, Header, Screen, Segmented, space, Text } from '@apps-hub/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { actionError } from '../../src/nexus/labels';
import { generateBody } from '../../src/cv/generate';
import { describeImport, type Imported } from '../../src/cv/import.ts';
import { ImportSheet } from '../../src/cv/import-sheet';
import { takeWaitingPdf } from '../../src/cv/import-sources';
import { type TemplateId } from '../../src/cv/model';
import { newCv, saveCv } from '../../src/cv/store';
import { TEMPLATE_LIST, TEMPLATES } from '../../src/cv/templates';
import { ai } from '../../src/nexus/ai';
import { CV_NEW_HINT } from '../../src/nexus/consent-copy';
import { HubNotice, useHubState } from '../../src/nexus/hub-notice';

export default function NewCvScreen() {
  const [profile, setProfile] = useState('');
  const [role, setRole] = useState('');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  const hub = useHubState();

  const fill = (imported: Imported) => {
    setProfile((current) => (current.trim() ? `${current.trim()}\n\n${imported.text}` : imported.text));
    setFilledFrom(describeImport(imported));
    setError(null);
  };

  useFocusEffect(
    useCallback(() => {
      void takeWaitingPdf()
        .then((waiting) => {
          if (!waiting) return;
          if (waiting.imported) fill(waiting.imported);
          else setError(`Nexus hasn't read ${waiting.title} yet. Open it, wait for it to load, then come back here.`);
        })
        .catch((err) => setError(actionError(err)));
    }, []),
  );

  const create = async () => {
    if (!profile.trim()) return setError('Describe your experience first.');
    setBusy(true);
    setError(null);
    try {
      const cv = newCv(await generateBody(profile, role, ai.complete), template);
      saveCv(cv);
      router.replace({ pathname: '/cv/[id]', params: { id: cv.id } });
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="New CV" trailing={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <HubNotice state={hub} />
      <View style={{ gap: space.md }}>
        <Button label="Import from a file" variant="secondary" onPress={() => setImportOpen(true)} />
        <Field
          label="About you"
          value={profile}
          onChangeText={setProfile}
          multiline
          textAlignVertical="top"
          style={{ minHeight: 160 }}
          placeholder="Jobs with dates and what you did, education, skills, languages, certifications. Write it however it comes to you."
          error={error}
          hint={filledFrom ? `${filledFrom} ${CV_NEW_HINT}` : CV_NEW_HINT}
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
      {importOpen ? <ImportSheet onImported={fill} onClose={() => setImportOpen(false)} /> : null}
    </Screen>
  );
}
