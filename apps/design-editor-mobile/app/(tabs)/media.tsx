import { Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import { router } from 'expo-router';

import { TOOLS } from '../../src/media/tools';

export default function MediaTab() {
  return (
    <Screen scroll>
      <Header title="Media" subtitle="Tools for your videos and sounds." />
      <Notice tone="accent" title="Your originals are never changed">Every tool saves a new file and leaves the one you picked as it was.</Notice>
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
