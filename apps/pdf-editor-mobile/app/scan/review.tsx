import { defaultTitle, type SessionInput } from '@apps-hub/scan-core';
import { Button, Empty, Field, Header, Notice, Screen, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { PdfScan, type Quad } from 'pdf-scan';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Pressable, ScrollView, View } from 'react-native';

import { errorMessage } from '../../src/library/use-library';
import { IconButton } from '../../src/library/icon-button';
import { sheetChoice } from '../../src/scan/capture-rules';
import { CropEditor } from '../../src/scan/crop-editor';
import { FilterPicker } from '../../src/scan/filter-picker';
import { pathToUri, uriToPath } from '../../src/scan/files-expo';
import { getScanService } from '../../src/scan/service';
import { discardSession, loadSession, saveSession, sessionDir } from '../../src/scan/session';
import type { ScanSession, SessionPage } from '../../src/scan/session-data';

const FULL: Quad = [0, 0, 1, 0, 1, 1, 0, 1];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function removeFile(name: string) {
  try {
    new File(sessionDir(), name).delete();
  } catch {
    // already gone
  }
}

function cleanPreviews() {
  try {
    for (const entry of sessionDir().list()) {
      const name = decodeURIComponent(entry.uri.replace(/\/+$/, '').split('/').pop() ?? '');
      if (name.startsWith('prev-')) removeFile(name);
    }
  } catch {
    // no session folder
  }
}

