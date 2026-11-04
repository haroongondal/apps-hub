import DesignMedia from 'design-media';
import { visibleQueue } from '@apps-hub/media-core';
import { Button, Empty, Group, Header, Row } from '@apps-hub/ui';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { JobRow } from './JobRow';
import { forgetJobs } from './jobs';
import { isBusy, refreshQueue, useQueue } from './queue';

// The Queue tab shows five jobs; the full list is its own screen (PRD FR-9, AC-15).
export function QueueList({ all }: { all?: boolean }) {
  const jobs = useQueue();
  const { shown, hidden } = visibleQueue(jobs, all ? jobs.length : 5);
  // paused and interrupted jobs can be resumed, so clearing them is also asked about
  const busy = jobs.some(j => isBusy(j) || j.state === 'paused' || j.state === 'interrupted');

  function clear() {
    const run = () => { DesignMedia.clearQueue().then(forgetJobs).then(refreshQueue, () => undefined); };
    if (!busy) return run();
    Alert.alert('Stop and clear the queue?', 'Jobs that are running or waiting will stop. Files that are already saved stay on your phone.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Stop and clear', style: 'destructive', onPress: run },
    ]);
  }

  return (
    <>
      <Header
        title={all ? 'All jobs' : 'Queue'}
        subtitle={jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}` : undefined}
        trailing={jobs.length ? <Button label="Clear queue" variant="ghost" onPress={clear} /> : undefined}
      />
      {jobs.length === 0 ? (
        <Empty title="Nothing here yet" body="Pick a tool on the Media tab. Your jobs show up here, and keep running when you leave the app." />
      ) : (
        <Group footer="Saved files stay on your phone when you clear the list.">
          {shown.map(job => <JobRow key={job.id} job={job} />)}
          {hidden > 0 ? <Row title={`See all ${jobs.length}`} subtitle={`${hidden} more not shown`} onPress={() => router.push('/queue/all')} accessibilityHint="Opens the full list" /> : null}
        </Group>
      )}
    </>
  );
}
