import { Button, Group, Header, Notice, Row, Screen, Sheet } from '@apps-hub/ui';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  designTitle,
  readAutosave,
  readDesignText,
  readSavedList,
  writeAutosave,
  type SavedDesign,
} from "../../src/editor/files";
import { PAGE_SIZES, blankDesign } from '../../src/editor/pageSizes';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DesignsHome() {
  const [resumable, setResumable] = useState<Awaited<ReturnType<typeof readAutosave>>>(null);
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

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

  // A new design starts at a size the person picks (the same sizes as the editor's Resize panel).
  function newDesign(w: number, h: number) {
    void (async () => {
      setError(null);
      setChoosing(false);
      try {
        // a blank start must not inherit the previous session's autosave slot
        await writeAutosave({ filePath: null, dirty: false, doc: blankDesign(w, h) });
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
        <Button label="New design" block onPress={() => setChoosing(true)} />
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
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="Choose a page size" doneLabel="Cancel" onDone={() => setChoosing(false)}>
        {PAGE_SIZES.map(([name, w, h]) => (
          <Row key={name} title={name} subtitle={`${w} × ${h}`} onPress={() => newDesign(w, h)} accessibilityHint="Starts a new design at this size" />
        ))}
      </Sheet>
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
