import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Group, Header, Notice, Screen, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import InflowCore from 'inflow-core';
import { AiErrorNotice } from './AiHubNotice.tsx';
import { Chips } from './Chips.tsx';
import { PDF_FAILED, PERIOD_OPTIONS, PICK_SOMETHING, PREVIEW_FAILED, SECTION_OPTIONS, SEND_FAILED, SENDS_NOTICE, AI_NOTICE, charsLabel, hashToSend, includeFrom, pdfArgs, pdfMessage, periodRange, previewStep, summaryStep, type Choice, type Period, type Section, type Step } from './doctor.ts';
import { beginPermissionPrompt, endPermissionPrompt } from './lockGrace.ts';
import { useHardwareBack } from './useHardwareBack.ts';
import { NOT_A_MEDICAL_DEVICE } from './vitals.ts';

const PERIOD_SEGMENTS = PERIOD_OPTIONS.map((p) => ({ key: String(p.key), label: p.label }));

// Doctor summary in three steps: choose, read exactly what will be sent, then send. State lives only here, so leaving the screen clears the text and the summary.
export function DoctorScreen({ onBack }: { onBack: () => void }) {
  const { c } = useTheme();
  const [period, setPeriod] = useState<Period>(7);
  const [picked, setPicked] = useState<Section[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const sending = step.kind === 'sending';
  const toChoose = () => {
    setSaved(null);
    setPdfError(null);
    setStep({ kind: 'choose' });
  };
  useHardwareBack(() => {
    if (sending) return;
    if (step.kind === 'choose' || step.kind === 'result') onBack();
    else toChoose();
  });

  const toggle = (s: Section) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const currentChoice = (): Choice | null => {
    const include = includeFrom(picked);
    return include === null ? null : { ...periodRange(Date.now(), period), include };
  };

  const review = async (choice: Choice) => {
    setBusy(true);
    try {
      setStep(previewStep(choice, await InflowCore.doctorPreview(choice.fromDay, choice.toDay, choice.include)));
    } catch {
      setStep({ kind: 'error', message: PREVIEW_FAILED, again: false });
    }
    setBusy(false);
  };

  const send = async () => {
    const choice = currentChoice();
    if (step.kind !== 'review') return;
    const hash = choice === null ? null : hashToSend(step, choice);
    if (hash === null) return toChoose();
    const shown = step.shown;
    setStep({ kind: 'sending', shown });
    try {
      setStep(summaryStep(shown, await InflowCore.doctorSummarize(shown.fromDay, shown.toDay, shown.include, hash)));
    } catch {
      setStep({ kind: 'error', message: SEND_FAILED, again: false });
    }
  };

  const savePdf = async (r: Extract<Step, { kind: 'result' }>) => {
    setSaved(null);
    setPdfError(null);
    beginPermissionPrompt(Date.now());
    try {
      setSaved(pdfMessage(await InflowCore.saveDoctorPdf(...pdfArgs(r))));
    } catch {
      setPdfError(PDF_FAILED);
    } finally {
      endPermissionPrompt();
    }
  };

  const head = (
    <View style={{ gap: space.sm }}>
      <Button label="Back" variant="ghost" size="sm" disabled={sending} onPress={step.kind === 'choose' || step.kind === 'result' ? onBack : toChoose} />
      <Header title="Doctor summary" />
    </View>
  );
  const foot = <Text variant="meta" tone="muted">{NOT_A_MEDICAL_DEVICE}</Text>;

  if (step.kind === 'review' || step.kind === 'sending') {
    const { shown } = step;
    return (
      <Screen scroll>
        {head}
        <Text variant="caption" tone="muted">{`${shown.fromDay} to ${shown.toDay}. ${charsLabel(shown.chars)}.`}</Text>
        <View style={{ backgroundColor: c.raised, borderRadius: radius.control, padding: space.md }}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 360 }}>
            <Text selectable>{shown.text}</Text>
          </ScrollView>
        </View>
        <Notice>{SENDS_NOTICE}</Notice>
        {sending && <Notice tone="accent">Sending. This can take a moment.</Notice>}
        <Button label={sending ? 'Sending' : 'Send'} busy={sending} disabled={sending} onPress={() => void send()} block />
        <Button label="Back" variant="ghost" disabled={sending} onPress={toChoose} block />
        {foot}
      </Screen>
    );
  }

  if (step.kind === 'result') {
    return (
      <Screen scroll>
        {head}
        <Notice>{AI_NOTICE}</Notice>
        <View style={{ backgroundColor: c.raised, borderRadius: radius.control, padding: space.md }}>
          <Text selectable>{step.summary}</Text>
        </View>
        {saved !== null && <Notice tone="ok">{saved}</Notice>}
        {pdfError !== null && <Notice tone="danger">{pdfError}</Notice>}
        <Button label="Save as PDF" onPress={() => void savePdf(step)} block />
        <Button label="Done" variant="ghost" onPress={onBack} block />
        {foot}
      </Screen>
    );
  }

  if (step.kind === 'error') {
    const again = step.again ? currentChoice() : null;
    return (
      <Screen scroll>
        {head}
        <AiErrorNotice text={step.message} />
        {again !== null && <Button label="Review again" busy={busy} onPress={() => void review(again)} block />}
        <Button label="Back" variant="ghost" onPress={toChoose} block />
        {foot}
      </Screen>
    );
  }

  const choice = currentChoice();
  return (
    <Screen scroll>
      {head}
      <Text tone="muted">Pick the days and what to include. Inflow shows you the exact text before anything is sent.</Text>
      <Group title="Period">
        <View style={{ padding: space.md }}>
          <Segmented accessibilityLabel="Period" options={PERIOD_SEGMENTS} value={String(period)} onChange={(k) => setPeriod(Number(k) as Period)} />
        </View>
      </Group>
      <Chips title="Include" options={SECTION_OPTIONS} selected={picked} onToggle={toggle} />
      {choice === null && <Text variant="meta" tone="muted">{PICK_SOMETHING}</Text>}
      <Button label="Review what will be sent" busy={busy} disabled={choice === null} onPress={() => choice !== null && void review(choice)} block />
      {foot}
    </Screen>
  );
}
