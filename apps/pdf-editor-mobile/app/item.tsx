import { locatorLabel, type Job, type MinutesAction, type MinutesPoint, type SavedMinutes, type Segment } from '@apps-hub/knowledge-core';
import type { Item, PlaceReminder } from '@apps-hub/library-core';
import { Button, confirmAction, Field, Group, Header, Notice, Pill, Progress, Row, Screen, space, Text } from '@apps-hub/ui';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { openItem } from '../src/library/open-item';
import { openLibrary } from '../src/library/open-library';
import { itemFile } from '../src/library/paths';
import { errorMessage, useDebounced } from '../src/library/use-library';
import { hasKeys } from '../src/nexus/ai';
import { saveNote } from '../src/nexus/capture';
import { audioFile } from '../src/nexus/content';
import { jobLabel, minutesDetail, minutesError, seekTo } from '../src/nexus/labels';
import { isMakingMinutes, makeMinutes } from '../src/nexus/minutes';
import { enqueue, kick, onQueueChange, openKnowledge } from '../src/nexus/worker';
import { describePlace } from '../src/places/describe';
import { PlaceSheet } from '../src/places/place-sheet';
import { syncPlaceReminders } from '../src/places/sync';

interface Loaded {
  item: Item;
  job: Job | null;
  found: { ideas: number; links: number };
  ideas: { text: string; locator: Segment['locator'] }[];
  segments: Segment[];
  related: Item[];
  hasKey: boolean;
  places: PlaceReminder[];
  keptOut: boolean;
  minutes: SavedMinutes | null;
  makingMinutes: boolean;
}

const SAVE_MS = 800;
const REINDEX_MS = 5000; // PRD FR-1: re-index a note after 5 s without typing

