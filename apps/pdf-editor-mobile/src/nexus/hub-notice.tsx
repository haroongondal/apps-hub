import { Button, Notice } from '@apps-hub/ui';
import { NexusLinks } from 'nexus-links';
import { useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { openApp } from '../links/readers';

import { hubState, recheckHub } from './ai';
import { HUB_COPY, type HubState } from './hub-state';

/** AI hub's state for a screen; looks again when the owner comes back from fixing it. */
export function useHubState(): HubState | null {
  const [state, setState] = useState<HubState | null>(null);
  useEffect(() => {
    const look = () => void hubState().then(setState, () => setState(null));
    look();
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      recheckHub();
      look();
    });
    return () => sub.remove();
  }, []);
  return state;
}

/** What the owner has to do in AI hub, with a button to go there. Shows nothing when AI hub is ready or not yet known. */
export function HubNotice({ state }: { state: HubState | null }) {
  if (!state || state === 'ready') return null;
  const copy = HUB_COPY[state];
  const open = async () => {
    if ((await openApp(NexusLinks, copy.opens)).status === 'done') return;
    Alert.alert(`Couldn't open ${copy.opens === 'store' ? 'the Store' : 'AI hub'}`, 'Open it from your home screen.');
  };
  return (
    <Notice tone="accent" title={copy.title} action={NexusLinks ? <Button label={copy.button} size="sm" onPress={() => void open()} /> : undefined}>
      {copy.body}
    </Notice>
  );
}
