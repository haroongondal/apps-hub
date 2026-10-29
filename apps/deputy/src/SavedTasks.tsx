import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Row, Sheet, space } from '@apps-hub/ui';
import DeputyAgent, { type AppTrust, type SavedTask, type ServiceState } from 'deputy-agent';
import { canRun } from './setup';

export function SavedTasks({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [tasks, setTasks] = useState(() => DeputyAgent.listSavedTasks());
  const [editing, setEditing] = useState<SavedTask | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (t: SavedTask) => {
    setError(DeputyAgent.startRun(t.task, t.apps).error);
    refresh();
  };

  return (
    <>
      <Group
        title="Saved tasks"
        trailing={<Button label="New" variant="ghost" size="sm" onPress={() => setEditing('new')} />}
        footer={tasks.length === 0 ? 'Save a task you run often, then run it with one tap.' : undefined}
      >
        {tasks.map((t) => (
          <Row
            key={t.id}
            title={t.name}
            subtitle={t.apps.length > 0 ? `${t.task}\nOnly in ${t.apps.length === 1 ? 'one app' : `${t.apps.length} apps`}` : t.task}
            trailing={<Button label="Run" size="sm" onPress={() => run(t)} disabled={!canRun(state)} />}
            onPress={() => setEditing(t)}
            accessibilityHint="Edits this task"
          />
        ))}
      </Group>
      {error && (
        <Notice tone="danger" title="Deputy didn't start">
          {error}
        </Notice>
      )}
      {editing && (
        <TaskSheet
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => setTasks(DeputyAgent.listSavedTasks())}
        />
      )}
    </>
  );
}

function TaskSheet({ task, onClose, onSaved }: { task: SavedTask | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(task?.name ?? '');
  const [text, setText] = useState(task?.task ?? '');
  const [apps, setApps] = useState<string[]>(task?.apps ?? []);
  const [all, setAll] = useState<AppTrust[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    DeputyAgent.listApps().then(setAll);
  }, []);

  const label = (pkg: string) => all.find((a) => a.pkg === pkg)?.label ?? pkg;
  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((a) => a.trust !== 'blocked' && !apps.includes(a.pkg) && a.label.toLowerCase().includes(q)).slice(0, 5) : [];

  const save = () => {
    const r = DeputyAgent.saveTask({ id: task?.id ?? null, name, task: text, apps });
    if (r.error) return setError(r.error);
    onSaved();
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title={task ? 'Edit task' : 'New task'} doneLabel="Save" onDone={save}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Next alarm" />
      <Field label="What should Deputy do?" value={text} onChangeText={setText} placeholder="Open the clock app and tell me my next alarm" multiline />
      <Group
        title="Apps it may use"
        footer={apps.length > 0 ? "Deputy refuses every other app and won't open links." : 'Any app. Add apps to keep the task to them.'}
      >
        {apps.map((pkg) => (
          <Row key={pkg} title={label(pkg)} trailing={<Button label="Remove" variant="ghost" size="sm" onPress={() => setApps((a) => a.filter((p) => p !== pkg))} />} />
        ))}
      </Group>
      <View style={{ gap: space.sm }}>
        <Field label="Add an app" value={query} onChangeText={setQuery} placeholder="Type an app's name" autoCorrect={false} />
        <Group>
          {matches.map((a) => (
            <Row
              key={a.pkg}
              title={a.label}
              subtitle={a.pkg}
              onPress={() => {
                setApps((x) => [...x, a.pkg]);
                setQuery('');
              }}
              accessibilityHint="Adds this app to the task"
            />
          ))}
        </Group>
      </View>
      {error && (
        <Notice tone="danger" title="Not saved">
          {error}
        </Notice>
      )}
      {task && (
        <Button
          label="Delete this task"
          variant="danger"
          onPress={() => {
            DeputyAgent.deleteTask(task.id);
            onSaved();
            onClose();
          }}
          block
        />
      )}
    </Sheet>
  );
}
