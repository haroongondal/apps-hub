import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Notice, Row, Text, confirmAction, space } from '@apps-hub/ui';
import { calls, clearCalls, type CallInfo } from 'ai-hub-core';
import { plainError, requestText } from './format.ts';

// (my call) The owner decides whether this log stays. It holds the app, the job, the service and the time, never what was asked or answered.
export function RecentGroup() {
  const [list, setList] = useState<CallInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => calls().then(setList).catch((e) => setError(plainError(e)));
  useEffect(() => {
    refresh();
  }, []);

  const clear = () =>
    confirmAction({
      title: 'Clear recent requests?',
      message: 'The list of which app asked for what is removed. The totals per app stay.',
      confirmLabel: 'Clear',
      onConfirm: () => {
        setError(null);
        clearCalls()
          .then(refresh)
          .catch((e) => setError(plainError(e)));
      },
    });

  const now = Date.now();
  return (
    <View style={{ gap: space.md }}>
      <Group title="Recent requests">
        {list.map((call, i) => (
          <Row key={`${call.time}-${i}`} title={call.label} subtitle={requestText(call, now)} />
        ))}
      </Group>
      {list.length === 0 ? (
        <Text tone="muted">No requests yet.</Text>
      ) : (
        <Button label="Clear recent requests" variant="secondary" onPress={clear} />
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </View>
  );
}
