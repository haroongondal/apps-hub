import type { Item, Tag } from '@apps-hub/library-core';
import { Button, Field, Group, Notice, Row, Sheet, useTheme } from '@apps-hub/ui';
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
  onClose,
}: {
  tags: readonly Tag[];
  selected: string | null;
  onPick: (tagId: string | null) => void;
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
    </Sheet>
  );
}

export type ItemAction = 'rename' | 'move' | 'tags' | 'share' | 'delete';

export function ItemSheet({
  item,
  onAction,
  onClose,
}: {
  item: Item;
  onAction: (action: ItemAction) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible title={item.title} onClose={onClose}>
      <Group>
        <Row title="Rename" leading={<RowIcon name="create-outline" />} onPress={() => onAction('rename')} />
        <Row title="Move to folder" leading={<RowIcon name="folder-open-outline" />} onPress={() => onAction('move')} />
        <Row title="Tags" leading={<RowIcon name="pricetag-outline" />} onPress={() => onAction('tags')} />
        {item.kind === 'pdf' ? (
          <Row title="Share PDF" leading={<RowIcon name="share-outline" />} onPress={() => onAction('share')} />
        ) : null}
      </Group>
      <Button label="Delete" variant="danger" block onPress={() => onAction('delete')} />
    </Sheet>
  );
}

export function FolderSheet({
  onAction,
  onClose,
  name,
}: {
  name: string;
  onAction: (action: 'rename' | 'move' | 'delete') => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible title={name} onClose={onClose}>
      <Group>
        <Row title="Rename" leading={<RowIcon name="create-outline" />} onPress={() => onAction('rename')} />
        <Row title="Move to folder" leading={<RowIcon name="folder-open-outline" />} onPress={() => onAction('move')} />
      </Group>
      <Button label="Delete folder" variant="danger" block onPress={() => onAction('delete')} />
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

  useEffect(() => {
    (async () => {
      const lib = await openLibrary();
      const [all, mine] = await Promise.all([lib.listTags(), lib.tagsFor(item.id)]);
      setKnown(all.map((t) => t.name));
      setSelected(mine.map((t) => t.name));
    })().catch((err) => setError(errorMessage(err)));
  }, [item.id]);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const match = known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
    if (match === name) setKnown((k) => [...k, name]);
    setSelected((s) => (s.includes(match) ? s : [...s, match]));
    setDraft('');
  };
  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

  const save = async () => {
    try {
      await onSave(selected);
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
