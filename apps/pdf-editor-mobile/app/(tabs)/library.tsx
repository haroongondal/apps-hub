import type { Folder, Item, ItemKind, Library } from '@apps-hub/library-core';
import { Button, confirmAction, Empty, Field, Header, Notice, Progress, RecordMenu, Screen, Segmented, space, type RecordAction } from '@apps-hub/ui';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addActions, type AddAction } from '../../src/library/add-actions';
import { exportPdf } from '../../src/library/files';
import { KIND_PLURAL } from '../../src/library/format';
import { IconButton } from '../../src/library/icon-button';
import { openItem } from '../../src/library/open-item';
import { openLibrary } from '../../src/library/open-library';
import { syncPlaceReminders } from '../../src/places/sync';
import { itemDir } from '../../src/library/paths';
import { FolderRow, ItemRow } from '../../src/library/rows';
import { AddSheet, FolderPickerSheet, NameSheet, TagFilterSheet, TagManageSheet, TagsSheet } from '../../src/library/sheets';
import { errorMessage, useDebounced, useLibraryData } from '../../src/library/use-library';
import { discardSession, loadSession } from '../../src/scan/session';

type SheetState =
  | { type: 'add' }
  | { type: 'newFolder' }
  | { type: 'tagFilter' }
  | { type: 'manageTags' }
  | { type: 'renameItem'; item: Item }
  | { type: 'moveItem'; item: Item }
  | { type: 'tags'; item: Item }
  | { type: 'renameFolder'; folder: Folder }
  | { type: 'moveFolder'; folder: Folder }
  | null;

const KINDS: ItemKind[] = ['pdf', 'scan', 'article', 'note', 'audio', 'image'];

