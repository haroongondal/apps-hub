import { Button, confirmAction, Notice, space } from '@apps-hub/ui';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { errorMessage } from '../library/use-library';

import { discardMeeting, saveMeeting } from './meeting';

export function UnsavedMeeting({ reason, onDone }: { reason?: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveMeeting();
      onDone();
    } catch (err) {
      Alert.alert('Could not save the meeting', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    confirmAction({
      title: 'Delete this meeting?',
      message: 'The recording is removed from this phone. This cannot be undone.',
      onConfirm: () => {
        discardMeeting();
        onDone();
      },
    });
  return (
    <Notice
      tone="warn"
      title="Save the meeting you were recording?"
      action={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Save" size="sm" busy={busy} onPress={() => void save()} />
          <Button label="Delete" size="sm" variant="danger" disabled={busy} onPress={remove} />
        </View>
      }
    >
      {reason ? `It stopped before you tapped Stop. ${reason}` : 'What it recorded is still on this phone.'}
    </Notice>
  );
}
