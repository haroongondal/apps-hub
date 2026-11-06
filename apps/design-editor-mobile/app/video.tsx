import {
  addClip, addMusic, audioSourceFrom, deleteClip, deleteMusic, emptyProject, locate, MAX_MUSIC, moveClip, moveMusic, planCompose,
  projectProblem, setClipVolume, setMusicVolume, sourceFrom, splitAt, totalS, trimAt, trimMusicAt, unheardMusic, VOLUME_STEPS,
  type MediaInfo, type Project,
} from '@apps-hub/media-core';
import { Button, Group, Header, Notice, Screen, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import { CompositionView, type CompositionViewHandle } from 'design-media';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AppState, View } from 'react-native';

import { plainError } from '../src/media/errors';
import { pickFiles, startJobs } from '../src/media/jobs';
import { timeText } from '../src/media/tools';
import { ClipStrip } from '../src/timeline/ClipStrip';
import { droppedNote, dropUnreadable } from '../src/video/draft';
import { canOpen, loadDraft, saveDraft } from '../src/video/draft-file';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const say = (e: unknown) => plainError(e, 'Something went wrong. Try again.');

// The four steps of VOLUME_STEPS, in the same order.
type Loudness = 'mute' | 'quiet' | 'normal' | 'loud';
const LOUDNESS: { key: Loudness; label: string }[] = [
  { key: 'mute', label: 'Mute' }, { key: 'quiet', label: 'Quiet' }, { key: 'normal', label: 'Normal' }, { key: 'loud', label: 'Loud' },
];
const volumeOf = (k: Loudness) => VOLUME_STEPS[LOUDNESS.findIndex(o => o.key === k)];
const loudnessOf = (v: number): Loudness => {
  const gaps = VOLUME_STEPS.map(s => Math.abs(s - v));
  return LOUDNESS[gaps.indexOf(Math.min(...gaps))].key;
};

function Pair({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.sm }}>{children}</View>;
}
function Half(props: ComponentProps<typeof Button>) {
  return <View style={{ flex: 1 }}><Button variant="secondary" block {...props} /></View>;
}

