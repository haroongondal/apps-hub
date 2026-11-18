import React, { useEffect, useState } from 'react';
import { Field, Notice, Sheet } from '@apps-hub/ui';
import InflowCore, { type Todo } from 'inflow-core';
import { SAVE_ERROR } from './messages.ts';
import { DUE_ERROR, DUE_HINT, TODO_EMPTY, dueInput, parseDue } from './todos.ts';

// `todo` null = closed, 'new' = add one, otherwise edit it.
export type TodoTarget = Todo | 'new' | null;

export function TodoSheet({ target, onClose, onSaved }: { target: TodoTarget; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = target !== null && target !== 'new' ? target : null;

  useEffect(() => {
    if (target === null) return;
    setText(editing?.text ?? '');
    setDue(dueInput(editing?.dueAt ?? null));
    setError(null);
  }, [target === null ? null : editing?.id ?? 'new']);

  const save = () => {
    if (target === null) return;
    if (text.trim() === '') {
      setError(TODO_EMPTY);
      return;
    }
    const dueAt = parseDue(due);
    if (dueAt === 'invalid') {
      setError(DUE_ERROR);
      return;
    }
    try {
      const problem = editing ? InflowCore.updateTodo(editing.id, text, dueAt) : InflowCore.addTodo(text, dueAt);
      if (problem !== null) {
        setError(problem);
        return;
      }
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };

  return (
    <Sheet visible={target !== null} onClose={onClose} title={editing ? 'Edit to-do' : 'New to-do'} doneLabel="Save" onDone={save}>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Field label="To-do" value={text} onChangeText={setText} returnKeyType="next" autoCapitalize="sentences" />
      <Field label="Due" hint={DUE_HINT} value={due} onChangeText={setDue} onSubmitEditing={save} returnKeyType="done" autoCapitalize="none" autoCorrect={false} />
    </Sheet>
  );
}
