import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Notice, Segmented, Sheet, Text, confirmAction, space } from '@apps-hub/ui';
import InflowCore, { type JournalEntry, type JournalTag } from 'inflow-core';
import { Chips } from './Chips.tsx';
import { DELETE_ENTRY_MESSAGE, JOURNAL_TAGS, MAX_NOTE, MOODS, buildEntry, moodLabel, noteCounter, noteLength, toggleTag } from './journal.ts';
import { SAVE_ERROR } from './messages.ts';

// `JournalEntry` = edit it, 'new' = add one, null = closed.
export type JournalTarget = JournalEntry | 'new' | null;

const MOOD_OPTIONS = MOODS.map((m) => ({ key: String(m.value), label: String(m.value), a11yLabel: `${m.value}, ${m.label}` }));
const TAG_OPTIONS = JOURNAL_TAGS.map((t) => ({ key: t, label: t }));

export function JournalSheet({ target, onClose, onSaved }: { target: JournalTarget; onClose: () => void; onSaved: () => void }) {
  const [mood, setMood] = useState<number | null>(null);
  const [tags, setTags] = useState<JournalTag[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = target !== null && target !== 'new' ? target : null;

  useEffect(() => {
    if (target === null) return;
    setMood(editing?.mood ?? null);
    setTags(editing?.tags ?? []);
    setNote(editing?.note ?? '');
    setError(null);
  }, [target === null ? null : editing?.id ?? 'new']);

  const save = () => {
    const built = buildEntry(editing?.id ?? null, editing?.at ?? Date.now(), { mood, tags, note });
    if (typeof built === 'string') {
      setError(built);
      return;
    }
    try {
      const problem = InflowCore.saveJournal(built);
      if (problem !== null) {
        setError(problem);
        return;
      }
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };
  const remove = () => {
    if (editing === null) return;
    try {
      InflowCore.deleteJournal(editing.id);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };

  return (
    <Sheet visible={target !== null} onClose={onClose} title={editing ? 'Edit entry' : 'New entry'} doneLabel="Save" onDone={save}>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <View style={{ gap: space.xs + 2 }}>
        <Text variant="caption" tone="muted">Mood</Text>
        <Segmented options={MOOD_OPTIONS} value={mood === null ? '' : String(mood)} onChange={(k) => setMood(Number(k))} accessibilityLabel="Mood from 1 to 5" />
        <Text variant="meta" tone="muted">{mood === null ? '1 is very low, 5 is very good.' : `${mood}: ${moodLabel(mood)}`}</Text>
      </View>
      <Chips title="Anything you notice" options={TAG_OPTIONS} selected={tags} onToggle={(t) => setTags(toggleTag(tags, t))} />
      <Field
        label="Note"
        hint={noteCounter(note)}
        error={noteLength(note) > MAX_NOTE ? `Keep the note to ${MAX_NOTE} characters or fewer. ${noteCounter(note)}.` : null}
        value={note}
        onChangeText={setNote}
        multiline
        textAlignVertical="top"
        autoCapitalize="sentences"
        style={{ minHeight: 120, paddingTop: space.md }}
      />
      {editing !== null && <Button label="Delete entry" variant="danger" onPress={() => confirmAction({ title: 'Delete this entry?', message: DELETE_ENTRY_MESSAGE, confirmLabel: 'Delete', onConfirm: remove })} />}
    </Sheet>
  );
}
