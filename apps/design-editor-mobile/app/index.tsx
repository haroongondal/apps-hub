import DesignMedia, { type CodecInfo, type NativeJobStatus } from 'design-media';
import {
  DESTINATIONS,
  planSize,
  validateSpec,
  type Job,
  type MediaInfo,
  type Planned,
  type Refusal,
  type SizePlan,
  type SizeSpec,
} from '@apps-hub/media-core';
import { Button, Group, Header, Notice, Progress, Readout, Row, Screen, Segmented } from '@apps-hub/ui';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Share } from 'react-native';

type Encoder = SizeSpec['encoder'];

const TARGET_BYTES = DESTINATIONS[0].bytes;
const ENCODERS: { key: Encoder; label: string }[] = [
  { key: 'hw-h264', label: 'H.264' },
  { key: 'hw-hevc', label: 'HEVC' },
];
const MANUAL_STEPS: Record<string, string> = {
  S3: 'S3: start five jobs, swipe the app away, lock the phone for 10 minutes, then reopen and read the queue.',
  S5: 'S5: FrameDropEffect is compiled into TransformerRunner. FrameExtractor frame rate is measured in Phase 4.',
  S6: 'S6: the lossless CopyRunner lands in Phase 4. Nothing to run here yet.',
  S7: 'S7: build the release APK, record its size and the Media3 share from unzip -l, then compare with the previous release.',
  S8: 'S8: adb shell device_config put activity_manager media_processing_fgs_timeout_duration 60000, start a job, and expect a clean stop on onTimeout. Reset with device_config delete.',
};

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function refusalText(r: Refusal): string {
  if (r.reason === 'too-long') {
    return `Couldn't fit under ${mb(TARGET_BYTES)} MB. This file can hold about ${Math.floor(r.maxDurationS / 60)} minutes at the lowest quality.`;
  }
  return r.detail ?? `This file can't be planned (${r.reason}).`;
}

function codecLine(c: CodecInfo): string {
  const role = c.encoder ? 'encoder' : 'decoder';
  return `${c.name} (${role}): ${c.hardware ? 'hardware' : 'software'}, modes ${c.bitrateModes.join(', ') || 'none'}, up to ${c.maxWidth}×${c.maxHeight}, HDR editing ${c.hdrEditing ? 'yes' : 'no'}`;
}

function attemptText(job: NativeJobStatus): string {
  return job.attempts
    .map(a => `Try ${a.attempt} (${a.mode.toUpperCase()}): planned ${mb(a.plannedBytes)} MB, actual ${mb(a.actualBytes)} MB, ${a.seconds.toFixed(0)} s`)
    .join('\n');
}

