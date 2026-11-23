import type { Answer, Job } from '@apps-hub/knowledge-core';
import type { Item } from '@apps-hub/library-core';
import { Button, Empty, Header, Notice, Pill, Progress, radius, Screen, Segmented, space, Text, useTheme } from '@apps-hub/ui';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';

import { addPdf } from '../../src/library/files';
import { IconButton } from '../../src/library/icon-button';
import { openItem } from '../../src/library/open-item';
import { errorMessage } from '../../src/library/use-library';
import { aiReady } from '../../src/nexus/ai';
import { addNote, addPhoto, addRecording } from '../../src/nexus/capture';
import { citationLabel, jobLabel } from '../../src/nexus/labels';
import { currentMeeting, meetingStatus, meetingSupported } from '../../src/nexus/meeting';
import type { MeetingState } from '../../src/nexus/meeting-session';
import { openCitation } from '../../src/nexus/open-citation';
import { UnsavedMeeting } from '../../src/nexus/unsaved-meeting';
import { kick, onQueueChange, openKnowledge } from '../../src/nexus/worker';

const VOICE = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000 }; // speech: 64 kbps mono keeps ~50 min under the 25 MB upload limit
const RECENT = 50;

interface Card {
  item: Item;
  job: Job | null;
  found: { ideas: number; links: number };
  ideas: string[];
  keptOut: boolean;
}
interface Exchange {
  id: number;
  question: string;
  answer: Answer | null;
  error: string | null;
}

function useCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [hasKey, setHasKey] = useState(true);
  const [meeting, setMeeting] = useState<MeetingState>('none');
  const load = useCallback(async () => {
    currentMeeting()
      .then(setMeeting)
      .catch((err) => console.warn('Could not check the meeting recording', err));
    try {
      const kn = await openKnowledge();
      const items = await kn.lib.list({ everywhere: true, limit: RECENT, ownOnly: true }); // source items live in Library and Ask (R12)
      const keptOut = await kn.excludedIds();
      const next: Card[] = [];
      for (const item of items) {
        const job = await kn.job(item.id);
        next.push({
          item,
          job,
          found: await kn.summary(item.id),
          ideas: job?.status === 'done' ? (await kn.ideas(item.id)).map((i) => i.text) : [],
          keptOut: keptOut.has(item.id),
        });
      }
      setCards(next);
      setHasKey(await aiReady());
    } catch (err) {
      console.warn('Stream did not load', err);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onQueueChange(() => void load()), [load]);
  return { cards, hasKey, meeting, load };
}

function CaptureCard({ card, hasKey }: { card: Card; hasKey: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const status = jobLabel(card.job, card.item.kind, hasKey, card.found, card.keptOut);
  const retry = async () => {
    const kn = await openKnowledge();
    await kn.retry(card.item.id);
    await kick();
  };
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint="Shows the ideas Nexus found"
      style={{ backgroundColor: c.surface, borderRadius: radius.group, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: c.line }}
    >
      <Text variant="bodyStrong" numberOfLines={2}>
        {card.item.title}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <Pill label={status.label} tone={status.tone} />
      </View>
      {open ? (
        <View style={{ gap: space.sm }}>
          {card.ideas.slice(0, 5).map((idea, i) => (
            <Text key={i} variant="meta">
              {`• ${idea}`}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Open" size="sm" variant="secondary" onPress={() => void openItem(card.item)} />
            {card.job?.status === 'failed' ? <Button label="Try again" size="sm" variant="secondary" onPress={() => void retry()} /> : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function ExchangeView({ x }: { x: Exchange }) {
  const open = (c: Answer['citations'][number]) => openCitation(c).catch((err) => Alert.alert('Could not open it', errorMessage(err)));
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="bodyStrong">{x.question}</Text>
      {x.error ? <Notice tone="danger">{x.error}</Notice> : null}
      {x.answer ? <Text>{x.answer.text}</Text> : x.error ? null : <Text tone="muted">Thinking…</Text>}
      {x.answer?.citations.map((c) => (
        <Button key={c.n} label={citationLabel(c)} size="sm" variant="ghost" onPress={() => void open(c)} accessibilityHint="Opens the source" />
      ))}
    </View>
  );
}

export default function StreamScreen() {
  const { c } = useTheme();
  const { cards, hasKey, meeting, load } = useCards();
  const [mode, setMode] = useState<'capture' | 'ask'>('capture');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Exchange[]>([]);
  const recorder = useAudioRecorder(VOICE);
  const recording = useAudioRecorderState(recorder);

  const guard = async (title: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      Alert.alert(title, errorMessage(err));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    if (mode === 'capture') {
      return void guard('Could not save the note', () =>
        addNote(value).catch((err) => {
          setText(value); // keep the thought so it can be saved again
          throw err;
        }),
      );
    }
    const id = Date.now();
    setThread((t) => [{ id, question: value, answer: null, error: null }, ...t]);
    const settle = (patch: Partial<Exchange>) => setThread((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    openKnowledge()
      .then((kn) => kn.ask(value))
      .then((answer) => settle({ answer }))
      .catch((err) => settle({ error: errorMessage(err) }));
  };

  const toggleRecording = async () => {
    if (recording.isRecording) {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
      const uri = recorder.uri;
      if (uri) await guard('Could not save the recording', () => addRecording(uri));
      return;
    }
    if (meetingStatus()?.recording) {
      Alert.alert('A meeting is recording', 'Stop the meeting first, then record a voice note.');
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone is off', 'Allow the microphone for Nexus in Android settings to record voice notes.');
      return;
    }
    // On Android, expo-audio pauses every recorder when the app leaves the screen unless shouldPlayInBackground is set.
    await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const photo = () =>
    Alert.alert('Add a photo', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Choose a photo', onPress: () => void pickPhoto(false) },
      { text: 'Take a photo', onPress: () => void pickPhoto(true) },
    ]);
  const pickPhoto = (camera: boolean) =>
    guard('Could not add the photo', async () => {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Allow the camera for Nexus in Android settings to take photos.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
      const res = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = res.assets?.[0];
      if (!res.canceled && asset) await addPhoto(asset.uri);
    });
  const pdf = () =>
    guard('Could not add the PDF', async () => {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
      const asset = res.assets?.[0];
      if (res.canceled || !asset) return;
      await openItem(await addPdf(asset.uri, null, asset.name)); // the editor reads its pages, then Nexus queues it
    });

  const seconds = Math.floor(recording.durationMillis / 1000);
  const empty = (
    <Empty
      title={mode === 'capture' ? 'Nothing captured yet' : 'Ask your library'}
      body={
        mode === 'capture'
          ? 'Type a thought, record a voice note, or add a photo or PDF. Nexus files it and finds the ideas in it.'
          : 'Ask about anything you saved. Answers cite the page or the moment in a recording.'
      }
    />
  );

  return (
    <Screen>
      <FlatList<Card | Exchange>
        data={mode === 'capture' ? cards : thread}
        keyExtractor={(row) => ('item' in row ? row.item.id : String(row.id))}
        renderItem={({ item: row }) => ('item' in row ? <CaptureCard card={row} hasKey={hasKey} /> : <ExchangeView x={row} />)}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingBottom: space.lg }}>
            <Header title="Stream" trailing={<IconButton icon="key-outline" label="AI settings" onPress={() => router.push('/settings')} />} />
            {!hasKey ? (
              <Notice tone="accent" title="AI is off" action={<Button label="Add your key" size="sm" onPress={() => router.push('/settings')} />}>
                Add your Gemini and Groq keys, or turn on Nexus in AI hub, to transcribe, find ideas and ask questions. Until then nothing leaves this phone.
              </Notice>
            ) : null}
            {meeting === 'recording' ? (
              <Notice tone="danger" title="Recording a meeting" action={<Button label="Open" size="sm" onPress={() => router.push('/meeting')} />}>
                It keeps recording until you stop it.
              </Notice>
            ) : null}
            {meeting === 'unsaved' ? <UnsavedMeeting reason={meetingStatus()?.error} onDone={() => void load()} /> : null}
            <Segmented<'capture' | 'ask'>
              accessibilityLabel="Mode"
              options={[
                { key: 'capture', label: 'Capture' },
                { key: 'ask', label: 'Ask Nexus' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </View>
        }
      />
      {busy ? <Progress value={null} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, padding: space.sm, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface }}>
        {recording.isRecording ? (
          <Text style={{ flex: 1, padding: space.md }} accessibilityLiveRegion="polite">
            {`Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          </Text>
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={mode === 'capture' ? 'Write a thought' : 'Ask a question'}
            placeholderTextColor={c.faint}
            selectionColor={c.accent}
            accessibilityLabel={mode === 'capture' ? 'Note' : 'Question'}
            multiline
            style={{ flex: 1, maxHeight: 140, minHeight: 48, paddingHorizontal: space.md, color: c.text, fontSize: 16 }}
          />
        )}
        {mode === 'capture' ? (
          <>
            <IconButton icon={recording.isRecording ? 'stop-circle' : 'mic-outline'} label={recording.isRecording ? 'Stop and save the recording' : 'Record a voice note'} onPress={() => void toggleRecording().catch((err) => Alert.alert('Could not record', errorMessage(err)))} />
            {recording.isRecording ? null : (
              <>
                {meetingSupported ? <IconButton icon="people-outline" label="Record a meeting" onPress={() => router.push('/meeting')} /> : null}
                <IconButton icon="image-outline" label="Add a photo" onPress={photo} />
                <IconButton icon="document-outline" label="Add a PDF" onPress={() => void pdf()} />
              </>
            )}
          </>
        ) : null}
        {recording.isRecording ? null : <IconButton icon="arrow-up-circle" label={mode === 'capture' ? 'Save the note' : 'Ask'} onPress={send} />}
      </View>
    </Screen>
  );
}