export default function MakeAVideo() {
  const { c } = useTheme();
  const [project, setProject] = useState<Project>(emptyProject());
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [musicId, setMusicId] = useState<string>(); // one choice at a time: a clip or a piece of music
  const [headS, setHeadS] = useState(0);
  const [seekS, setSeekS] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const preview = useRef<CompositionViewHandle>(null);

  useEffect(() => {
    loadDraft().then(({ project: p, dropped }) => {
      setProject(p);
      if (dropped) setNote(droppedNote(dropped));
    }, () => undefined).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') setPlaying(false); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loaded) saveDraft(project).catch(() => setError('Your video could not be kept on the phone. Your clips are safe.'));
  }, [project, loaded]);

  const planned = useMemo(() => planCompose(project), [project]);
  const planJson = useMemo(() => (planned.ok ? JSON.stringify(planned.plan) : null), [planned]);
  const at = locate(project, headS);
  const here = at ? project.clips[at.index] : undefined;
  const selectedAt = project.clips.findIndex(cl => cl.id === selectedId);
  const chosenClip = project.clips[selectedAt];
  const chosenMusic = project.music.find(m => m.id === musicId);
  const unheard = unheardMusic(project);

  // Stable, so the strip's memoised blocks do not re-render on every playback tick.
  const chooseClip = useCallback((id: string | undefined) => { setSelectedId(id); setMusicId(undefined); }, []);
  const chooseMusic = useCallback((id: string) => { setMusicId(id); setSelectedId(undefined); }, []);

  const edit = (next: Project, fail?: string) => {
    setError(next === project && fail ? fail : null);
    if (next !== project) setProject(next);
  };

  async function add() {
    setError(null);
    setPlaying(false);
    try {
      const infos = await pickFiles(['video'], true);
      let next = project;
      let skipped = 0;
      for (const info of infos) {
        const s = sourceFrom(info);
        if (s) next = addClip(next, s, newId()); else skipped++;
      }
      const problem = next.clips.length ? projectProblem(next) : undefined;
      if (problem) return setError(problem);
      if (skipped) setError(skipped === 1 ? 'One file has no picture and was left out.' : `${skipped} files have no picture and were left out.`);
      if (next !== project) {
        setProject(next);
        if (!selectedId && !musicId) chooseClip(next.clips[project.clips.length]?.id);
      }
    } catch (e) { setError(say(e)); }
  }

  async function addTune() {
    setError(null);
    setPlaying(false);
    if (project.music.length >= MAX_MUSIC) return setError(`A video can have up to ${MAX_MUSIC} pieces of music.`);
    try {
      const [info] = await pickFiles(['audio'], false);
      if (!info) return;
      const s = audioSourceFrom(info);
      if (!s) return setError('That file has no sound. Pick a music or sound file.');
      const id = newId();
      const next = addMusic(project, s, id, headS);
      if (next === project) return setError('There is no room for music here. Move the line to a place without music.');
      setProject(next);
      chooseMusic(id);
    } catch (e) { setError(say(e)); }
  }

  // With a piece of music chosen, Start here and End here trim it; otherwise the clip under the line.
  function trimHere(edge: 'start' | 'end') {
    if (chosenMusic) {
      return edit(trimMusicAt(project, chosenMusic.id, headS, edge),
        edge === 'start' ? 'Move the line before the end of the music.' : 'Move the line after the start of the music.');
    }
    if (!here) return;
    chooseClip(here.id);
    edit(trimAt(project, headS, edge), 'Move the line inside a clip, away from where it starts and ends.');
  }

  function setVolume(k: Loudness) {
    if (chosenMusic) edit(setMusicVolume(project, chosenMusic.id, volumeOf(k)));
    else if (chosenClip) edit(setClipVolume(project, chosenClip.id, volumeOf(k)));
  }

  function remove() {
    if (selectedAt < 0) return;
    const next = deleteClip(project, selectedId!);
    chooseClip(next.clips[Math.min(selectedAt, next.clips.length - 1)]?.id);
    if (!next.clips.length) { setHeadS(0); setSeekS(undefined); } // a new strip starts at the beginning
    edit(next);
  }

  async function save() {
    if (!planned.ok) return;
    setError(null);
    setPlaying(false);
    setBusy(true);
    try {
      const { project: kept, dropped } = await dropUnreadable(project, canOpen);
      if (dropped) {
        setProject(kept);
        setNote(droppedNote(dropped));
        return setError('Some files could not be opened. Check your video, then save again.');
      }
      await startJobs([{ info: { id: planned.plan.clips[0].uri, name: project.name } as MediaInfo, plan: planned.plan }]);
      router.dismissTo('/queue');
    } catch (e) { setError(say(e)); } finally { setBusy(false); }
  }

  const onPlayhead = (t: number) => {
    setHeadS(t);
    if (!playing) void preview.current?.seekTo(t);
  };
  const onDrag = (dragging: boolean) => {
    if (dragging) setPlaying(false);
    void preview.current?.setScrubbing(dragging);
  };

  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <Header title="Make a video" subtitle="Join clips into one video, cut them, put them in order and add music." />
      {note ? <Notice tone="warn">{note}</Notice> : null}
      {error ? <Notice tone="danger" title="This needs a change">{error}</Notice> : null}

      {planJson ? (
        <CompositionView
          ref={preview}
          plan={planJson}
          playing={playing}
          onPosition={({ timeS }) => { setSeekS(timeS); setHeadS(timeS); }}
          onEnded={() => setPlaying(false)}
          onError={() => { setPlaying(false); setError('The preview cannot play here. Saving may still work.'); }}
          accessibilityLabel="Preview of your video"
          style={{ height: 150, borderRadius: radius.control, overflow: 'hidden', backgroundColor: c.raised }}
        />
      ) : (
        <View style={{ height: 150, borderRadius: radius.control, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }}>
          <Text tone="muted">{loaded ? 'Add clips to start.' : 'Opening your video…'}</Text>
        </View>
      )}

      {project.clips.length ? (
        <>
          <Button label={playing ? 'Pause' : 'Play'} variant="secondary" block disabled={!planJson} onPress={() => setPlaying(!playing)} />
          <ClipStrip
            project={project} selectedId={selectedId} onSelect={chooseClip} selectedMusicId={musicId} onSelectMusic={chooseMusic}
            seekS={seekS} onPlayhead={onPlayhead} onDrag={onDrag}
          />
        </>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Pair>
          <Half label="Add clips" disabled={!loaded} onPress={add} />
          <Half label="Cut here" disabled={!here} onPress={() => edit(splitAt(project, headS, newId()), 'Move the line inside a clip, away from its ends, to cut it.')} />
        </Pair>
        <Pair>
          <Half label="Start here" disabled={!here && !chosenMusic} onPress={() => trimHere('start')} accessibilityHint="The chosen music, or else the clip under the line, starts here" />
          <Half label="End here" disabled={!here && !chosenMusic} onPress={() => trimHere('end')} accessibilityHint="The chosen music, or else the clip under the line, ends here" />
        </Pair>
        <Pair>
          <Half label="Earlier" disabled={selectedAt <= 0} onPress={() => edit(moveClip(project, selectedId!, -1))} accessibilityHint="Moves the chosen clip one place earlier" />
          <Half label="Later" disabled={selectedAt < 0 || selectedAt >= project.clips.length - 1} onPress={() => edit(moveClip(project, selectedId!, 1))} accessibilityHint="Moves the chosen clip one place later" />
        </Pair>
        <Pair>
          <Half label="Delete clip" disabled={selectedAt < 0} onPress={remove} accessibilityHint="Takes the chosen clip out of the video; the file stays on your phone" />
          <Half label="Save video" variant="primary" busy={busy} disabled={!planned.ok} onPress={save} />
        </Pair>
      </View>

      <Group title="Sound" footer="Music comes from sound files on this phone and stops where the video ends.">
        {chosenClip && !chosenClip.source.hasAudio ? (
          <Text tone="muted">This clip has no sound of its own.</Text>
        ) : chosenMusic || chosenClip ? (
          <Segmented
            options={LOUDNESS}
            value={loudnessOf((chosenMusic ?? chosenClip)!.volume)}
            onChange={setVolume}
            accessibilityLabel={chosenMusic ? 'Volume of the chosen music' : 'Volume of the chosen clip'}
          />
        ) : (
          <Text tone="muted">Choose a clip or a piece of music to set how loud it is.</Text>
        )}
      </Group>
      {unheard.length ? (
        <Notice
          tone="warn"
          action={<Button label={unheard.length === 1 ? 'Remove it' : 'Remove them'} variant="secondary" size="sm" onPress={() => {
            if (musicId && unheard.includes(musicId)) setMusicId(undefined);
            edit({ ...project, music: project.music.filter(m => !unheard.includes(m.id)) });
          }} />}
        >
          {unheard.length === 1
            ? '1 piece of music starts after the video ends, so it is not heard.'
            : `${unheard.length} pieces of music start after the video ends, so they are not heard.`}
        </Notice>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Pair>
          <Half label="Add music" disabled={!loaded || !project.clips.length} onPress={addTune} accessibilityHint="Picks a sound file and starts it at the line" />
          <Half label="Delete music" disabled={!chosenMusic} onPress={() => { setMusicId(undefined); edit(deleteMusic(project, chosenMusic!.id)); }} accessibilityHint="Takes the chosen music out of the video; the file stays on your phone" />
        </Pair>
        <Pair>
          <Half label="Move here" disabled={!chosenMusic} onPress={() => edit(moveMusic(project, chosenMusic!.id, headS), 'Here the music would overlap other music or start at the very end. Move the line, then try again.')} accessibilityHint="The chosen music starts at the line" />
          <View style={{ flex: 1 }} />
        </Pair>
      </View>
      {project.clips.length && !planned.ok ? <Notice tone="warn">{projectProblem(project)}</Notice> : null}
      {project.clips.length ? <Text tone="muted">{`${project.clips.length === 1 ? '1 clip' : `${project.clips.length} clips`}, ${timeText(totalS(project))} in all`}</Text> : null}
    </Screen>
  );
}
