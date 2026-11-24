import { Button, Group, Header, Notice, Screen, space, Text } from '@apps-hub/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { errorMessage } from '../src/library/use-library';
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
        Nexus has no AI keys of its own. Everything it sends goes through AI hub, which passes it to Groq or Gemini. Nexus sends Google the text of
        your notes, PDFs and scans, and your photos, to find ideas and read images. It sends Groq the text of your notes, PDFs and scans, to
        build the graph and answer questions, and your voice recordings, to transcribe them. The CV maker sends the details you type to Groq or
        Gemini. For each Ask my life source you switch on, Nexus sends its messages, pinned clips or Deputy runs to Gemini to make them
        searchable, and the parts that match to Groq when you ask. When you tap Read as receipt, Nexus sends that photo to Gemini and the text
        read from it to Groq. While Show what is due today is on, your other apps can read the titles of things due today, and nothing leaves
        your phone. Your files stay on this phone. Without AI hub nothing is sent.
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
