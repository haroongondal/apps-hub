import { Button, space, Text } from '@apps-hub/ui';
import { NexusLinks, type LinkAction, type LinkExtras, type LinkResult } from 'nexus-links';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { startLink } from '../links/readers';
import { outcomeText, type LinkTarget } from './action-links';

const SHOW_MS = 6000;

interface Props {
  inflow: LinkExtras['com.haroon.inflow.action.ADD_TODO'] | null;
  deputy: LinkExtras['com.haroon.deputy.action.PROPOSE_TASK'] | null;
}

// One tap sends one item, from this screen: never in bulk, never from a service or notification.
export function SendButtons({ inflow, deputy }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!NexusLinks) return null;

  const send = async <A extends LinkAction>(action: A, extras: LinkExtras[A] | null, target: LinkTarget) => {
    if (!extras || busy) return;
    if (timer.current) clearTimeout(timer.current);
    setMessage(null);
    setBusy(true);
    const result: LinkResult = await startLink(NexusLinks, action, extras);
    setBusy(false);
    setMessage(outcomeText(result, target));
    timer.current = setTimeout(() => setMessage(null), SHOW_MS);
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button label="Add to Inflow" size="sm" variant="secondary" disabled={busy || !inflow} onPress={() => void send('com.haroon.inflow.action.ADD_TODO', inflow, 'Inflow')} />
        <Button label="Do with Deputy" size="sm" variant="secondary" disabled={busy || !deputy} onPress={() => void send('com.haroon.deputy.action.PROPOSE_TASK', deputy, 'Deputy')} />
      </View>
      {message ? (
        <Text tone="muted" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
