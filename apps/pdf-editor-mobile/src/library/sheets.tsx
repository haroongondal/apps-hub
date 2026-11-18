import { LibraryError, type Item, type Tag } from '@apps-hub/library-core';
import { Button, confirmAction, Field, Group, Notice, RecordMenu, Row, Sheet, useTheme } from '@apps-hub/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';

import type { AddAction } from './add-actions';
import { plural } from './format';
import type { IconName } from './icon-button';
import { openLibrary } from './open-library';
import { errorMessage, folderChoices, type FolderChoice } from './use-library';

function RowIcon({ name, accent }: { name: IconName; accent?: boolean }) {
  const { c } = useTheme();
  return <Ionicons name={name} size={24} color={accent ? c.accent : c.text} />;
}

function Check({ on }: { on: boolean }) {
  const { c } = useTheme();
  return on ? <Ionicons name="checkmark" size={22} color={c.accent} /> : null;
}

export function AddSheet({
  actions,
  onPick,
  onClose,
}: {
  actions: readonly AddAction[];
  onPick: (action: AddAction) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible title="Add" onClose={onClose}>
      <Group>
        {actions.map((action) => (
          <Row key={action.key} title={action.label} leading={<RowIcon name={action.icon} accent />} onPress={() => onPick(action)} />
        ))}
      </Group>
    </Sheet>
  );
}

export function NameSheet({
  title,
  label,
  initial = '',
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(value);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Sheet visible title={title} doneLabel="Save" onClose={onClose} onDone={submit}>
      <Field label={label} value={value} onChangeText={setValue} error={error} autoFocus returnKeyType="done" onSubmitEditing={submit} />
    </Sheet>
  );
}

export function FolderPickerSheet({
  title,
  excludeId,
  currentId,
  onPick,
  onClose,
}: {
  title: string;
  excludeId: string | null;
  currentId: string | null;
  onPick: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<FolderChoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openLibrary()
      .then((lib) => folderChoices(lib, excludeId))
      .then(setChoices, (err) => setError(errorMessage(err)));
  }, [excludeId]);

  const pick = async (folderId: string | null) => {
    try {
      await onPick(folderId);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Sheet visible title={title} onClose={onClose}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Group>
        <Row
          title="Library (top level)"
          leading={<RowIcon name="library-outline" />}
          trailing={<Check on={currentId === null} />}
          onPress={() => pick(null)}
        />
        {choices.map((choice) => (
          <Row
            key={choice.id}
            title={choice.label}
            leading={<RowIcon name="folder-outline" />}
            trailing={<Check on={currentId === choice.id} />}
            onPress={() => pick(choice.id)}
          />
        ))}
      </Group>
    </Sheet>
  );
}

export function TagFilterSheet({
  tags,
  selected,
  onPick,
  onManage,
  onClose,
}: {
  tags: readonly Tag[];
  selected: string | null;
  onPick: (tagId: string | null) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible title="Filter by tag" onClose={onClose}>
      <Group>
        <Row title="All tags" trailing={<Check on={selected === null} />} onPress={() => onPick(null)} />
        {tags.map((tag) => (
          <Row
            key={tag.id}
            title={tag.name}
            subtitle={plural(tag.itemCount, 'item')}
            trailing={<Check on={selected === tag.id} />}
            onPress={() => onPick(tag.id)}
          />
        ))}
      </Group>
      <Button label="Manage tags" variant="secondary" block onPress={onManage} />
    </Sheet>
  );
}

// Waits for a closing sheet to finish, or one of the two modals is dropped.
const afterSheet = (run: () => void) => setTimeout(run, 300);

