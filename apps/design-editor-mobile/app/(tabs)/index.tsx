import { Button, Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  clearAutosave,
  designTitle,
  readAutosave,
  readDesignText,
  readSavedList,
  writeAutosave,
  type SavedDesign,
} from "../../src/editor/files";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DesignsHome() {
  const [resumable, setResumable] = useState<Awaited<ReturnType<typeof readAutosave>>>(null);
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read whenever the tab gains focus: a save made in the editor shows up on return.
  useFocusEffect(
    useCallback(() => {
      readAutosave().then(setResumable, e => setError(message(e)));
      readSavedList().then(
        list => setDesigns(list),
        e => {
          setDesigns([]);
          setError(message(e));
        },
      );
    }, []),
  );

  function resume() {
    router.push({ pathname: '/editor', params: { name: designTitle(resumable?.filePath) } });
  }

  function newDesign() {
    void (async () => {
      setError(null);
      try {
        // A blank start must not inherit the previous session's autosave slot.
        await clearAutosave();
        router.push({ pathname: '/editor', params: { name: 'Untitled' } });
      } catch (e) {
        setError(message(e));
      }
    })();
  }

  function openFile() {
    void (async () => {
      setError(null);
      try {
        const res = await DocumentPicker.getDocumentAsync({
          type: ['application/json'],
          copyToCacheDirectory: false,
          multiple: false,
        });
        const asset = res.assets?.[0];
        if (res.canceled || !asset) return;
        const text = await fetchText(asset.uri);
        if (!text) throw new Error('That file did not open. Pick a design saved from this editor.');
        // The picked file's own name becomes the title; a later Save starts a fresh file in this
        // app's folder, because the picked location is outside Documents/Design Editor.
        await writeAutosave({ filePath: asset.name, dirty: false, doc: text });
        router.push({ pathname: '/editor', params: { name: designTitle(asset.name) } });
      } catch (e) {
        setError(message(e));
      }
    })();
  }

  function openSaved(design: SavedDesign) {
    void (async () => {
      setError(null);
      try {
        const text = await readDesignText(design);
        if (!text) throw new Error('The design file is no longer on this phone.');
        await writeAutosave({ filePath: design.path, dirty: false, doc: text });
        router.push({ pathname: '/editor', params: { name: designTitle(design.path) } });
      } catch (e) {
        setError(message(e));
      }
    })();
  }

  return (
    <Screen scroll>
      <Header title="Designs" subtitle="Everything stays on this phone." />
      {error ? <Notice tone="danger" title="Something went wrong">{error}</Notice> : null}

      {resumable ? (
        <Group title="Continue" footer="Your last edits are always here, even without a save.">
          <Row
            title={designTitle(resumable.filePath) + (resumable.dirty ? ' — not saved' : '')}
            subtitle={resumable.dirty ? 'Pick up where you left off.' : 'All changes saved.'}
            onPress={resume}
            accessibilityHint="Opens the editor with this design"
          />
        </Group>
      ) : null}

      <Group>
        <Button label="New design" block onPress={newDesign} />
        <Button label="Open a design file" variant="secondary" block onPress={openFile} />
      </Group>

      <Group title="Saved designs" footer="Saved designs are in the Design Editor folder on this phone.">
        {designs === null ? (
          <Row title="Loading your designs…" />
        ) : designs.length === 0 ? (
          <Row title="No designs yet" subtitle="A design appears here after you save one in the editor." />
        ) : (
          designs.map(design => (
            <Row
              key={design.id}
              title={design.name}
              subtitle={new Date(design.added).toLocaleDateString()}
              onPress={() => openSaved(design)}
              accessibilityHint="Opens this design in the editor"
            />
          ))
        )}
      </Group>

      {/* eslint-disable-next-line @typescript-eslint/no-require-imports -- dev-only: a release bundle drops the lab */}
      {__DEV__ ? require('../../src/lab/LabRow').LabRow() : null}
    </Screen>
  );
}

// Reads a picked .json design; null when it cannot be read or does not look like one
// (the editor's own parseDoc gives it the final verdict).
async function fetchText(uri: string): Promise<string | null> {
  try {
    const text = await FileSystem.readAsStringAsync(uri);
    const design = JSON.parse(text) as { W?: unknown; pages?: unknown };
    if (typeof design.W !== 'number' || !Array.isArray(design.pages)) return null;
    return text;
  } catch {
    return null;
  }
}
