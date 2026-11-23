import { Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { readInbox } from '../../src/media/share';
import { TOOLS } from '../../src/media/tools';

export default function MediaTab() {
  const [shared, setShared] = useState(0);
  useFocusEffect(useCallback(() => { void readInbox().then(list => setShared(list.length), () => setShared(0)); }, []));
  return (
    <Screen scroll>
      <Header title="Media" subtitle="Tools for your videos and sounds." />
      <Notice tone="accent" title="Your originals are never changed">Every tool saves a new file and leaves the one you picked as it was.</Notice>
      {shared ? (
        <Group>
          <Row title="Shared with Design Editor" subtitle={`${shared} ${shared === 1 ? 'picture or video' : 'pictures and videos'} from other apps`} onPress={() => router.push('/share')} accessibilityHint="Opens the list of what you shared" />
        </Group>
      ) : null}
      <Group>
        <Row title="Make a video" subtitle="Join clips into one video, cut them and put them in order." onPress={() => router.push('/video')} accessibilityHint="Opens Make a video" />
        <Row title="Make a reel from my photos" subtitle="Find photos by words or dates, keep the ones you want and add music." onPress={() => router.push('/reel')} accessibilityHint="Opens Make a reel" />
      </Group>
      <Group>
        {TOOLS.map(t => (
          <Row
            key={t.key}
            title={t.title}
            subtitle={t.about}
            onPress={() => router.push({ pathname: '/media/[tool]', params: { tool: t.key } })}
            accessibilityHint={`Opens ${t.title}`}
          />
        ))}
      </Group>
    </Screen>
  );
}