export function TagManageSheet({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [error, setError] = useState<string | undefined>();

  const refresh = async () => {
    setTags(await (await openLibrary()).listTags());
    onChanged();
  };
  const run = (work: () => Promise<unknown>) =>
    work().then(refresh, (err) => setError(errorMessage(err)));

  useEffect(() => {
    openLibrary()
      .then((lib) => lib.listTags())
      .then(setTags, (err) => setError(errorMessage(err)));
  }, []);

  const merge = (tag: Tag, name: string) =>
    afterSheet(() =>
      confirmAction({
        title: `Merge into \u201c${name}\u201d?`,
        message: `A tag with that name already exists. Items tagged \u201c${tag.name}\u201d get \u201c${name}\u201d instead, and \u201c${tag.name}\u201d is removed.`,
        confirmLabel: 'Merge',
        onConfirm: () => void run(async () => (await openLibrary()).renameTag(tag.id, name, { merge: true })),
      }),
    );

  const rename = (tag: Tag) => async (name: string) => {
    try {
      await (await openLibrary()).renameTag(tag.id, name);
      await refresh();
    } catch (err) {
      if (!(err instanceof LibraryError && err.code === 'duplicate_name')) throw err;
      const clean = name.trim();
      merge(tag, tags?.find((t) => t.name.toLowerCase() === clean.toLowerCase())?.name ?? clean);
    }
  };

  const actions = (tag: Tag) => [
    { label: 'Rename', onPress: () => afterSheet(() => setRenaming(tag)) },
    {
      label: 'Delete',
      destructive: true,
      confirmTitle: `Delete the tag \u201c${tag.name}\u201d?`,
      confirmMessage: `It is taken off ${plural(tag.itemCount, 'item')}. The items stay.`,
      confirmLabel: 'Delete tag',
      onPress: () => void run(async () => (await openLibrary()).deleteTag(tag.id)),
    },
  ];

  return (
    <Sheet visible title="Manage tags" onClose={onClose}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {tags !== null && tags.length === 0 ? <Notice tone="neutral">No tags yet. Add one from an item&rsquo;s menu.</Notice> : null}
      {tags !== null && tags.length > 0 ? (
        <Group footer="Renaming or deleting a tag changes every item that has it.">
          {tags.map((tag) => (
            <Row
              key={tag.id}
              title={tag.name}
              subtitle={plural(tag.itemCount, 'item')}
              trailing={<RecordMenu title={tag.name} actions={actions(tag)} />}
            />
          ))}
        </Group>
      ) : null}
      {renaming ? (
        <NameSheet
          title="Rename tag"
          label="Tag name"
          initial={renaming.name}
          onSubmit={rename(renaming)}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </Sheet>
  );
}

export function TagsSheet({
  item,
  onSave,
  onClose,
}: {
  item: Item;
  onSave: (names: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [known, setKnown] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const lib = await openLibrary();
      const [all, mine] = await Promise.all([lib.listTags(), lib.tagsFor(item.id)]);
      setKnown(all.map((t) => t.name));
      setSelected(mine.map((t) => t.name));
      setLoaded(true);
    })().catch((err) => setError(errorMessage(err)));
  }, [item.id]);

  // The typed name, spelt like an existing tag when one matches ignoring case.
  const draftTag = () => {
    const name = draft.trim();
    return name ? (known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name) : null;
  };
  const add = () => {
    const tag = draftTag();
    if (!tag) return;
    if (!known.includes(tag)) setKnown((k) => [...k, tag]);
    setSelected((s) => (s.includes(tag) ? s : [...s, tag]));
    setDraft('');
  };
  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

  const save = async () => {
    // Saving before the item's tags have loaded would replace them with nothing.
    if (!loaded) return;
    const tag = draftTag();
    try {
      await onSave(tag && !selected.includes(tag) ? [...selected, tag] : selected);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Sheet visible title="Tags" doneLabel="Save" onClose={onClose} onDone={save}>
      <Field
        label="Add a tag"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={add}
        returnKeyType="done"
        autoCapitalize="none"
        error={error}
      />
      {known.length > 0 ? (
        <Group>
          {[...known]
            .sort((a, b) => a.localeCompare(b))
            .map((name) => (
              <Row
                key={name}
                title={name}
                trailing={<Check on={selected.includes(name)} />}
                accessibilityLabel={selected.includes(name) ? `${name}, selected` : name}
                onPress={() => toggle(name)}
              />
            ))}
        </Group>
      ) : null}
    </Sheet>
  );
}