export default function MediaLab() {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [encoder, setEncoder] = useState<Encoder>('hw-h264');
  const [queue, setQueue] = useState<NativeJobStatus[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    DesignMedia.queue().then(setQueue, e => setError(message(e)));
    const sub = DesignMedia.addListener('onQueue', e => setQueue(e.jobs));
    return () => sub.remove();
  }, []);

  const log = (line: string) => setResults(r => [...r, line]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  function pick() {
    return run('pick', async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['video/*'],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (picked.canceled) return;
      const probed = await DesignMedia.probe(picked.assets[0].uri);
      setInfo(probed);
      log(`Probed ${probed.name}: ${probed.durationS.toFixed(1)} s, ${mb(probed.bytes)} MB`);
    });
  }

  function startJobs(label: string, count: number, cbrOnly: boolean) {
    if (!info) {
      setError('Pick a file first.');
      return;
    }
    const spec: SizeSpec = { tool: 'size', inputId: info.id, targetBytes: TARGET_BYTES, encoder };
    const errors = validateSpec(spec, info, 'android');
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    const plan = planSize(info, TARGET_BYTES, encoder);
    if (!plan.ok) {
      setError(refusalText(plan));
      return;
    }
    return run(label, async () => {
      await DesignMedia.persistAccess(info.id);
      const jobs: Job[] = Array.from({ length: count }, (_, i) => ({
        id: `${label.toLowerCase()}-${Date.now()}-${i}`,
        inputId: info.id,
        inputName: info.name,
        plan: plan.plan,
        state: 'queued',
        progress: 0,
        attempt: 1,
        outputs: [],
      }));
      await DesignMedia.enqueue(JSON.stringify(jobs), cbrOnly);
      log(`${label}: queued ${count} × ${info.name} with ${encoder}${cbrOnly ? ', CBR only' : ''}`);
    });
  }

  const plan: Planned<SizePlan> | null = info
    ? planSize(info, TARGET_BYTES, encoder)
    : null;

  const spikes: { id: string; title: string; action: string; run: () => void }[] = [
    {
      id: 'S1',
      title: 'Codec report',
      action: 'Run',
      run: () => run('S1', async () => {
        const codecs = await DesignMedia.codecReport();
        codecs
          .filter(c => c.mime.startsWith('video/avc') || c.mime.startsWith('video/hevc'))
          .forEach(c => log(`S1 ${codecLine(c)}`));
      }),
    },
    { id: 'S2', title: 'Size job to 20 MB, selected encoder', action: 'Run', run: () => startJobs('S2', 1, false) },
    { id: 'S3', title: 'Five-job batch survives the swipe and lock', action: 'Run', run: () => startJobs('S3', 5, false) },
    { id: 'S4', title: 'CBR on this encoder', action: 'Run', run: () => startJobs('S4', 1, true) },
    { id: 'S5', title: 'Media3 classes and frame-rate tools', action: 'Log steps', run: () => log(MANUAL_STEPS.S5) },
    { id: 'S6', title: 'Lossless copy', action: 'Log steps', run: () => log(MANUAL_STEPS.S6) },
    { id: 'S7', title: 'APK size of Media3', action: 'Log steps', run: () => log(MANUAL_STEPS.S7) },
    { id: 'S8', title: 'Foreground time limit', action: 'Log steps', run: () => log(MANUAL_STEPS.S8) },
  ];

  return (
    <Screen scroll>
      <Header title="Media lab" subtitle="Phase 1 checks on this phone. Not for everyday use." />

      {error ? <Notice tone="danger" title="Something went wrong">{error}</Notice> : null}

      <Group title="File" footer="Originals are never changed. Outputs go to Movies/Design Editor.">
        <Row title={info ? info.name : 'No file picked'} subtitle={info ? `${info.durationS.toFixed(1)} s, ${mb(info.bytes)} MB` : 'Pick one video to probe it.'} />
        <Button label="Pick a video" variant="secondary" block busy={busy === 'pick'} onPress={pick} />
      </Group>

      {info ? (
        <Group title="Size job" footer={`Target ${mb(TARGET_BYTES)} MB, the Discord preset.`}>
          <Segmented options={ENCODERS} value={encoder} onChange={setEncoder} accessibilityLabel="Encoder" />
          {plan?.ok ? (
            <>
              <Readout value={mb(plan.plan.plannedBytes)} unit="MB" label="Planned size" />
              <Row
                title={`${plan.plan.width}×${plan.plan.height}, ${plan.plan.rung.fps} fps`}
                subtitle={`Video ${(plan.plan.videoBps / 1_000_000).toFixed(2)} Mbit/s, audio ${plan.plan.audio.mode}`}
              />
            </>
          ) : (
            <Notice tone="warn" title="Plan refused">{plan ? refusalText(plan) : ''}</Notice>
          )}
          <Button label="Start 20 MB job" block busy={busy === 'S2'} onPress={() => startJobs('S2', 1, false)} />
        </Group>
      ) : null}

      <Group title="Queue" footer="Attempts show planned against actual bytes, seconds and the encoder mode.">
        {queue.length === 0 ? <Row title="Queue is empty" /> : null}
        {queue.map(job => (
          <Row
            key={job.id}
            title={job.id}
            subtitle={`${job.state}, try ${job.attempt}${job.error ? `: ${job.error}` : ''}${job.attempts.length ? `\n${attemptText(job)}` : ''}`}
            trailing={job.state === 'running' || job.state === 'queued' ? (
              <Button label="Cancel" variant="ghost" onPress={() => DesignMedia.cancel(job.id).catch(e => setError(message(e)))} />
            ) : undefined}
          >
            {job.state === 'running' ? <Progress value={job.progress} /> : null}
          </Row>
        ))}
      </Group>

      <Group title="Spikes" footer="Phone-only spikes list their steps in the results below.">
        {spikes.map(s => (
          <Row key={s.id} title={`${s.id}: ${s.title}`} trailing={
            <Button label={s.action} variant="secondary" busy={busy === s.id} onPress={s.run} />
          } />
        ))}
      </Group>

      <Group title="Results" footer="Copy these into the handoff's evidence section.">
        {results.length === 0 ? <Row title="No results yet" /> : null}
        {results.map((line, i) => (
          <Row key={`${i}-${line}`} title={line} />
        ))}
        <Button
          label="Share results"
          variant="secondary"
          block
          onPress={() => { void Share.share({ message: results.join('\n') || 'No results yet.' }); }}
        />
      </Group>
    </Screen>
  );
}
