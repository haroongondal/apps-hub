import type { Item } from '@apps-hub/library-core';
import { Empty, Group, Notice, Row, Sheet, Text } from '@apps-hub/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { errorMessage } from '../library/use-library';
import { CV_IMPORT_NOTE } from '../nexus/consent-copy';

import type { Candidate, Imported } from './import.ts';
import { addPdfToRead, libraryPdfs, readLibraryPdf, readPhoto } from './import-sources';

type View = { name: 'menu' } | { name: 'library'; items: Candidate<Item>[] | null };

const confirmKeptOut = (title: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(
      'Use a file you kept out of Nexus?',
      `You kept "${title}" out of Nexus. Nexus will read it for this CV only because you picked it. It stays kept out, and the text goes to AI only when you tap Create CV.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Use it', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );

export function ImportSheet({ onImported, onClose }: { onImported: (imported: Imported) => void; onClose: () => void }) {
  const [view, setView] = useState<View>({ name: 'menu' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view.name !== 'library' || view.items !== null) return;
    libraryPdfs().then(
      (items) => setView({ name: 'library', items }),
      (err) => {
        setError(errorMessage(err));
        setView({ name: 'menu' });
      },
    );
  }, [view]);

  const run = async (step: () => Promise<Imported | null | boolean>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await step();
      if (result && typeof result === 'object') onImported(result);
      if (result) onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = ({ item, keptOut }: Candidate<Item>) =>
    run(async () => (keptOut && !(await confirmKeptOut(item.title)) ? null : readLibraryPdf(item, keptOut)));

  return (
    <Sheet visible title="Import from a file" onClose={onClose}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {view.name === 'menu' ? (
        <Group>
          <Row title="From your Library" subtitle="PDFs Nexus has already read" onPress={() => setView({ name: 'library', items: null })} />
          <Row title="Choose a photo" subtitle="Read on this phone" onPress={() => void run(readPhoto)} />
          <Row
            title="Choose a PDF"
            subtitle="Added to your Library, kept out of Nexus, and opened to read it"
            onPress={() => void run(addPdfToRead)}
          />
        </Group>
      ) : view.items === null ? (
        <ActivityIndicator />
      ) : view.items.length === 0 ? (
        <Empty title="No PDFs with text yet" body="Open a PDF in Nexus once and it shows up here, or choose a PDF or a photo instead." />
      ) : (
        <Group>
          {view.items.map((c) => (
            <Row key={c.item.id} title={c.item.title} subtitle={c.keptOut ? 'Kept out of Nexus' : undefined} onPress={() => void pick(c)} />
          ))}
        </Group>
      )}
      <Text tone="muted">{CV_IMPORT_NOTE}</Text>
    </Sheet>
  );
}
