import DesignMedia, { type NativeJobStatus } from 'design-media';
import { Button, Pill, Progress, RecordMenu, Row, space } from '@apps-hub/ui';
import { Alert, View } from 'react-native';

import { plainError } from './errors';
import { removeJob, tryAgain } from './jobs';
import { isBusy } from './queue';
import { jobText } from './status';

const say = (e: unknown) => Alert.alert('Something went wrong', plainError(e, 'Try again.'));

export function JobRow({ job }: { job: NativeJobStatus }) {
  const { line, tone, label } = jobText(job);
  const out = job.outputs[0];
  const actions = job.state === 'running' || job.state === 'queued'
    ? <Button label="Stop" variant="ghost" onPress={() => DesignMedia.cancel(job.id).catch(say)} />
    : job.state === 'done' && out && job.tool !== 'photo-index'
      ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Button label="Share" variant="secondary" onPress={() => DesignMedia.share(out.ref).catch(say)} />
          <Button label="Open" variant="ghost" onPress={() => DesignMedia.open(out.ref).catch(say)} />
        </View>
      )
      : job.state === 'failed' || job.state === 'cancelled'
        ? <Button label="Try again" variant="secondary" onPress={() => {
          if (job.tool === 'photo-index') DesignMedia.startPhotoIndex().catch(say);
          else tryAgain(job.id).then(ok => { if (!ok) Alert.alert('Pick the file again', 'Start this from its tool.'); }, say);
        }} />
        : job.state === 'paused' || job.state === 'interrupted'
          ? <Button label="Resume" variant="secondary" onPress={() => DesignMedia.resume().catch(say)} />
          : null;
  const removable = !isBusy(job);
  const trailing = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Pill label={label} tone={tone} />
      {removable ? (
        <RecordMenu
          title={job.inputName}
          actions={[{
            label: 'Remove from list',
            destructive: true,
            confirmTitle: `Remove \u201c${job.inputName}\u201d from the list?`,
            confirmMessage: 'Files this job saved stay on your phone.',
            confirmLabel: 'Remove',
            onPress: () => { removeJob(job.id).catch(say); },
          }]}
        />
      ) : null}
    </View>
  );
  return (
    <Row title={job.inputName} subtitle={line} trailing={trailing}>
      {job.state === 'running' ? <Progress value={job.progress} /> : null}
      {actions}
    </Row>
  );
}
