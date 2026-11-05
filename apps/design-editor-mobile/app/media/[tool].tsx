import DesignMedia from 'design-media';
import {
  DESTINATIONS, GIF_WARN_S, formatClock, formatMb, planAudio, planFor, refusalText,
  type MediaInfo, type Plan, type QualityName,
} from '@apps-hub/media-core';
import { Button, Field, Group, Header, Notice, Pill, Readout, Row, Screen, Segmented, radius, useTheme } from '@apps-hub/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'react-native';

import { plainError } from '../../src/media/errors';
import { pickFiles, startJobs } from '../../src/media/jobs';
import { loadPrefs, savePrefs } from '../../src/media/prefs';
import { specsFor, soundTracksOf, type Options } from '../../src/media/specs';
import { correctionFrom, parseTime, TOOLS, timeText, type ToolKey } from '../../src/media/tools';
import { RangeStrip } from '../../src/timeline/RangeStrip';
import { usePreviewFrame } from '../../src/timeline/usePreviewFrame';

const say = (e: unknown) => plainError(e, 'Something went wrong. Try again.');

export default function ToolSetup() {
  const { tool } = useLocalSearchParams<{ tool: ToolKey }>();
  const def = TOOLS.find(t => t.key === tool) ?? TOOLS[0];
  const single = def.key === 'trim' || def.key === 'gif' || def.key === 'picture';
  const [files, setFiles] = useState<MediaInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playheadS, setPlayheadS] = useState(0);
  const [keyframe, setKeyframe] = useState<number | undefined>();
  const [correction, setCorrection] = useState(1);
  // options
  const [dest, setDest] = useState('discord');
  const [customMb, setCustomMb] = useState('20');
  const [how, setHow] = useState<'size' | 'quality'>('size');
  const [quality, setQuality] = useState<QualityName>('medium');
  const [smaller, setSmaller] = useState(false);
  const [start, setStart] = useState('0:00.0');
  const [end, setEnd] = useState('0:10.0');
  const [cut, setCut] = useState<'copy' | 'exact'>('copy');
  const [skipped, setSkipped] = useState<Record<string, number[]>>({});
  const [gifWidth, setGifWidth] = useState('480');
  const [gifFps, setGifFps] = useState('12');
  const [gifMb, setGifMb] = useState('');
  const [kind, setKind] = useState<'video' | 'sound'>('video');
  const [muted, setMuted] = useState(false);
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [louder, setLouder] = useState<'even' | '-12' | '-6' | '6' | '12'>('even');
  const [withSound, setWithSound] = useState(true);
  const [level, setLevel] = useState<'minimum' | 'recommended' | 'most'>('recommended');

  const info = files[0];
  useEffect(() => { void loadPrefs().then(p => setSmaller(p.smallerFile)); }, []);
  useEffect(() => {
    DesignMedia.encoderStats().then(s => setCorrection(correctionFrom(s[`${smaller ? 'hw-hevc' : 'hw-h264'}/cbr`] ?? [])), () => undefined);
  }, [smaller]);

  const startS = parseTime(start);
  useEffect(() => {
    if (def.key !== 'trim' || !info || startS === undefined) return setKeyframe(undefined);
    DesignMedia.keyframeAtOrBefore(info.id, startS).then(setKeyframe, () => setKeyframe(undefined));
  }, [def.key, info, startS]);

  const timeline = def.key === 'trim' || def.key === 'gif' || def.key === 'picture';
  const frame = usePreviewFrame(timeline && info?.tracks.some(t => t.kind === 'video') ? info.id : undefined, playheadS);
  const { c } = useTheme();

  async function add() {
    setError(null);
    try {
      const picked = await pickFiles(def.accept, !single);
      if (!picked.length) return;
      setFiles(single ? picked.slice(0, 1) : [...files, ...picked]);
      if (!files.length || single) { // a second pick keeps the choices already made
        const first = picked[0];
        setPlayheadS(0);
        setStart('0:00.0'); setEnd(timeText(Math.min(first.durationS, def.key === 'gif' ? 10 : first.durationS)));
      }
    } catch (e) { setError(say(e)); }
  }

  const targetBytes = dest === 'custom' ? Math.round(Number(customMb) * 1_000_000) : DESTINATIONS.find(d => d.id === dest)!.bytes;

  const options: Options = {
    targetBytes, how, quality, smaller, startS, endS: parseTime(end), cut, skippedSounds: skipped,
    gifWidth: Number(gifWidth), gifFps: Number(gifFps), gifMb, kind, muted, format, louder, withSound, level,
  };
  const specs = (f: MediaInfo) => specsFor(def.key, f, options);

  const planned = useMemo(() => info
    ? specs(info).map(s => planFor(s, info, { platform: 'android', keyframeS: keyframe, correction }))
    : [], // eslint-disable-next-line react-hooks/exhaustive-deps
  [info, def.key, how, targetBytes, quality, smaller, start, end, cut, skipped, gifWidth, gifFps, gifMb, kind, muted, format, louder, withSound, level, keyframe, correction]);

  const endS = parseTime(end);
  const range = startS !== undefined && endS !== undefined && endS > startS ? { startS, endS } : { startS: 0, endS: info?.durationS ?? 0 };

  const refusal = planned.find(p => !p.ok);
  const first = planned[0]?.ok ? planned[0].plan : undefined;

  async function run() {
    setError(null);
    const items: { info: MediaInfo; plan: Plan }[] = [];
    for (const f of files) {
      for (const s of specs(f)) {
        const p = planFor(s, f, { platform: 'android', keyframeS: f === info ? keyframe : undefined, correction });
        if (!p.ok) return setError((files.length > 1 ? `${f.name}: ` : '') + refusalText(p, s.tool === 'size' ? s.targetBytes : undefined));
        items.push({ info: f, plan: p.plan });
      }
    }
    if (!items.length) return setError('Pick a file first.');
    setBusy(true);
    try {
      await startJobs(items);
      router.dismissTo('/queue'); // back to the tabs, not a second copy of them
    } catch (e) { setError(say(e)); } finally { setBusy(false); }
  }

  const choose = <K extends string>(options: { key: K; label: string }[], value: K, onChange: (k: K) => void, label: string) => (
    <Segmented options={options} value={value} onChange={onChange} accessibilityLabel={label} />
  );

  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <Header title={def.title} subtitle={def.about} />
      {error ? <Notice tone="danger" title="This can't start yet">{error}</Notice> : null}

      <Group title={single ? 'File' : 'Files'} footer="Your original files are never changed.">
        {files.map((f, n) => (
          <Row key={`${f.id}-${n}`} trailing={<Button label="Remove" variant="ghost" onPress={() => setFiles(files.filter((_, i) => i !== n))} />} title={f.name} subtitle={`${formatClock(f.durationS)} · ${formatMb(f.bytes)}${f.tracks.find(t => t.kind === 'video')?.width ? ` · ${f.tracks.find(t => t.kind === 'video')!.width}×${f.tracks.find(t => t.kind === 'video')!.height}` : ''}`} />
        ))}
        <Button label={files.length ? (single ? 'Choose another file' : 'Add more files') : 'Choose a file'} variant="secondary" block onPress={add} />
      </Group>

      {info ? (
        <>
          {def.key === 'smaller' ? (
            <Group title="How">
              {choose([{ key: 'size', label: 'Fit a size' }, { key: 'quality', label: 'Pick a quality' }], how, setHow, 'How to make it smaller')}
              {how === 'size' ? (
                <>
                  {DESTINATIONS.map(d => <Row key={d.id} title={d.label} subtitle={`Up to ${d.bytes / 1_000_000} MB`} trailing={dest === d.id ? <Button label="Chosen" variant="ghost" onPress={() => setDest(d.id)} /> : undefined} onPress={() => setDest(d.id)} />)}
                  <Row title="Your own size" subtitle="Type a size in MB" onPress={() => setDest('custom')} />
                  {dest === 'custom' ? <Field label="Size in MB" keyboardType="numeric" value={customMb} onChangeText={setCustomMb} /> : null}
                  {choose([{ key: 'works', label: 'Plays everywhere' }, { key: 'small', label: 'Smaller file' }], smaller ? 'small' : 'works', k => { setSmaller(k === 'small'); void savePrefs({ smallerFile: k === 'small' }); }, 'File type')}
                </>
              ) : choose([{ key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }, { key: 'small', label: 'Small' }], quality, setQuality, 'Quality')}
              {first && (first.tool === 'size' || first.tool === 'quality') ? (
                <>
                  {first.tool === 'size' ? <Readout value={formatMb(first.plannedBytes).replace(' MB', '')} unit="MB" label="Expected size" /> : null}
                  <Row title={`Picture size ${first.width}×${first.height}`} subtitle={`${first.rung.fps} frames a second`} />
                </>
              ) : null}
            </Group>
          ) : null}

          {def.key === 'trim' || def.key === 'gif' || def.key === 'picture' ? (
            <Group title={def.key === 'picture' ? 'Moment' : 'Range'}>
              {frame ? <Image source={{ uri: frame }} resizeMode="contain" accessibilityLabel="The picture at the line" style={{ height: 200, borderRadius: radius.control, backgroundColor: c.raised }} /> : null}
              <RangeStrip
                key={info.id}
                uri={info.id}
                durationS={info.durationS}
                hasVideo={info.tracks.some(t => t.kind === 'video')}
                hasSound={info.tracks.some(t => t.kind === 'audio')}
                mode={def.key === 'picture' ? 'point' : 'range'}
                range={range}
                onRange={r => { setStart(timeText(r.startS)); setEnd(timeText(r.endS)); }}
                onPlayhead={t => { setPlayheadS(t); if (def.key === 'picture') setStart(timeText(t)); }}
              />
              {def.key !== 'picture' ? <Row title={`Keeps ${timeText(range.endS - range.startS)}`} subtitle={`From ${timeText(range.startS)} to ${timeText(range.endS)}`} /> : null}
              <Field label={def.key === 'picture' ? 'Time (m:ss.s)' : 'Start (m:ss.s)'} value={start} onChangeText={setStart} />
              {def.key !== 'picture' ? <Field label="End (m:ss.s)" value={end} onChangeText={setEnd} /> : null}
              {def.key === 'trim' ? (
                <>
                  {choose([{ key: 'copy', label: 'Same quality, fast' }, { key: 'exact', label: 'Cut exactly here' }], cut, setCut, 'How to cut')}
                  {cut === 'copy' && keyframe !== undefined && startS !== undefined ? <Notice tone="accent">{`Starts at ${timeText(keyframe)}, the closest point before ${timeText(startS)} that keeps full quality.`}</Notice> : null}
                </>
              ) : null}
              {def.key === 'gif' ? (
                <>
                  {choose([{ key: '320', label: 'Small' }, { key: '480', label: 'Medium' }, { key: '640', label: 'Large' }], gifWidth, setGifWidth, 'GIF size')}
                  {choose([{ key: '8', label: 'Smooth 8' }, { key: '12', label: 'Smooth 12' }, { key: '15', label: 'Smooth 15' }], gifFps, setGifFps, 'Smoothness')}
                  <Field label="Keep under (MB, optional)" keyboardType="numeric" value={gifMb} onChangeText={setGifMb} />
                  {startS !== undefined && parseTime(end) !== undefined && parseTime(end)! - startS > GIF_WARN_S ? <Notice tone="warn">{`A GIF longer than ${GIF_WARN_S} seconds gets big. A shorter range works best.`}</Notice> : null}
                </>
              ) : null}
              {def.key === 'picture' ? choose([{ key: 'png', label: 'PNG' }, { key: 'jpg', label: 'JPEG' }], format, setFormat, 'Picture type') : null}
            </Group>
          ) : null}

          {def.key === 'sound' ? (
            <Group title="Sounds to save" footer="Each one is saved as its own file.">
              {files.flatMap(f => soundTracksOf(f).map((idx, n) => {
                const off = skipped[f.id]?.includes(idx);
                const track = f.tracks.find(t => t.index === idx)!;
                const planned = planAudio(track, 'android');
                const converts = planned.ok && planned.plan.mode === 'aac';
                return (
                  <Row
                    key={`${f.id}-${idx}`}
                    title={`${files.length > 1 ? `${f.name} · ` : ''}Sound ${n + 1}${track.language && track.language !== 'und' ? ` (${track.language})` : ''}`}
                    subtitle={off ? 'Skipped' : converts ? 'Will be saved, converted so it plays everywhere' : 'Will be saved'}
                    onPress={() => setSkipped({ ...skipped, [f.id]: off ? (skipped[f.id] ?? []).filter(k => k !== idx) : [...(skipped[f.id] ?? []), idx] })}
                  />
                );
              }))}
              {files.some(f => !soundTracksOf(f).length) ? <Notice tone="warn">A file you picked has no sound.</Notice> : null}
            </Group>
          ) : null}

          {def.key === 'format' ? (
            <Group title="Make">
              {choose([{ key: 'video', label: 'A video (MP4)' }, { key: 'sound', label: 'Sound only (M4A)' }], kind, setKind, 'What to make')}
              {kind === 'video' ? (
                <>
                  {choose([{ key: 'works', label: 'Plays everywhere' }, { key: 'small', label: 'Smaller file' }], smaller ? 'small' : 'works', k => { setSmaller(k === 'small'); void savePrefs({ smallerFile: k === 'small' }); }, 'File type')}
                  {choose([{ key: 'keep', label: 'Keep the sound' }, { key: 'remove', label: 'Remove the sound' }], muted ? 'remove' : 'keep', k => setMuted(k === 'remove'), 'Sound')}
                </>
              ) : null}
            </Group>
          ) : null}

          {def.key === 'volume' ? (
            <Group title="Change">
              {([['even', 'Even it out', 'Make quiet and loud parts closer'], ['-12', 'Much quieter', 'About a quarter as loud'], ['-6', 'Quieter', 'About half as loud'], ['6', 'Louder', 'About twice as loud'], ['12', 'Much louder', 'About four times as loud']] as const).map(([key, title, about]) => (
                <Row key={key} title={title} subtitle={about} trailing={louder === key ? <Pill label="Chosen" tone="accent" /> : undefined} onPress={() => setLouder(key)} />
              ))}
            </Group>
          ) : null}
          {def.key === 'backwards' ? (
            <Group title="Sound" footer="Works on videos up to 10 seconds.">{choose([{ key: 'with', label: 'Play it backwards too' }, { key: 'without', label: 'No sound' }], withSound ? 'with' : 'without', k => setWithSound(k === 'with'), 'Sound')}</Group>
          ) : null}
          {def.key === 'steady' ? (
            <Group title="How much">{choose([{ key: 'minimum', label: 'Keep more picture' }, { key: 'recommended', label: 'Balanced' }, { key: 'most', label: 'Steadiest' }], level, setLevel, 'How much to steady')}</Group>
          ) : null}

          {refusal && !refusal.ok ? <Notice tone="warn" title="This needs a change">{refusalText(refusal, def.key === 'smaller' && how === 'size' ? targetBytes : undefined)}</Notice> : null}
          <Button label={files.length > 1 ? `Start ${files.length} files` : 'Start'} block busy={busy} disabled={!!refusal || !planned.length} onPress={run} />
        </>
      ) : null}
    </Screen>
  );
}
