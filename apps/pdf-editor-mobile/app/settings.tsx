import { Button, Group, Header, Notice, Screen, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { errorMessage } from '../src/library/use-library';
import { SETTINGS_LEAVES } from '../src/nexus/consent-copy';
import { AskMyLife, TodayShare } from '../src/nexus/ask-settings';
import { HubNotice, useHubState } from '../src/nexus/hub-notice';
import { kick, openKnowledge } from '../src/nexus/worker';

export default function SettingsScreen() {
  const [queued, setQueued] = useState<string | null>(null);
  const hub = useHubState();

  const processAll = async () => {
    const n = await (await openKnowledge()).enqueueMissing();
    await kick();
    setQueued(n === 0 ? 'Everything is already queued or processed.' : `Queued ${n} ${n === 1 ? 'item' : 'items'}.`);
  };

  return (
    <Screen scroll>
      <Header title="AI settings" trailing={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <HubNotice state={hub} />
      <Notice tone="neutral" title="What leaves this phone">
        {SETTINGS_LEAVES}
      </Notice>
      {hub === 'ready' ? (
        <Group title="Your library" footer="New notes, recordings, photos and opened PDFs are queued as you add them. Use this for older items.">
          <View style={{ padding: space.lg, gap: space.md }}>
            <Button label="Process everything already here" variant="secondary" onPress={() => void processAll().catch((err) => setQueued(errorMessage(err)))} />
            {queued ? <Text tone="muted">{queued}</Text> : null}
          </View>
        </Group>
      ) : null}
      <AskMyLife />
      <TodayShare />
    </Screen>
  );
}
