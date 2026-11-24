import { Button, Header, Notice, Readout, Screen, space, Text } from '@apps-hub/ui';
import type { MeetingStatus } from 'audio-chunks';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { errorMessage } from '../src/library/use-library';
import { currentMeeting, meetingStatus, saveMeeting, startMeeting, stopMeeting } from '../src/nexus/meeting';
import { formatElapsed, type MeetingState } from '../src/nexus/meeting-session';
import { UnsavedMeeting } from '../src/nexus/unsaved-meeting';

const KEEP_GOING = 'Recording goes on with the screen off or while you use other apps. If your phone stops it, set battery saver for Nexus to No restrictions in Settings.';

const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function MeetingScreen() {
  const [state, setState] = useState<MeetingState | null>(null);
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);

  const refresh = useCallback(async () => {
    setStatus(meetingStatus());
    setState(await currentMeeting());
  }, []);
  useEffect(() => {
    refresh().catch((err) => Alert.alert('Could not check the recording', errorMessage(err)));
  }, [refresh]);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      const now = meetingStatus();
      setStatus(now);
      if (now && !now.recording) void refresh(); // stopped without the user: offer what was recorded
    }, 500);
    return () => clearInterval(timer);
  }, [state, refresh]);

  const start = async () => {
    setBusy('start');
    try {
      await startMeeting();
      await refresh();
    } catch (err) {
      Alert.alert('Could not start recording', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setState(null); // ends the status polling, so the half-saved meeting is not offered while it saves
    try {
      const end = await stopMeeting();
      await saveMeeting();
      if (end.silencedMs >= 1000) {
        Alert.alert('Part of the meeting is silent', `Another app used the microphone for ${formatElapsed(end.silencedMs)}, so that part has no sound.`);
      }
      leave();
    } catch (err) {
      Alert.alert('Could not save the meeting', errorMessage(err));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll>
      <Header title="Meeting" trailing={<IconButton icon="close" label="Close" onPress={leave} />} />
      {busy === 'stop' ? <Text accessibilityLiveRegion="polite">Saving the meeting…</Text> : null}
      {state === 'unsaved' ? <UnsavedMeeting reason={status?.error} onDone={leave} /> : null}
      {state === 'recording' ? (
        <>
          <View style={{ alignItems: 'center', paddingVertical: space.xxl }} accessibilityLiveRegion="polite">
            <Readout value={formatElapsed(status?.elapsedMs ?? 0)} label="Recording" tone="danger" />
          </View>
          {status?.silenced ? (
            <Notice tone="warn" title="Another app is using the microphone">
              This part will be silent, for example during a call. Recording goes on and picks up again when the other app lets go.
            </Notice>
          ) : null}
          <Text tone="muted">{KEEP_GOING}</Text>
          <Button label="Stop and save" block busy={busy === 'stop'} onPress={() => void stop()} />
        </>
      ) : null}
      {state === 'none' ? (
        <>
          <Text>Record a long meeting or lecture. Nexus saves it as a voice note and, with AI on, writes a transcript you can search.</Text>
          <Text tone="muted">{KEEP_GOING}</Text>
          <Button label="Start recording" block busy={busy === 'start'} onPress={() => void start()} />
        </>
      ) : null}
    </Screen>
  );
}
