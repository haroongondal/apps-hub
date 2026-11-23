import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Row, Screen, Text, space } from '@apps-hub/ui';
import InflowCore, { type JournalEntry } from 'inflow-core';
import { JournalSheet, type JournalTarget } from './JournalSheet.tsx';
import { LOAD_FAILED, PAGE_SIZE, appendPage, entryTime, groupByDay, moodLabel, nextCursor } from './journal.ts';
import { MEDICAL_LINE } from './medicines.ts';
import { useHardwareBack } from './useHardwareBack.ts';

// A private mood and symptom journal, newest first, grouped by day. Saving or deleting reloads the first page.
export function JournalScreen({ onBack }: { onBack: () => void }) {
  useHardwareBack(onBack);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<JournalTarget>(null);

  const load = useCallback(() => {
    try {
      const page = InflowCore.journalList(null, PAGE_SIZE);
      setEntries(page);
      setCursor(nextCursor(page, PAGE_SIZE));
      setError(null);
    } catch {
      setError(LOAD_FAILED);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(load, [load]);

  const older = () => {
    if (cursor === null) return;
    try {
      const page = InflowCore.journalList(cursor, PAGE_SIZE);
      setEntries((shown) => appendPage(shown, page));
      setCursor(nextCursor(page, PAGE_SIZE));
    } catch {
      setError(LOAD_FAILED);
    }
  };

  const groups = groupByDay(entries, Date.now());
  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="Journal" trailing={<Button label="New entry" variant="secondary" size="sm" onPress={() => setEditing('new')} />} />
      </View>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {loaded && error === null && entries.length === 0 && <Empty title="No entries yet" body="Write down how you feel and anything you notice. Entries stay on this phone unless you put them in a Doctor summary and send it." />}
      {groups.map((g) => (
        <Group key={g.day} title={g.title}>
          {g.entries.map((e) => (
            <Row
              key={e.id}
              title={`${entryTime(e.at)}. ${moodLabel(e.mood)}`}
              accessibilityLabel={`Edit entry from ${g.title} at ${entryTime(e.at)}`}
              subtitle={
                e.tags.length === 0 && e.note === '' ? undefined : (
                  <View style={{ gap: 2 }}>
                    {e.tags.length > 0 && <Text variant="meta" tone="muted">{e.tags.join(', ')}</Text>}
                    {e.note !== '' && <Text variant="meta" numberOfLines={2}>{e.note}</Text>}
                  </View>
                )
              }
              onPress={() => setEditing(e)}
            />
          ))}
        </Group>
      ))}
      {cursor !== null && <Button label="Show older entries" variant="secondary" onPress={older} />}
      <Text variant="meta" tone="muted">{MEDICAL_LINE}</Text>
      <JournalSheet
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </Screen>
  );
}
