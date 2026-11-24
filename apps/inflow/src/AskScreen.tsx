import React, { useEffect, useState } from 'react';
import { Button, Field, Header, Notice, Screen, Text } from '@apps-hub/ui';
import InflowCore from 'inflow-core';
import { AiErrorNotice, HubIssueNotice, useHubIssue } from './AiHubNotice.tsx';
import { AI_OFF_ASK } from './aiHub.ts';
import { ASK_EMPTY, askBasis } from './ai.ts';
import { LOAD_ERROR } from './messages.ts';

interface Answer {
  text: string;
  basis: string;
}

export function AskScreen() {
  const [on, setOn] = useState<boolean | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hubIssue = useHubIssue();

  useEffect(() => {
    try {
      setOn(InflowCore.aiStatus().on);
    } catch {
      setOn(false);
      setError(LOAD_ERROR);
    }
  }, []);

  const ask = () => {
    const q = question.trim();
    if (q === '' || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    InflowCore.ask(q)
      .then((r) => {
        if (r.error !== null) setError(r.error);
        else if (r.answer === null) setError(ASK_EMPTY);
        else setAnswer({ text: r.answer, basis: askBasis(r.items, r.txns, r.from, r.to, Date.now()) });
      })
      .catch(() => setError(ASK_EMPTY))
      .finally(() => setBusy(false));
  };

  return (
    <Screen scroll>
      <Header title="Ask AI" />
      {on === false && <Notice>{AI_OFF_ASK}</Notice>}
      {hubIssue !== null && <HubIssueNotice issue={hubIssue} />}
      <Field
        label="Your question"
        placeholder="How much did I spend this month?"
        value={question}
        onChangeText={setQuestion}
        multiline
        editable={on === true}
        returnKeyType="send"
      />
      <Button label="Ask" busy={busy} disabled={on !== true || question.trim() === ''} onPress={ask} block />
      <Text variant="caption" tone="muted">
        Questions use your saved SMS, emails and transactions.
      </Text>
      {error !== null && <AiErrorNotice text={error} />}
      {answer !== null && (
        <>
          <Text selectable>{answer.text}</Text>
          <Text variant="caption" tone="muted">
            {answer.basis}
          </Text>
        </>
      )}
    </Screen>
  );
}
