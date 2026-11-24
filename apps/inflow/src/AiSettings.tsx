import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Group, Notice, Row, Segmented, Text } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type AiStatus } from 'inflow-core';
import { AiErrorNotice, HubIssueNotice, useHubIssue } from './AiHubNotice.tsx';
import { AI_GOES_TO, AI_OFF_NOTE, FIRST_ON_NOTE, FREE_TIER_NOTE } from './aiHub.ts';
import { capLabel, CAP_ERROR, CAP_REACHED, parseCap, sendResultLabel } from './ai.ts';
import { whenLabel } from './format.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';

const ON_OFF = [
  { key: 'off', label: 'Off' },
  { key: 'on', label: 'On' },
] as const;

export function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setStatus(InflowCore.aiStatus());
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  if (status === null) return error !== null ? <Notice tone="danger">{error}</Notice> : null;
  return (
    <>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <RunPanel status={status} onChanged={load} />
    </>
  );
}

function RunPanel({ status, onChanged }: { status: AiStatus; onChanged: () => void }) {
  const hubIssue = useHubIssue();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [cap, setCap] = useState(status.capUsd === null ? '' : status.capUsd.toFixed(2));
  const [capError, setCapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);

  const saveCap = () => {
    const parsed = parseCap(cap);
    if (parsed === 'invalid') {
      setCapError(CAP_ERROR);
      return;
    }
    try {
      setCapError(InflowCore.setAiCap(parsed));
    } catch {
      setCapError(SAVE_ERROR);
    }
    onChanged();
  };

  const turn = (on: boolean) => {
    try {
      InflowCore.setAiOn(on);
      setSwitchError(null);
    } catch {
      setSwitchError(SAVE_ERROR);
    }
    onChanged();
  };

  const sendNow = () => {
    setBusy(true);
    setSent(null);
    InflowCore.sendAiNow()
      .then((r) => setSent(r.error === CAP_REACHED || r.stoppedByCap ? { tone: 'warn', text: CAP_REACHED } : r.error !== null ? { tone: 'danger', text: r.error } : { tone: 'ok', text: sendResultLabel(r.sent, r.saved) }))
      .catch(() => setSent({ tone: 'danger', text: SAVE_ERROR }))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  return (
    <>
      <Group title="AI" footer={status.on ? undefined : FIRST_ON_NOTE}>
        <Row title="Use AI" subtitle={`Summaries, categories, reports and Ask AI. ${AI_GOES_TO}`}>
          <Segmented accessibilityLabel="Use AI" options={ON_OFF} value={status.on ? 'on' : 'off'} onChange={(k) => turn(k === 'on')} />
        </Row>
      </Group>
      <Notice tone="warn" title="Free-tier keys share what Inflow sees">
        {FREE_TIER_NOTE}
      </Notice>
      {switchError !== null && <Notice tone="danger">{switchError}</Notice>}
      {hubIssue !== null && <HubIssueNotice issue={hubIssue} />}
      <Field
        label="Daily limit in dollars"
        hint="Inflow stops sending for the day when it has spent this much. Leave empty for no limit."
        value={cap}
        onChangeText={setCap}
        onEndEditing={saveCap}
        keyboardType="decimal-pad"
        returnKeyType="done"
        error={capError ?? undefined}
        mono
      />
      <Group title="AI status" footer="Inflow sends only SMS and email to the AI. WhatsApp and other apps are never sent. Health numbers go to Ask AI only if you turn that on in Settings.">
        <Row title={capLabel(status.capUsd, status.spentTodayUsd)} subtitle={`${status.queued === 0 ? 'Nothing waiting' : `${status.queued} waiting`} · ${status.lastRunAt === null ? 'Not sent yet' : `Last sent ${whenLabel(status.lastRunAt, Date.now())}`}`} />
        {!status.on && <Row title={<Text tone="muted">{AI_OFF_NOTE}</Text>} />}
      </Group>
      {status.error === CAP_REACHED ? (
        <Notice tone="warn">{CAP_REACHED}</Notice>
      ) : (
        status.error !== null && <AiErrorNotice text={status.error} title="The last send failed" />
      )}
      <Button label="Send now" variant="secondary" busy={busy} disabled={!status.on} onPress={sendNow} block />
      {sent !== null && (sent.tone === 'danger' ? <AiErrorNotice text={sent.text} /> : <Notice tone={sent.tone}>{sent.text}</Notice>)}
    </>
  );
}
