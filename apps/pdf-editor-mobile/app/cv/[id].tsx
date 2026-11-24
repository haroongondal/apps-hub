import { Button, confirmAction, Empty, Field, Group, Header, Notice, Row, Screen, Segmented, space } from '@apps-hub/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { errorMessage } from '../../src/library/use-library';
import { editBody } from '../../src/cv/generate';
import type { Cv, TemplateId } from '../../src/cv/model';
import { deleteCv, exportCv, loadCv, saveCv } from '../../src/cv/store';
import { TEMPLATE_LIST, TEMPLATES } from '../../src/cv/templates';
import { ai } from '../../src/nexus/ai';
import { CV_CHANGE_FOOTER } from '../../src/nexus/consent-copy';

export default function CvEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cv, setCv] = useState<Cv | null | undefined>(undefined);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'ai' | 'export' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    void loadCv(id).then((found) => setCv(found ?? null));
  }, [id]);

  if (cv === undefined) return <Screen>{null}</Screen>;
  if (cv === null) {
    return (
      <Screen>
        <Header title="CV" trailing={<IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />} />
        <Empty title="This CV is gone" body="It was deleted from this phone." />
      </Screen>
    );
  }

  const change = (next: Omit<Cv, 'updated'>) => {
    const saved = { ...next, updated: new Date().toISOString() };
    saveCv(saved);
    setCv(saved);
  };

  const apply = async () => {
    if (!instruction.trim()) return;
    setBusy('ai');
    setError(null);
    try {
      const body = await editBody(cv, instruction, ai.complete);
      change({ ...cv, ...body });
      setInstruction('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const removeSection = (index: number) => change({ ...cv, sections: cv.sections.filter((_, i) => i !== index) });

  const setTemplate = (template: TemplateId) => change({ ...cv, template });

  const share = async () => {
    setBusy('export');
    setShareError(null);
    try {
      await exportCv(cv);
    } catch (err) {
      setShareError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    confirmAction({
      title: 'Delete this CV?',
      message: 'The CV is removed from this phone. Share the PDF first if you still need it.',
      onConfirm: () => {
        deleteCv(cv.id);
        router.back();
      },
    });

  return (
    <Screen scroll>
      <Header title={cv.name} subtitle={cv.title || undefined} trailing={<IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />} />
      <Group title="Template" footer={TEMPLATES[cv.template].blurb}>
        <View style={{ padding: space.lg }}>
          <Segmented
            accessibilityLabel="Template"
            options={TEMPLATE_LIST.map((t) => ({ key: t.id, label: t.label }))}
            value={cv.template}
            onChange={setTemplate}
          />
        </View>
      </Group>
      <Group title="Sections" footer="Remove a section here, or ask AI below to add one.">
        {cv.sections.map((s, i) => (
          <Row
            key={`${i}-${s.heading}`}
            title={s.heading}
            subtitle={s.entries.map((e) => e.title || e.subtitle).filter(Boolean).join(' · ') || undefined}
            trailing={<Button label="Remove" size="sm" variant="danger" onPress={() => removeSection(i)} />}
          />
        ))}
      </Group>
      <Group title="Change with AI" footer={CV_CHANGE_FOOTER}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field
            label="What should change?"
            value={instruction}
            onChangeText={setInstruction}
            multiline
            textAlignVertical="top"
            style={{ minHeight: 96 }}
            placeholder="Add a Certifications section with AWS Solutions Architect, 2025. Make the summary shorter."
            error={error}
          />
          <Button label="Apply with AI" busy={busy === 'ai'} disabled={!instruction.trim() || busy !== null} onPress={() => void apply()} />
        </View>
      </Group>
      <Group title="Share">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Button label="Export PDF" busy={busy === 'export'} disabled={busy !== null} onPress={() => void share()} />
          {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
        </View>
      </Group>
      <Group>
        <Row title="Delete this CV" trailing={<Button label="Delete" size="sm" variant="danger" onPress={remove} />} />
      </Group>
    </Screen>
  );
}
