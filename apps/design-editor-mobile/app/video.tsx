import {
  addClip, deleteClip, emptyProject, locate, moveClip, planCompose, projectProblem, sourceFrom, splitAt, totalS, trimAt,
  type MediaInfo, type Project,
} from '@apps-hub/media-core';
import { Button, Header, Notice, Screen, Text, radius, space, useTheme } from '@apps-hub/ui';
import { CompositionView, type CompositionViewHandle } from 'design-media';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AppState, View } from 'react-native';

import { plainError } from '../src/media/errors';
import { pickFiles, startJobs } from '../src/media/jobs';
import { timeText } from '../src/media/tools';
import { ClipStrip } from '../src/timeline/ClipStrip';
import { droppedNote, dropUnreadable } from '../src/video/draft';
import { canOpen, loadDraft, saveDraft } from '../src/video/draft-file';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const say = (e: unknown) => plainError(e, 'Something went wrong. Try again.');

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
        if (!selectedId) setSelectedId(next.clips[project.clips.length]?.id);
      }
    } catch (e) { setError(say(e)); }
  }

  function trimHere(edge: 'start' | 'end') {
    if (!here) return;
    setSelectedId(here.id);
    edit(trimAt(project, headS, edge), 'Move the line inside a clip, away from where it starts and ends.');
  }

  function remove() {
    if (selectedAt < 0) return;
    const next = deleteClip(project, selectedId!);
    setSelectedId(next.clips[Math.min(selectedAt, next.clips.length - 1)]?.id);
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
        return setError('Some clips could not be opened. Check your video, then save again.');
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
      <Header title="Make a video" subtitle="Join clips into one video, cut them and put them in order." />
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
          <ClipStrip project={project} selectedId={selectedId} onSelect={setSelectedId} seekS={seekS} onPlayhead={onPlayhead} onDrag={onDrag} />
        </>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Pair>
          <Half label="Add clips" disabled={!loaded} onPress={add} />
          <Half label="Cut here" disabled={!here} onPress={() => edit(splitAt(project, headS, newId()), 'Move the line inside a clip, away from its ends, to cut it.')} />
        </Pair>
        <Pair>
          <Half label="Start here" disabled={!here} onPress={() => trimHere('start')} accessibilityHint="The clip under the line starts here" />
          <Half label="End here" disabled={!here} onPress={() => trimHere('end')} accessibilityHint="The clip under the line ends here" />
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
      {project.clips.length && !planned.ok ? <Notice tone="warn">{projectProblem(project)}</Notice> : null}
      {project.clips.length ? <Text tone="muted">{`${project.clips.length === 1 ? '1 clip' : `${project.clips.length} clips`}, ${timeText(totalS(project))} in all`}</Text> : null}
    </Screen>
  );
}
