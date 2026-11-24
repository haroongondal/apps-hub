import { SOURCE_APPS, type SourceApp } from '@apps-hub/library-core';
import { confirmAction, Group, Row, Segmented } from '@apps-hub/ui';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { errorMessage } from '../library/use-library';

import { APP_NAMES, switchStep } from './ask-runner';
import { askState, syncAskSources, turnOffSource, turnOnSource, type AskState } from './ask-sources';
import { ASK_KEEPS } from './consent-copy';
import { setTodayShare, todayShareOn } from './today-share';

const OPTIONS = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;

const SOURCES: Record<SourceApp, { title: string; about: string; hint: string }> = {
  inflow: {
    title: 'Inflow messages',
    about: 'Texts and email that Inflow has read. Never one-time codes.',
    hint: "Also turn on 'Let Nexus read my messages' in Inflow.",
  },
  clipboard: {
    title: 'Clipboard pinned clips',
    about: 'The clips you pinned in Clipboard.',
    hint: "Also turn on 'Let Nexus read pinned clips' in Clipboard.",
  },
  deputy: {
    title: 'Deputy run history',
    about: 'The tasks Deputy has done for you and how each ended.',
    hint: "Also turn on 'Let Nexus read my run history' in Deputy.",
  },
};


const plural = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

function details(app: SourceApp, s: AskState | undefined): string {
  const lines = [SOURCES[app].about];
  if (s?.on) {
    if (s.line) lines.push(s.line);
    else if (s.kept > 0) lines.push(`Nexus keeps ${plural(s.kept)} from ${APP_NAMES[app]}.`);
  } else if (s && s.kept > 0) {
    lines.push(`Nexus still keeps ${plural(s.kept)} from ${APP_NAMES[app]}. Tap Off to delete them.`);
  }
  lines.push(SOURCES[app].hint);
  return lines.join('\n');
}

export function AskMyLife() {
  const [state, setState] = useState<Record<SourceApp, AskState> | null>(null);
  const [busy, setBusy] = useState<SourceApp | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await askState());
    } catch (err) {
      Alert.alert('Could not read the Ask my life settings', errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void syncAskSources().then(refresh);
  }, [refresh]);

  const work = async (app: SourceApp, step: () => Promise<unknown>, failTitle: string) => {
    setBusy(app);
    try {
      await step();
    } catch (err) {
      Alert.alert(failTitle, errorMessage(err));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const change = (app: SourceApp, key: 'on' | 'off') => {
    const step = state && busy === null ? switchStep(state[app].on, state[app].kept, key) : null;
    if (!step) return;
    if (step === 'on') return void work(app, () => turnOnSource(app), `Could not turn on ${SOURCES[app].title}`);
    confirmAction({
      title: `Delete everything Nexus kept from ${APP_NAMES[app]}?`,
      message: `Nexus deletes its copies of the text, and the ideas and search entries made from them. Nothing changes in ${APP_NAMES[app]}.`,
      confirmLabel: 'Delete',
      onConfirm: () => void work(app, () => turnOffSource(app), `Could not turn off ${SOURCES[app].title}`),
    });
  };

  return (
    <Group title="Ask my life" footer={ASK_KEEPS}>
      {SOURCE_APPS.map((app) => (
        <Row
          key={app}
          title={SOURCES[app].title}
          subtitle={details(app, state?.[app])}
          trailing={
            <Segmented
              options={OPTIONS}
              value={state?.[app].on ? 'on' : 'off'}
              onChange={(key) => change(app, key)}
              accessibilityLabel={SOURCES[app].title}
            />
          }
        />
      ))}
    </Group>
  );
}

export function TodayShare() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void todayShareOn().then(setOn, () => setOn(false));
  }, []);
  const change = (key: 'on' | 'off') => {
    const next = key === 'on';
    if (next === on) return;
    setOn(next);
    setTodayShare(next).catch((err) => {
      setOn(!next);
      Alert.alert('Could not change what other apps see', errorMessage(err));
    });
  };
  return (
    <Group title="Other apps" footer="Your other Haroon apps can read the titles of things due today. Nothing leaves your phone.">
      <Row
        title="Show what is due today in my other apps"
        trailing={<Segmented options={OPTIONS} value={on ? 'on' : 'off'} onChange={change} accessibilityLabel="Show what is due today in my other apps" />}
      />
    </Group>
  );
}
