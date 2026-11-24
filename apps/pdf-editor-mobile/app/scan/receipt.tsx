import { Button, Field, Group, Header, Notice, Row, Screen, space, Text } from '@apps-hub/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { NexusLinks, type DebitRow } from 'nexus-links';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { itemFile } from '../../src/library/paths';
import { readDebits, startLink } from '../../src/links/readers';
import { ai, aiReady } from '../../src/nexus/ai';
import { outcomeText } from '../../src/nexus/action-links';
import { getScanService } from '../../src/scan/service';
import { candidateLine, dayText, matchLine, readAllDebits, readLine } from '../../src/nexus/receipt-debits';
import { matchReceipt, type Match } from '../../src/nexus/receipt-match';
import { amountText, buildReceipt } from '../../src/nexus/receipt-parse';
import { KEPT_OUT_LINE, readScanReceipt } from '../../src/nexus/receipt-read';
import { warrantyReminder } from '../../src/nexus/receipt-reminder';
import { openKnowledge } from '../../src/nexus/worker';

type Fields = { amount: string; date: string; merchant: string; warrantyEnd: string };
type Phase = { kind: 'start' } | { kind: 'reading' } | { kind: 'no-ai' } | { kind: 'failed'; line: string } | { kind: 'ready' };
type Outcome = { kind: 'read'; line: string } | { kind: 'match'; match: Match } | { kind: 'done'; line: string };

const READ_FAILED = "Nexus couldn't read that receipt. Check the photo is clear and your connection works, then try again.";

