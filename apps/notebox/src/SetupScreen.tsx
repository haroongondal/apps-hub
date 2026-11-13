import React from 'react';
import { Button, Dot, Group, Header, Notice, Row, Screen, Text } from '@apps-hub/ui';
import NoteboxCore, { type Status } from 'notebox-core';
import { setupComplete, setupRows, type SetupRow } from './setup.ts';

const ACTION_LABEL: Record<SetupRow['action'], string> = { access: 'Open notification access', appInfo: 'Open App info', battery: 'Open battery settings' };
const STATUS_LABEL: Record<SetupRow['status'], string> = { ok: 'Done', todo: 'To do', manual: 'Check by hand' };

export function runSetupAction(action: SetupRow['action']): void {
  if (action === 'access') NoteboxCore.openNotificationAccess();
  else if (action === 'appInfo') NoteboxCore.openAppInfo();
  else NoteboxCore.openBatterySettings();
}

// An array of rows, not a fragment: Group draws its dividers between its direct children.
export function setupRowElements(rows: SetupRow[], onAction: (action: SetupRow['action']) => void) {
  return rows.map((r) => (
    <Row key={r.id} title={r.title} subtitle={r.detail} leading={<Dot tone={r.status === 'ok' ? 'ok' : r.status === 'todo' ? 'warn' : 'neutral'} />}>
      <Text variant="caption" tone="muted">
        {STATUS_LABEL[r.status]}
      </Text>
      {r.status !== 'ok' && <Button label={ACTION_LABEL[r.action]} variant={r.status === 'todo' ? 'primary' : 'secondary'} size="sm" onPress={() => onAction(r.action)} />}
    </Row>
  ));
}

export function SetupScreen({ status, onAction, onFinished }: { status: Status; onAction: () => void; onFinished: () => void }) {
  const rows = setupRows(status);
  const complete = setupComplete(rows);
  return (
    <Screen scroll>
      <Header title="Set up Notebox" subtitle="Notebox can only save notifications once these steps are done." />
      <Group
        title="Steps"
        footer="Come back here after each step. Notebox checks again when you return. The last two steps can't be checked, so do them if they apply to your phone."
      >
        {setupRowElements(rows, (a) => {
          runSetupAction(a);
          onAction();
        })}
      </Group>
      {!complete && <Notice tone="warn">Finish the steps marked To do to continue.</Notice>}
      <Button label="Continue" onPress={onFinished} disabled={!complete} block />
    </Screen>
  );
}
