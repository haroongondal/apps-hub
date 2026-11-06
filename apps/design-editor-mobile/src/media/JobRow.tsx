import DesignMedia, { type NativeJobStatus } from 'design-media';
import { Button, Pill, Progress, Row } from '@apps-hub/ui';
import { Alert, View } from 'react-native';

import { plainError } from './errors';
import { tryAgain } from './jobs';
import { jobText } from './status';

const say = (e: unknown) => Alert.alert('Something went wrong', plainError(e, 'Try again.'));

export function JobRow({ job }: { job: NativeJobStatus }) {
  const { line, tone, label } = jobText(job);
  const out = job.outputs[0];
  const actions = job.state === 'running' || job.state === 'queued'
    ? <Button label="Stop" variant="ghost" onPress={() => DesignMedia.cancel(job.id).catch(say)} />
    : job.state === 'done' && out
      ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Button label="Share" variant="secondary" onPress={() => DesignMedia.share(out.ref).catch(say)} />
          <Button label="Open" variant="ghost" onPress={() => DesignMedia.open(out.ref).catch(say)} />
        </View>
      )
      : job.state === 'failed' || job.state === 'cancelled'
        ? <Button label="Try again" variant="secondary" onPress={() => { tryAgain(job.id).then(ok => { if (!ok) Alert.alert('Pick the file again', 'Start this from its tool.'); }, say); }} />
        : job.state === 'paused' || job.state === 'interrupted'
          ? <Button label="Resume" variant="secondary" onPress={() => DesignMedia.resume().catch(say)} />
          : null;
  return (
    <Row title={job.inputName} subtitle={line} trailing={<Pill label={label} tone={tone} />}>
      {job.state === 'running' ? <Progress value={job.progress} /> : null}
      {actions}
    </Row>
  );
}