// The photo is read on the AI service the owner already uses for scans. The matched payment lives only in this screen's memory: nothing from Inflow is saved, logged or sent to an AI.
export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [fields, setFields] = useState<Fields>({ amount: '', date: '', merchant: '', warrantyEnd: '' });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<'match' | 'remind' | null>(null);
  const [reminded, setReminded] = useState<string | null>(null);
  const [keptOut, setKeptOut] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // A failed check leaves the button on: read() checks Keep out again before anything is sent.
    openKnowledge()
      .then((kn) => kn.isExcluded(id))
      .then((out) => alive && setKeptOut(out), () => alive && setKeptOut(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const read = async () => {
    setPhase({ kind: 'reading' });
    setOutcome(null);
    try {
      const result = await readScanReceipt({
        keptOut: async () => (await openKnowledge()).isExcluded(id),
        aiReady,
        firstPage: async () => {
          const page = (await (await getScanService()).pages(id))[0];
          return page ? itemFile(id, `pages/${page.pageId}.jpg`) : null;
        },
        port: ai,
      });
      if (result.kind === 'kept-out') {
        setKeptOut(true);
        return setPhase({ kind: 'start' });
      }
      if (result.kind !== 'ready') return setPhase(result);
      const { amountMinor, date, merchant, warrantyEnd } = result.receipt;
      setFields({ amount: amountText(amountMinor), date, merchant, warrantyEnd: warrantyEnd ?? '' });
      setPhase({ kind: 'ready' });
    } catch {
      setPhase({ kind: 'failed', line: READ_FAILED });
    }
  };

  const edit = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setOutcome(null);
    setReminded(null);
  };

  const built = buildReceipt(fields, Date.now());
  const receipt = built.ok ? built.receipt : null;
  const problem = (kind: RegExp) => (!built.ok && kind.test(built.reason) ? built.reason : null);
  const warrantyBad = fields.warrantyEnd.trim() !== '' && !receipt?.warrantyEnd;
  const reminder = receipt ? warrantyReminder(receipt) : null;

  const matchToInflow = async () => {
    if (!receipt || busy) return;
    setBusy('match');
    setOutcome(null);
    const r = await readAllDebits((since) => readDebits(NexusLinks, since));
    const line = readLine(r.status);
    setOutcome(line ? { kind: 'read', line } : { kind: 'match', match: matchReceipt(receipt, r.rows) });
    setBusy(null);
  };

  const confirm = (debit: DebitRow) => {
    const who = debit.merchant.trim() || 'payment';
    setOutcome({ kind: 'done', line: `Matched with your ${who} payment of ${amountText(debit.amount_minor)} on ${dayText(debit.at)}. Nexus didn't save it.` });
  };

  const remind = async () => {
    if (!reminder || busy) return;
    setBusy('remind');
    setReminded(null);
    setReminded(outcomeText(await startLink(NexusLinks, 'com.haroon.inflow.action.ADD_TODO', reminder.extras), 'Inflow'));
    setBusy(null);
  };

  const match = outcome?.kind === 'match' ? outcome.match : null;

  return (
    <Screen scroll>
      <Header title="Receipt" subtitle="Reads the first page" trailing={<IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} />

      {phase.kind === 'start' ? (
        <Notice tone="neutral" action={<Button label="Read receipt" size="sm" disabled={keptOut !== false} onPress={() => void read()} />}>
          Nexus sends this photo to your AI service to read it.
        </Notice>
      ) : null}
      {keptOut ? <Text tone="muted">{KEPT_OUT_LINE}</Text> : null}
      {phase.kind === 'reading' ? <Text tone="muted" accessibilityLiveRegion="polite">Reading the receipt...</Text> : null}
      {phase.kind === 'no-ai' ? (
        <Notice tone="warn" title="Nexus needs an AI service" action={<Button label="Open settings" size="sm" variant="secondary" onPress={() => router.push('/settings')} />}>
          Add your AI keys in Settings, or turn on Nexus in AI hub, to read a receipt.
        </Notice>
      ) : null}
      {phase.kind === 'failed' ? (
        <Notice tone="danger" title="Couldn't read the receipt" action={<Button label="Try again" size="sm" variant="secondary" onPress={() => void read()} />}>
          {phase.line}
        </Notice>
      ) : null}

      {phase.kind === 'ready' ? (
        <>
          <View style={{ gap: space.md }}>
            <Field label="Amount" value={fields.amount} onChangeText={edit('amount')} keyboardType="decimal-pad" error={problem(/amount/)} />
            <Field label="Date (YYYY-MM-DD)" value={fields.date} onChangeText={edit('date')} autoCorrect={false} error={problem(/date/)} />
            <Field label="Shop" value={fields.merchant} onChangeText={edit('merchant')} error={problem(/shop/)} />
            <Field label="Warranty ends (optional, YYYY-MM-DD)" value={fields.warrantyEnd} onChangeText={edit('warrantyEnd')} autoCorrect={false} error={warrantyBad ? 'Use a real date after the purchase date.' : null} />
          </View>

          <Button label="Match to Inflow" block disabled={!receipt || !!busy} busy={busy === 'match'} onPress={() => void matchToInflow()} />

          {outcome?.kind === 'read' ? <Notice tone="neutral">{outcome.line}</Notice> : null}
          {outcome?.kind === 'done' ? <Notice tone="ok">{outcome.line}</Notice> : null}
          {match ? (
            <View style={{ gap: space.sm }}>
              <Text accessibilityLiveRegion="polite">{matchLine(match)}</Text>
              {match.kind === 'match' ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Yes, it matches" size="sm" onPress={() => confirm(match.debit)} />
                  <Button label="No" size="sm" variant="secondary" onPress={() => setOutcome(null)} />
                </View>
              ) : null}
              {match.kind === 'tie' || match.kind === 'weak' ? (
                <Group>
                  {match.candidates.map((d) => (
                    <Row key={d.id} title={candidateLine(d)} subtitle={d.merchant.trim() || undefined} onPress={() => confirm(d)} accessibilityHint="Pick this payment" />
                  ))}
                  <Row title="None of these" onPress={() => setOutcome(null)} />
                </Group>
              ) : null}
            </View>
          ) : null}

          {receipt?.warrantyEnd ? (
            <View style={{ gap: space.sm }}>
              {reminder ? (
                <Button label="Remind me" variant="secondary" block disabled={!!busy} busy={busy === 'remind'} onPress={() => void remind()} accessibilityHint="Opens Inflow to add a to-do two weeks before the warranty ends" />
              ) : (
                <Text tone="muted">The warranty ends in under two weeks, so there is no time left for a reminder.</Text>
              )}
              {reminded ? <Text tone="muted" accessibilityLiveRegion="polite">{reminded}</Text> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
