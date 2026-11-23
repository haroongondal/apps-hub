import {
  audioSourceFrom, MAX_REEL_PHOTOS, parseReelQuery, pickReelPhotos, planCompose, projectProblem, REEL_SECONDS, reelProject, windowText,
  type AudioSource, type MediaInfo, type TakenPhoto,
} from '@apps-hub/media-core';
import { Button, Field, Group, Header, Notice, Pill, Progress, Row, Screen, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import DesignMedia from 'design-media';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';

import { plainError } from '../src/media/errors';
import { FreeSongs } from '../src/media/FreeSongs';
import { pickFiles, startJobs } from '../src/media/jobs';
import { isBusy, useQueue } from '../src/media/queue';
import { timeText } from '../src/media/tools';
import { DEPUTY_APPS, DEPUTY_TEXT, deputyDraft, NEXUS_TEXT, nexusProblem } from '../src/reel/links';

type Seconds = `${(typeof REEL_SECONDS)[number]}`;
const SECONDS = REEL_SECONDS.map(s => ({ key: `${s}` as Seconds, label: `${s} s` }));
const NAME = 'Reel';

interface Found { photos: TakenPhoto[]; more: number; about: string }

const say = (e: unknown) => plainError(e, 'Something went wrong. Try again.');

function Tile({ uri, chosen, size, label, onPress }: { uri: string; chosen: boolean; size: number; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={label}
      accessibilityHint={chosen ? 'Leaves this photo out' : 'Puts this photo back in'}
      style={{ width: size, height: size, borderRadius: radius.control, overflow: 'hidden', backgroundColor: c.raised, opacity: chosen ? 1 : 0.35 }}
    >
      <Image source={{ uri }} resizeMethod="resize" resizeMode="cover" style={{ width: size, height: size }} />
    </Pressable>
  );
}

export default function MakeAReel() {
  const tile = (useWindowDimensions().width - 2 * space.lg - 3 * space.xs) / 4;
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [left, setLeft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<Seconds>('3');
  const [song, setSong] = useState<AudioSource | null>(null);
  const [songsOpen, setSongsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [nexusNote, setNexusNote] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [caption, setCaption] = useState('');
  const [app, setApp] = useState('');
  const [asking, setAsking] = useState(false);
  const [deputy, setDeputy] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const job = useQueue().find(j => j.id === jobId);

  const chosen = found ? found.photos.filter(p => !left.includes(p.uri)) : [];
  const nexusHint = found && chosen.length ? nexusProblem(chosen.length) : null;
  const toggle = (uri: string) => setLeft(left.includes(uri) ? left.filter(u => u !== uri) : [...left, uri]);

  async function find() {
    setError(null);
    setNexusNote(null);
    const q = parseReelQuery(query, new Date());
    if (!q.words && !q.window) return setError('Type what to look for, like the beach trip or last weekend.');
    setFinding(true);
    try {
      const ranked = q.words ? await DesignMedia.searchPhotos(q.words) : null;
      const taken = await DesignMedia.photosTaken(q.window?.fromMs ?? 0, q.window?.toMs ?? Number.MAX_SAFE_INTEGER, ranked);
      const { photos, more } = pickReelPhotos(taken, ranked);
      const about = [q.words && `Photos of ${q.words}`, q.window && `${q.words ? 'from' : 'Photos from'} ${windowText(q.window)}`].filter(Boolean).join(' ');
      setFound({ photos, more, about });
      setLeft([]);
      setJobId(null);
      setDeputy(null);
    } catch (e) {
      setError(plainError(e, "The search didn't work. Try again."));
    } finally {
      setFinding(false);
    }
  }

  async function addSong() {
    setError(null);
    try {
      const [info] = await pickFiles(['audio'], false);
      if (!info) return;
      const s = audioSourceFrom(info);
      if (!s) return setError('That file has no sound. Pick a music or sound file.');
      setSong(s);
    } catch (e) { setError(say(e)); }
  }

  async function make() {
    setError(null);
    const uris = chosen.map(p => p.uri);
    const project = reelProject(uris, Number(seconds), NAME, song ?? undefined);
    const planned = planCompose(project);
    if (!planned.ok) return setError(projectProblem(project) ?? 'This reel cannot be made. Try fewer photos.');
    setStarting(true);
    try {
      const [id] = await startJobs([{ info: { id: uris[0], name: NAME } as MediaInfo, plan: planned.plan }]);
      setJobId(id);
      setDeputy(null);
    } catch (e) { setError(say(e)); } finally { setStarting(false); }
  }

  async function sendToNexus() {
    setNexusNote(null);
    try {
      setNexusNote(NEXUS_TEXT[await DesignMedia.sendToNexus(chosen.map(p => p.uri))]);
    } catch (e) { setNexusNote(plainError(e, 'Nexus could not be opened. Try again.')); }
  }

  async function askDeputy() {
    const draft = deputyDraft(target, caption, app);
    if (!draft.ok) return setDeputy({ tone: 'danger', text: draft.reason });
    setAsking(true);
    try {
      setDeputy(DEPUTY_TEXT[await DesignMedia.proposeDeputyTask(draft.extras.task, draft.extras.apps ?? [])]);
    } catch (e) { setDeputy({ tone: 'danger', text: plainError(e, 'Deputy could not be opened. Try again.') }); } finally { setAsking(false); }
  }

  const output = job?.state === 'done' ? job.outputs[0] : undefined;

  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <Header title="Make a reel from my photos" subtitle="Find photos, keep the ones you want, add music, and Design Editor makes a video. Everything stays on your phone." />

      <Field
        label="What should the reel show?"
        placeholder="last weekend, the beach trip, 2026-11-01 to 2026-11-15"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => { void find(); }}
        returnKeyType="search"
        hint="Words find photos by what is in them. Dates, like last weekend or March, keep photos taken then."
      />
      <Button label="Find photos" busy={finding} onPress={() => { void find(); }} accessibilityHint="Looks through your photos on this phone" />
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {found && !found.photos.length ? (
        <Notice tone="warn" title="No photos found">Try other words or dates. On the Photos tab, check that Design Editor may see your photos.</Notice>
      ) : null}

      {found && found.photos.length ? (
        <Group title={found.about} footer={found.more ? `Tap a photo to leave it out. ${found.more} more matched; a reel holds up to ${MAX_REEL_PHOTOS} photos.` : 'Tap a photo to leave it out.'}>
          <Text tone="muted">{`${chosen.length} of ${found.photos.length} photos chosen`}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {found.photos.map((p, i) => (
              <Tile key={p.uri} uri={p.uri} size={tile} chosen={!left.includes(p.uri)} label={`Photo ${i + 1} of ${found.photos.length}`} onPress={() => toggle(p.uri)} />
            ))}
          </View>
          <Button label="Send to Nexus" variant="secondary" block disabled={!!nexusHint || !chosen.length} onPress={() => { void sendToNexus(); }} accessibilityHint="Opens Nexus, which asks before it adds the chosen photos" />
          {nexusHint ? <Text tone="muted">{nexusHint}</Text> : null}
          {nexusNote ? <Notice>{nexusNote}</Notice> : null}
        </Group>
      ) : null}

      {chosen.length ? (
        <Group title="How the reel looks" footer={`${timeText(chosen.length * Number(seconds))} in all. Photos run oldest first.`}>
          <Segmented options={SECONDS} value={seconds} onChange={setSeconds} accessibilityLabel="How long each photo shows" />
          {song ? (
            <Row title={song.name} subtitle={`Music, ${timeText(song.durationS)}. It stops where the reel ends.`} trailing={<Button label="Remove" variant="ghost" size="sm" onPress={() => setSong(null)} />} />
          ) : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}><Button label="Music from this phone" variant="secondary" block onPress={() => { void addSong(); }} /></View>
              <View style={{ flex: 1 }}><Button label={songsOpen ? 'Hide free songs' : 'Free songs'} variant="secondary" block onPress={() => setSongsOpen(o => !o)} accessibilityHint="Searches free songs from Freesound" /></View>
            </View>
          )}
          {songsOpen && !song ? <FreeSongs onPick={async s => { setSong(s); setSongsOpen(false); }} /> : null}
          <Button label="Make the reel" busy={starting} disabled={!!job && isBusy(job)} onPress={() => { void make(); }} accessibilityHint="Adds the reel to the Queue; it is saved with your videos" />
        </Group>
      ) : null}

      {job && isBusy(job) ? (
        <View style={{ gap: space.sm }}>
          <Text>{job.state === 'running' ? 'Making your reel' : 'Your reel is waiting in the Queue'}</Text>
          <Progress value={job.state === 'running' ? job.progress : null} />
        </View>
      ) : null}
      {job?.state === 'failed' ? <Notice tone="danger" title="The reel was not made">{job.error ?? 'Try again.'}</Notice> : null}

      {output ? (
        <Group title="Your reel is ready" footer="It is saved in your Movies folder, under Design Editor.">
          <Row title={output.name} onPress={() => { DesignMedia.open(output.ref).catch(e => setError(say(e))); }} accessibilityHint="Plays the reel" />
          <Field label="Send it to" placeholder="the Family group on WhatsApp" value={target} onChangeText={setTarget} />
          <Field label="Caption" placeholder="Optional" value={caption} onChangeText={setCaption} />
          {DEPUTY_APPS.map(a => (
            <Row
              key={a.label}
              title={a.label}
              trailing={app === a.key ? <Pill label="Chosen" tone="accent" /> : undefined}
              onPress={() => setApp(a.key)}
              accessibilityHint={`Deputy uses ${a.label}`}
            />
          ))}
          <Button label="Send it with Deputy" busy={asking} onPress={() => { void askDeputy(); }} accessibilityHint="Opens a draft in Deputy; nothing is sent until you start it there" />
          <Text tone="muted">Deputy opens a draft with your words. Nothing is sent until you tap Start in Deputy, and it asks you again before it sends.</Text>
          {deputy ? <Notice tone={deputy.tone}>{deputy.text}</Notice> : null}
        </Group>
      ) : null}
    </Screen>
  );
}
