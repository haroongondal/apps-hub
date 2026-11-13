import React, { useEffect, useState } from 'react';
import { Button, Field, Header, Notice, Screen, Text } from '@apps-hub/ui';
import InflowCore from 'inflow-core';
import { ASK_EMPTY, ASK_OFF, askBasis } from './ai.ts';
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
      {on === false && <Notice>{ASK_OFF}</Notice>}
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
      {error !== null && <Notice tone="danger">{error}</Notice>}
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