function NoteEditor({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const saved = useRef<string | null>(null);
  const indexed = useRef<string | null>(null);
  latest.current = text;
  const toSave = useDebounced(text, SAVE_MS);
  const toIndex = useDebounced(text, REINDEX_MS);

  useEffect(() => {
    const file = itemFile(item.id, 'note.md');
    void (file.exists ? file.text() : Promise.resolve('')).then((t) => {
      saved.current = t;
      indexed.current = t;
      setText(t);
    });
  }, [item.id]);
  useEffect(() => {
    if (toSave === null || toSave === saved.current) return;
    saved.current = toSave;
    saveNote(item, toSave)
      .then(onSaved)
      .catch((err) => Alert.alert('Could not save the note', errorMessage(err)));
  }, [toSave, item, onSaved]);
  useEffect(() => {
    if (toIndex === null || toIndex === indexed.current) return;
    indexed.current = toIndex;
    void enqueue(item.id);
  }, [toIndex, item.id]);
  useEffect(
    () => () => {
      // Leaving inside the debounce windows must not drop the last edit or its re-index.
      const last = latest.current;
      if (last === null) return;
      const save = last === saved.current ? Promise.resolve() : saveNote(item, last);
      void save.then(() => (last === indexed.current ? undefined : enqueue(item.id))).catch((err) => console.warn('Could not save the note', err));
    },
    [item],
  );

  if (text === null) return null;
  return <Field label="Note" value={text} onChangeText={setText} multiline textAlignVertical="top" style={{ minHeight: 200, paddingVertical: space.md }} />;
}

function MinutesSection({ item, saved, making, playFrom }: { item: Item; saved: SavedMinutes | null; making: boolean; playFrom: (sec: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  const make = () => {
    setError(null);
    makeMinutes(item.id).catch((err) => setError(minutesError(err)));
  };
  const again = () =>
    confirmAction({
      title: 'Replace these minutes?',
      message: 'Nexus sends the transcript to Groq again, or to Gemini when Groq cannot answer, and replaces the minutes you have now.',
      confirmLabel: 'Replace',
      onConfirm: make,
    });
  const point = (p: MinutesPoint | MinutesAction, i: number) => (
    <Row
      key={i}
      title={<Text>{p.text}</Text>}
      subtitle={minutesDetail(p)}
      onPress={() => playFrom(seekTo(p))}
      accessibilityHint="Plays the recording from where this was said"
    />
  );
  const found = saved ? saved.minutes.decisions.length + saved.minutes.actions.length : 0;

  return (
    <>
      <Group
        title="Minutes"
        footer={
          saved
            ? undefined
            : 'Nexus sends this transcript to Groq, or to Gemini when Groq cannot answer, to write a summary, the decisions and the action items, each with the time it was said. To make the minutes searchable, it sends them to Gemini when a Gemini key is set.'
        }
      >
        {saved ? <Row title={<Text>{saved.minutes.summary}</Text>} /> : null}
        {making ? (
          <Row title="Making minutes…">
            <Progress value={null} />
          </Row>
        ) : null}
      </Group>
      {error ? (
        <Notice tone="warn" title="Couldn't make the minutes">
          {error}
        </Notice>
      ) : null}
      {saved?.stale ? <Notice tone="warn">The transcript changed after these minutes were made. Make them again to match it.</Notice> : null}
      {saved && found === 0 ? <Text tone="muted">No decisions or action items were found.</Text> : null}
      {saved?.minutes.decisions.length ? (
        <Group title="Decisions" footer="Tap one to play from where it was said.">
          {saved.minutes.decisions.map(point)}
        </Group>
      ) : null}
      {saved?.minutes.actions.length ? <Group title="Action items">{saved.minutes.actions.map(point)}</Group> : null}
      {making ? null : saved ? (
        <Button label="Make minutes again" variant="secondary" onPress={again} />
      ) : (
        <Button label="Make minutes" onPress={make} accessibilityHint="Sends the transcript to Groq, or to Gemini when Groq cannot answer" />
      )}
    </>
  );
}

function Recording({
  item,
  segments,
  at,
  minutes,
}: {
  item: Item;
  segments: Segment[];
  at: number | null;
  minutes?: (playFrom: (sec: number) => void) => ReactNode;
}) {
  const player = useAudioPlayer(audioFile(item.id).file.uri);
  const status = useAudioPlayerStatus(player);
  const sought = useRef(false);
  const playFrom = useCallback(
    (sec: number) => {
      void player.seekTo(sec).then(() => player.play());
    },
    [player],
  );
  useEffect(() => {
    if (at !== null && status.isLoaded && !sought.current) {
      sought.current = true;
      playFrom(at);
    }
  }, [at, status.isLoaded, playFrom]);

  return (
    <>
      <Button
        label={status.playing ? 'Pause' : 'Play'}
        onPress={() => {
          if (status.playing) player.pause();
          else if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) playFrom(0); // ExoPlayer won't restart from the end
          else player.play();
        }}
      />
      {minutes?.(playFrom)}
      {segments.length ? (
        <Group title="Transcript" footer="Tap a line to play from there.">
          {segments.map((s, i) => (
            <Row
              key={i}
              title={<Text>{s.text}</Text>}
              subtitle={locatorLabel(s.locator)}
              onPress={() => s.locator && 'startSec' in s.locator && playFrom(s.locator.startSec)}
              accessibilityHint="Plays the recording from this line"
            />
          ))}
        </Group>
      ) : null}
    </>
  );
}

export default function ItemScreen() {
  const params = useLocalSearchParams<{ id: string; at?: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);

  const load = useCallback(async () => {
    const kn = await openKnowledge();
    const item = await kn.lib.getItem(params.id);
    if (!item) return setMissing(true);
    const job = await kn.job(item.id);
    setData({
      item,
      job,
      found: await kn.summary(item.id),
      ideas: await kn.ideas(item.id),
      segments: item.kind === 'note' ? [] : await kn.segmentsOf(item.id),
      related: (await kn.related(item.id)).map((r) => r.item),
      hasKey: await hasKeys(),
      places: await kn.lib.listReminders(item.id),
      keptOut: await kn.isExcluded(item.id),
      minutes: item.kind === 'audio' ? await kn.minutes(item.id) : null,
      makingMinutes: isMakingMinutes(item.id),
    });
  }, [params.id]);
  useEffect(() => {
    void load();
    return onQueueChange(() => void load());
  }, [load]);

  const close = <IconButton icon="close" label="Close" onPress={() => router.back()} />;
  if (missing) {
    return (
      <Screen scroll>
        <Header title="Not found" trailing={close} />
        <Notice tone="danger">This item is no longer in your library.</Notice>
      </Screen>
    );
  }
  if (!data) return <Screen>{null}</Screen>;
  const { item, job } = data;
  const status = jobLabel(job, item.kind, data.hasKey, data.found, data.keptOut);
  const retry = async () => {
    await (await openKnowledge()).retry(item.id);
    await kick();
  };
  const at = params.at ? Number(params.at) : null;
  const removePlace = async (place: PlaceReminder) => {
    try {
      await (await openLibrary()).removeReminder(place.id);
      await syncPlaceReminders();
      await load();
    } catch (err) {
      Alert.alert('Could not remove the reminder', errorMessage(err));
    }
  };

  return (
    <Screen scroll>
      <Header title={item.title} trailing={close} />
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Pill label={status.label} tone={status.tone} />
        {job?.status === 'failed' ? <Button label="Try again" size="sm" variant="secondary" onPress={() => void retry()} /> : null}
      </View>

      {item.kind === 'note' ? <NoteEditor item={item} onSaved={() => void load()} /> : null}
      {item.kind === 'audio' ? (
        <Recording
          item={item}
          segments={data.segments}
          at={Number.isFinite(at) ? at : null}
          minutes={
            data.segments.length && !data.keptOut
              ? (playFrom) => <MinutesSection item={item} saved={data.minutes} making={data.makingMinutes} playFrom={playFrom} />
              : undefined
          }
        />
      ) : null}
      {item.kind === 'image' ? (
        <>
          <Image
            source={{ uri: itemFile(item.id, 'image.jpg').uri }}
            style={{ width: '100%', aspectRatio: 3 / 4 }}
            contentFit="contain"
            accessibilityLabel={item.title}
          />
          {data.segments.length ? <Text>{data.segments.map((s) => s.text).join('\n')}</Text> : null}
        </>
      ) : null}

      <Group title="Place reminders" footer="Reminders need precise and background location.">
        {data.places.map((p) => (
          <Row
            key={p.id}
            title={describePlace(p)}
            onPress={() =>
              confirmAction({
                title: 'Remove this reminder?',
                message: describePlace(p),
                confirmLabel: 'Remove',
                onConfirm: () => void removePlace(p),
              })
            }
            accessibilityHint="Removes this reminder"
          />
        ))}
        <Row title="Add a place" onPress={() => setPlaceOpen(true)} accessibilityHint="Opens the place reminder form" />
      </Group>
      {placeOpen ? <PlaceSheet item={item} onSaved={() => void load()} onClose={() => setPlaceOpen(false)} /> : null}

      {data.ideas.length ? (
        <Group title="Ideas">
          {data.ideas.map((idea, i) => (
            <Row key={i} title={<Text>{idea.text}</Text>} subtitle={idea.locator ? locatorLabel(idea.locator) : undefined} />
          ))}
        </Group>
      ) : null}
      {data.related.length ? (
        <Group title="Related">
          {data.related.map((r) => (
            <Row key={r.id} title={r.title} onPress={() => void openItem(r)} accessibilityHint="Opens it" />
          ))}
        </Group>
      ) : null}
    </Screen>
  );
}