export default function LibraryScreen() {
  const { folder } = useLocalSearchParams<{ folder?: string }>();
  const folderId = folder ?? null;
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const [unsavedPages, setUnsavedPages] = useState(0);
  const query = useDebounced(text, 200);
  const data = useLibraryData({ folderId, text: query, kind, tagId, sort });
  const { reload } = data;
  const current = data.path[data.path.length - 1] ?? null;
  const close = () => setSheet(null);

  useEffect(() => {
    if (tagId !== null && !data.loading && !data.error && !data.tags.some((t) => t.id === tagId)) setTagId(null);
  }, [tagId, data.loading, data.error, data.tags]);

  useFocusEffect(
    useCallback(() => {
      setUnsavedPages(loadSession()?.pages.length ?? 0);
    }, []),
  );

  const discardScan = () =>
    confirmAction({
      title: `Discard ${unsavedPages} scanned ${unsavedPages === 1 ? 'page' : 'pages'}?`,
      message: 'They haven\u2019t been saved and can\u2019t be brought back.',
      confirmLabel: 'Discard',
      onConfirm: () => {
        try {
          discardSession();
        } catch (error) {
          Alert.alert('Could not discard the scan', errorMessage(error));
        }
        setUnsavedPages(loadSession()?.pages.length ?? 0);
      },
    });

  const guard = useCallback(
    async (title: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        Alert.alert(title, errorMessage(error));
      } finally {
        void reload();
      }
    },
    [reload],
  );

  const write = async (work: (lib: Library) => Promise<unknown>) => {
    await work(await openLibrary());
    await reload();
  };

  const runAdd = async (action: AddAction) => {
    setSheet(null);
    setBusy(true);
    await guard('Could not add that', async () => {
      await action.run({ folderId, newFolder: () => setSheet({ type: 'newFolder' }) });
    });
    setBusy(false);
  };

  // A menu sheet must finish closing before the next sheet opens, or one of them is dropped.

  const itemActions = (item: Item): RecordAction[] => [
    { label: 'Rename', onPress: () => setSheet({ type: 'renameItem', item }) },
    { label: 'Move to folder', onPress: () => setSheet({ type: 'moveItem', item }) },
    { label: 'Tags', onPress: () => setSheet({ type: 'tags', item }) },
    ...(item.kind === 'pdf'
      ? [
          {
            label: 'Share PDF',
            onPress: () =>
              void guard('Could not share the PDF', async () => {
                await Sharing.shareAsync(exportPdf(item), { mimeType: 'application/pdf', dialogTitle: 'Share PDF', UTI: 'com.adobe.pdf' });
              }),
          },
        ]
      : []),
    {
      label: 'Delete',
      destructive: true,
      confirmTitle: `Delete \u201c${item.title}\u201d?`,
      confirmMessage: 'This removes it from this device and can\u2019t be undone.',
      onPress: () =>
        void guard('Could not delete it', async () => {
          await (await openLibrary()).deleteItem(item.id);
          await syncPlaceReminders();
          try {
            itemDir(item.id).delete();
          } catch {
            // the start-up sweep removes a directory that outlives its row
          }
        }),
    },
  ];

  const folderActions = (target: Folder): RecordAction[] => [
    { label: 'Rename', onPress: () => setSheet({ type: 'renameFolder', folder: target }) },
    { label: 'Move to folder', onPress: () => setSheet({ type: 'moveFolder', folder: target }) },
    {
      label: 'Delete',
      destructive: true,
      confirmTitle: `Delete the folder \u201c${target.name}\u201d?`,
      confirmMessage: 'Its items and subfolders move up one level. Nothing else is deleted.',
      confirmLabel: 'Delete folder',
      onPress: () =>
        void guard('Could not delete the folder', async () => {
          await (await openLibrary()).deleteFolder(target.id);
          if (target.id === folderId) {
            if (router.canGoBack()) router.back();
            else router.replace('/library');
          }
        }),
    },
  ];

  const filtering = query.trim() !== '' || kind !== null || tagId !== null;
  const shownKinds = KINDS.filter((k) => data.kinds.includes(k) || k === kind);
  const openPdfAction = addActions.find((a) => a.key === 'open-pdf');
  const scanAction = addActions.find((a) => a.key === 'scan');

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.lg }}>
      <Header
        title={current?.name ?? 'Library'}
        subtitle={current ? ['Library', ...data.path.map((f) => f.name)].join(' / ') : undefined}
        trailing={
          <View style={{ flexDirection: 'row' }}>
            {current ? <RecordMenu title={current.name} actions={folderActions(current)} accessibilityLabel="Folder actions" /> : null}
            <IconButton icon="add" label="Add" onPress={() => setSheet({ type: 'add' })} />
          </View>
        }
      />
      {unsavedPages > 0 ? (
        <Notice
          tone="accent"
          title={`Unsaved scan with ${unsavedPages} ${unsavedPages === 1 ? 'page' : 'pages'}`}
          action={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Resume" size="sm" onPress={() => router.push('/scan/capture')} />
              <Button label="Discard" size="sm" variant="secondary" onPress={discardScan} />
            </View>
          }
        />
      ) : null}
      {data.error ? (
        <Notice
          tone="danger"
          title="The library didn't load"
          action={<Button label="Try again" size="sm" variant="secondary" onPress={() => void reload()} />}
        >
          {data.error}
        </Notice>
      ) : null}
      <Field
        label="Search titles and text"
        value={text}
        onChangeText={setText}
        placeholder="Type a word"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {shownKinds.length > 1 || kind !== null ? (
        <Segmented<ItemKind | 'all'>
          accessibilityLabel="Show"
          options={[{ key: 'all', label: 'All' }, ...shownKinds.map((k) => ({ key: k, label: KIND_PLURAL[k] }))]}
          value={kind ?? 'all'}
          onChange={(k) => setKind(k === 'all' ? null : k)}
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {data.tags.length > 0 || tagId !== null ? (
          <Button
            size="sm"
            variant="secondary"
            label={tagId ? `Tag: ${data.tags.find((t) => t.id === tagId)?.name ?? 'removed'}` : 'Tags'}
            onPress={() => setSheet({ type: 'tagFilter' })}
          />
        ) : null}
        <Button size="sm" variant="ghost" label={`Sort: ${sort}`} onPress={() => setSort(sort === 'recent' ? 'title' : 'recent')} />
      </View>
      {busy ? <Progress value={null} /> : null}
    </View>
  );

  let empty = null;
  if (!data.loading && !data.error) {
    empty = filtering ? (
      <Empty title="Nothing found" body="Try different words, or clear the tag and type filters." />
    ) : current ? (
      <Empty title="This folder is empty" body="Open a PDF here, or move items into it." />
    ) : (
      <Empty
        title="Your library is empty"
        body="Scan a document or open a PDF. Everything stays on this device."
        action={
          <View style={{ gap: space.md }}>
            {scanAction ? <Button label="Scan a document" onPress={() => void runAdd(scanAction)} /> : null}
            {openPdfAction ? <Button label="Open a PDF" variant="secondary" onPress={() => void runAdd(openPdfAction)} /> : null}
          </View>
        }
      />
    );
  }

  return (
    <Screen>
      <FlatList
        data={data.rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) =>
          row.type === 'folder' ? (
            <FolderRow
              folder={row.folder}
              onOpen={() => router.push({ pathname: '/folder', params: { folder: row.folder.id } })}
              actions={folderActions(row.folder)}
            />
          ) : (
            <ItemRow
              item={row.item}
              snippet={row.snippet}
              where={row.where}
              onOpen={() => void guard('Could not open it', async () => void (await openItem(row.item)))}
              actions={itemActions(row.item)}
            />
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: insets.bottom + space.xxxl }}
      />

      {sheet?.type === 'add' && <AddSheet actions={addActions} onPick={(a) => void runAdd(a)} onClose={close} />}
      {sheet?.type === 'newFolder' && (
        <NameSheet title="New folder" label="Folder name" onSubmit={(name) => write((lib) => lib.createFolder(name, folderId))} onClose={close} />
      )}
      {sheet?.type === 'tagFilter' && (
        <TagFilterSheet
          tags={data.tags}
          selected={tagId}
          onPick={(id) => {
            setTagId(id);
            close();
          }}
          onManage={() => setSheet({ type: 'manageTags' })}
          onClose={close}
        />
      )}
      {sheet?.type === 'manageTags' && <TagManageSheet onChanged={() => void reload()} onClose={close} />}
      {sheet?.type === 'renameItem' && (
        <NameSheet
          title="Rename"
          label="Title"
          initial={sheet.item.title}
          onSubmit={(name) => write((lib) => lib.updateItem(sheet.item.id, { title: name }))}
          onClose={close}
        />
      )}
      {sheet?.type === 'moveItem' && (
        <FolderPickerSheet
          title="Move to folder"
          excludeId={null}
          currentId={sheet.item.folderId}
          onPick={(id) => write((lib) => lib.updateItem(sheet.item.id, { folderId: id }))}
          onClose={close}
        />
      )}
      {sheet?.type === 'tags' && (
        <TagsSheet item={sheet.item} onSave={(names) => write((lib) => lib.setItemTags(sheet.item.id, names))} onClose={close} />
      )}
      {sheet?.type === 'renameFolder' && (
        <NameSheet
          title="Rename folder"
          label="Folder name"
          initial={sheet.folder.name}
          onSubmit={(name) => write((lib) => lib.renameFolder(sheet.folder.id, name))}
          onClose={close}
        />
      )}
      {sheet?.type === 'moveFolder' && (
        <FolderPickerSheet
          title="Move folder"
          excludeId={sheet.folder.id}
          currentId={sheet.folder.parentId}
          onPick={(id) => write((lib) => lib.moveFolder(sheet.folder.id, id))}
          onClose={close}
        />
      )}
    </Screen>
  );
}