export default function ReviewScreen() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ failed?: string; total?: string }>();
  const [initial] = useState<ScanSession | null>(() => loadSession());
  const [session, setSession] = useState<ScanSession | null>(initial);
  const latest = useRef(initial);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<'crop' | 'preview'>('crop');
  const [title, setTitle] = useState(() => defaultTitle(initial?.mode ?? 'document', Date.now()));
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const [preview, setPreview] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(
    params.failed ? `Couldn't import ${params.failed} of ${params.total ?? params.failed} photos. The rest are below.` : null,
  );
  const tried = useRef(new Set<string>());
  const counter = useRef(0);

  const base = uriToPath(sessionDir().uri);
  const pages = session?.pages ?? [];
  const index = Math.min(sel, Math.max(0, pages.length - 1));
  const page: SessionPage | undefined = pages[index];
  const card = session?.mode === 'card';

  const commit = (next: ScanSession) => {
    latest.current = next;
    setSession(next);
    try {
      saveSession(next);
    } catch (e) {
      setError(`The page list couldn't be saved: ${errorMessage(e)}`);
    }
  };
  const patchPage = (i: number, patch: Partial<SessionPage>) => {
    const s = latest.current;
    if (s) commit({ ...s, pages: s.pages.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  };

  useEffect(() => cleanPreviews, []);

  const file = page?.file;
  useEffect(() => {
    if (!file || dims[file]) return;
    RNImage.getSize(pathToUri(`${base}/${file}`), (w, h) => setDims((d) => ({ ...d, [file]: { w, h } })), () => setError("That photo couldn't be read. Delete the page or retake it."));
  }, [file, dims, base]);

  const needsQuad = !!file && page?.quad === null;
  useEffect(() => {
    if (!file || !needsQuad || tried.current.has(file)) return;
    tried.current.add(file);
    PdfScan.detectQuad(`${base}/${file}`, latest.current?.mode === 'card')
      .then((q) => {
        const i = latest.current?.pages.findIndex((p) => p.file === file) ?? -1;
        if (q && i >= 0 && latest.current?.pages[i].quad === null) patchPage(i, { quad: q });
      })
      .catch(() => undefined);
    // patchPage only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, needsQuad, base]);

  const quadKey = page?.quad?.join(',') ?? 'full';
  useEffect(() => {
    if (view !== 'preview' || !page) return;
    let alive = true;
    cleanPreviews();
    setPreviewing(true);
    PdfScan.processPage({ src: `${base}/${page.file}`, quad: page.quad ?? FULL, rotation: page.rotation, filter: page.filter, out: `${base}/prev-${++counter.current}`, maxLongSide: 1200 })
      .then((r) => alive && setPreview({ uri: pathToUri(r.jpg), w: r.width, h: r.height }))
      .catch((e: unknown) => alive && setError(`The preview couldn't be made: ${errorMessage(e)}`))
      .finally(() => alive && setPreviewing(false));
    return () => {
      alive = false;
    };
    // quadKey stands in for page.quad
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, file, quadKey, page?.rotation, page?.filter, base]);

  if (!session || pages.length === 0 || !page) {
    return (
      <Screen>
        <Empty
          title="No pages to review"
          body="Scan or import some pages first."
          action={<Button label="Back to camera" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        />
      </Screen>
    );
  }

  const removePage = (i: number) => {
    const s = latest.current;
    if (!s) return;
    removeFile(s.pages[i].file);
    const next = { ...s, pages: s.pages.filter((_, j) => j !== i) };
    commit(next);
    setSel(Math.max(0, i - (i === next.pages.length ? 1 : 0)));
    return next.pages.length;
  };

  const move = (to: number) => {
    const s = latest.current;
    if (!s || to < 0 || to >= s.pages.length) return;
    const list = [...s.pages];
    [list[index], list[to]] = [list[to], list[index]];
    commit({ ...s, pages: list });
    setSel(to);
  };

  const retake = () => {
    removePage(index);
    router.back();
  };

  const remove = () => {
    if (removePage(index) === 0) router.back();
  };

  const save = async () => {
    const s = latest.current;
    if (!s || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input: SessionInput = {
        folderId: s.folderId,
        appendTo: s.appendTo,
        mode: s.mode,
        sheet: sheetChoice(s),
        pages: s.pages.map((p) => ({ file: `${base}/${p.file}`, quad: p.quad, rotation: p.rotation, filter: p.filter, side: p.side })),
      };
      const item = await (await getScanService()).saveSession(input, { title: title.trim() || undefined });
      discardSession();
      router.dismissAll();
      router.push({ pathname: '/scan/[id]', params: { id: item.id } });
    } catch (e) {
      setError(`The scan wasn't saved. Your pages are still here, so try Save again. ${errorMessage(e)}`);
      setSaving(false);
    }
  };

  const dim = dims[page.file];

  return (
    <Screen scroll>
      <Header
        title="Review"
        subtitle={plural(pages.length, card ? 'photo' : 'page')}
        trailing={<IconButton icon="camera-outline" label="Back to camera" onPress={() => router.back()} />}
      />
      {note ? <Notice tone="warn" title="Some photos were skipped" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setNote(null)} />}>{note}</Notice> : null}
      {error ? <Notice tone="danger" title="Something went wrong" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setError(null)} />}>{error}</Notice> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {pages.map((p, i) => (
          <Pressable
            key={p.file}
            onPress={() => setSel(i)}
            accessibilityRole="button"
            accessibilityLabel={`${card && p.side ? (p.side === 'front' ? 'Front' : 'Back') : `Page ${i + 1}`} of ${pages.length}`}
            accessibilityState={{ selected: i === index }}
            style={{ borderRadius: radius.control, borderWidth: 2, borderColor: i === index ? c.accent : c.line, overflow: 'hidden' }}
          >
            <Image source={{ uri: pathToUri(`${base}/${p.file}`) }} style={{ width: 64, height: 88 }} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>

      <Segmented<'crop' | 'preview'>
        accessibilityLabel="Page view"
        options={[
          { key: 'crop', label: 'Crop' },
          { key: 'preview', label: 'Preview' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'crop' ? (
        dim ? (
          <CropEditor uri={pathToUri(`${base}/${page.file}`)} imageWidth={dim.w} imageHeight={dim.h} quad={page.quad ?? FULL} onChange={(q) => patchPage(index, { quad: q })} />
        ) : (
          <ActivityIndicator color={c.accent} accessibilityLabel="Loading the photo" />
        )
      ) : (
        <View style={{ alignItems: 'center', minHeight: 160, justifyContent: 'center' }}>
          {preview ? <Image source={{ uri: preview.uri }} style={{ width: '100%', aspectRatio: preview.w / Math.max(1, preview.h) }} contentFit="contain" accessibilityLabel="Preview of the finished page" /> : null}
          {previewing ? <ActivityIndicator color={c.accent} accessibilityLabel="Making the preview" style={{ position: 'absolute' }} /> : null}
        </View>
      )}

      <FilterPicker value={page.filter} onChange={(f) => patchPage(index, { filter: f })} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button label="Rotate" size="sm" variant="secondary" onPress={() => patchPage(index, { rotation: ((page.rotation + 90) % 360) as SessionPage['rotation'] })} />
        <Button label="Retake" size="sm" variant="secondary" onPress={retake} />
        <Button label="Delete page" size="sm" variant="danger" onPress={remove} />
        {card ? null : (
          <>
            <Button label="Move left" size="sm" variant="secondary" disabled={index === 0} onPress={() => move(index - 1)} />
            <Button label="Move right" size="sm" variant="secondary" disabled={index === pages.length - 1} onPress={() => move(index + 1)} />
          </>
        )}
        <Button
          label="Apply filter to all"
          size="sm"
          variant="secondary"
          disabled={pages.length < 2}
          onPress={() => latest.current && commit({ ...latest.current, pages: latest.current.pages.map((p) => ({ ...p, filter: page.filter })) })}
        />
      </View>

      {session.appendTo ? (
        <Text tone="muted">These pages will be added to the end of the scan you opened.</Text>
      ) : (
        <Field label="Title" value={title} onChangeText={setTitle} autoCorrect={false} returnKeyType="done" accessibilityLabel="Title" />
      )}

      {card && pages.length <= 2 ? (
        <Segmented<'two' | 'sheet'>
          accessibilityLabel="Card layout"
          options={[
            { key: 'two', label: 'Two pages' },
            { key: 'sheet', label: 'One sheet' },
          ]}
          value={session.sheet ? 'sheet' : 'two'}
          onChange={(k) => latest.current && commit({ ...latest.current, sheet: k === 'sheet' })}
        />
      ) : null}

      <Button label="Save" block busy={saving} onPress={() => void save()} />
    </Screen>
  );
}
