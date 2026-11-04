import { Button, Screen } from '@apps-hub/ui';
import { router } from 'expo-router';

import { QueueList } from '../../src/media/QueueList';

export default function AllJobs() {
  return (
    <Screen scroll>
      <Button label="Back to the queue" variant="ghost" onPress={() => router.back()} />
      <QueueList all />
    </Screen>
  );
}
