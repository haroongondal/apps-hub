import React, { useEffect, useState, type ReactNode } from 'react';
import { Button, Dot, Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import Vault, { addSyncListener, type SyncStatus } from 'strongroom-vault';
import { isLocked, messageOf, whileDeriving } from './call.ts';
import { pickGroupIndex } from './forms.ts';
import { LostAccessScreen } from './LostAccessScreen.tsx';
import { BackButton, NewPasswordFields, RecoveryKeyCard, SecretField } from './parts.tsx';
import { AskPassword } from './SettingsFlows.tsx';
import {
  ACTION_LABEL,
  DONE,
  EMPTY_VALUES,
  FIELD_LABEL,
  FORM_COPY,
  KEY_SCREEN,
  WRONG_PASSWORD,
  accountKeyGroupProblem,
  checkForm,
  explain,
  fieldsOf,
  introFor,
  showKeyProblem,
  signInNote,
  syncFooter,
  syncView,
  verifyCopy,
  type FieldName,
  type FormName,
  type Problems,
  type SyncAction,
  type Values,
} from './sync-flow.ts';

const readStatus = (): SyncStatus | null => {
  try {
    return Vault.syncStatus();
  } catch {
    return null;
  }
};

export function useSyncStatus() {
  const [status, setStatus] = useState(readStatus);
  const [now, setNow] = useState(Date.now);
  const reload = () => setStatus(readStatus());
  useEffect(() => {
    const sub = addSyncListener((s) => {
      setStatus(s);
      setNow(Date.now());
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    setStatus(readStatus());
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, []);
  return { status, now, reload };
}

export function SyncSettingsRow({ onOpen }: { onOpen: () => void }) {
  const { status, now } = useSyncStatus();
  const view = status && syncView(status, now);
  return <Row title="Sync" subtitle={view?.title} onPress={view && view.actions.length > 0 ? onOpen : undefined} />;
}

export function SyncFooter({ onPress }: { onPress: () => void }) {
  const { status, now } = useSyncStatus();
  const line = status && syncFooter(status, now);
  if (!line) return null;
  return (
    <Group>
      <Row leading={<Dot tone={line.tone} />} title={line.title} subtitle={line.subtitle ?? undefined} onPress={onPress} accessibilityHint="Opens sync" />
    </Group>
  );
}

interface FormProps {
  form: FormName;
  intro: string;
  note?: ReactNode;
  onBack: () => void;
  onLocked: () => void;
  onEnabled: (accountKey: string) => void;
  onDone: () => void;
  onForgot?: () => void;
  onLost?: () => void;
}

const MONO: FieldName[] = ['setupToken', 'recoveryKey', 'accountKey', 'accountKeyAgain'];

function SyncForm({ form, intro, note, onBack, onLocked, onEnabled, onDone, onForgot, onLost }: FormProps) {
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [problems, setProblems] = useState<Problems>({});
  const [fault, setFault] = useState<string | null>(null);
  const [askAccountKey, setAskAccountKey] = useState(false);
  const [needKey, setNeedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = FORM_COPY[form];
  const change = (field: FieldName) => (text: string) => setValues((v) => ({ ...v, [field]: text }));

  const call = async (): Promise<boolean> => {
    if (form === 'signIn') {
      await whileDeriving(() => Vault.signInSync(values.password, values.accountKey));
      onDone();
    } else if (form === 'recover') {
      await whileDeriving(() => Vault.recoverSync(values.recoveryKey, values.newPassword, askAccountKey ? values.accountKey : undefined));
      onDone();
    } else {
      const enabled = await whileDeriving(() => Vault.enableSync(values.setupToken, values.password, values.recoveryKey));
      if (enabled === null) return false;
      onEnabled(enabled.accountKey);
    }
    return true;
  };

  const fields = fieldsOf(form, askAccountKey);
  const last = fields[fields.length - 1];

  const submit = async () => {
    if (busy) return;
    const found = checkForm(form, values, askAccountKey);
    setProblems(found);
    setFault(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (await call()) return;
      setProblems({ password: WRONG_PASSWORD });
    } catch (e) {
      if (isLocked(e)) return onLocked();
      const why = explain(form, e);
      if (why.askAccountKey) {
        setAskAccountKey(true);
        setNeedKey(why.message);
      } else if (why.field) {
        setProblems({ [why.field]: why.message });
      } else {
        setFault(why.message);
      }
    }
    setBusy(false);
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title={copy.title} subtitle={intro} />
      {note}
      {fields.map((field) => {
        if (field === 'confirm') return null;
        if (field === 'newPassword') {
          return (
            <NewPasswordFields
              key={field}
              label={FIELD_LABEL.newPassword}
              password={values.newPassword}
              confirm={values.confirm}
              onPassword={change('newPassword')}
              onConfirm={change('confirm')}
              error={problems.newPassword ?? null}
              onSubmit={last === 'confirm' ? submit : undefined}
            />
          );
        }
        return (
          <React.Fragment key={field}>
            {field === 'accountKey' && needKey && <Notice tone="warn">{needKey}</Notice>}
            <SecretField
              label={FIELD_LABEL[field]}
              value={values[field]}
              onChangeText={change(field)}
              onSubmitEditing={field === last ? submit : undefined}
              error={problems[field]}
              mono={MONO.includes(field)}
            />
          </React.Fragment>
        );
      })}
      {fault && <Notice tone="danger">{fault}</Notice>}
      <Button label={copy.button} onPress={submit} busy={busy} block />
      {onForgot && <Button label={ACTION_LABEL.recover} variant="ghost" onPress={onForgot} disabled={busy} />}
      {onLost && <Button label="I also lost my recovery key" variant="ghost" onPress={onLost} disabled={busy} />}
    </Screen>
  );
}

function KeyView({ value, action, onAction }: { value: string; action: string; onAction: () => void }) {
  return (
    <Screen scroll>
      <Header title={KEY_SCREEN.title} subtitle={KEY_SCREEN.intro} />
      <RecoveryKeyCard value={value} />
      <Notice tone="warn">{KEY_SCREEN.warning}</Notice>
      <Button label={action} onPress={onAction} block />
    </Screen>
  );
}

type Step = 'home' | FormName | 'showKey' | 'key' | 'verify';

interface Props {
  // 'signIn' is for a phone with no vault yet or a locked one: there is no home, and Back leaves the flow.
  start: 'home' | 'signIn';
  onBack: () => void;
  onDone: (notice: string) => void;
  onLocked: () => void;
  // True while the account key is on screen and nothing else may take its place (App ignores the hardware Back).
  onHold?: (holding: boolean) => void;
}

export function SyncScreen({ start, onBack, onDone, onLocked, onHold }: Props) {
  const { status, now, reload } = useSyncStatus();
  const [step, setStep] = useState<Step>(start);
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const [group, setGroup] = useState(0);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lostKey, setLostKey] = useState(false);
  const holding = step === 'key' || step === 'verify';

  useEffect(() => {
    onHold?.(holding);
    return () => onHold?.(false);
  }, [holding]);

  useEffect(() => {
    if (step === 'home') reload();
  }, [step]);

  const goHome = () => {
    setAccountKey(null);
    setStep('home');
  };
  const back = () => (step === 'recover' && start === 'signIn' ? setStep('signIn') : step === start ? onBack() : goHome());

  const act = async (action: SyncAction) => {
    if (action !== 'syncNow') return setStep(action);
    setError(null);
    setSyncing(true);
    try {
      await Vault.syncNow();
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setError(messageOf(e));
    }
    setSyncing(false);
  };

  const verify = () => {
    const problem = accountKeyGroupProblem(accountKey ?? '', group, typed);
    setTypedError(problem);
    if (problem) return;
    setAccountKey(null);
    setTyped('');
    onDone(DONE.turnedOn);
  };

  // Back returns to the recovery step it came from.
  if (lostKey) return <LostAccessScreen onBack={() => setLostKey(false)} onUnlocked={() => onDone(DONE.reset)} />;

  if (step === 'turnOn' || step === 'finish' || step === 'signIn' || step === 'recover') {
    const note = step === 'signIn' ? signInNote(status?.state) : null;
    return (
      <SyncForm
        key={step}
        form={step}
        intro={introFor(step, status?.state)}
        note={note ? <Notice tone="warn">{note}</Notice> : null}
        onBack={back}
        onLocked={onLocked}
        onEnabled={(key) => {
          setAccountKey(key);
          setGroup(pickGroupIndex(Math.random));
          setTyped('');
          setTypedError(null);
          setStep('key');
        }}
        onDone={() => onDone(step === 'recover' ? DONE.reset : DONE.signedIn)}
        onForgot={step === 'signIn' ? () => setStep('recover') : undefined}
        onLost={step === 'recover' ? () => setLostKey(true) : undefined}
      />
    );
  }

  if (step === 'key' && accountKey !== null) return <KeyView value={accountKey} action={KEY_SCREEN.saved} onAction={() => setStep('verify')} />;

  if (step === 'verify') {
    const copy = verifyCopy(group);
    return (
      <Screen scroll>
        <Header title={copy.title} subtitle={copy.intro} />
        <SecretField label={copy.label} value={typed} onChangeText={setTyped} onSubmitEditing={verify} error={typedError} mono />
        <Button label={copy.button} onPress={verify} block />
        <Button label={copy.again} variant="ghost" onPress={() => setStep('key')} />
      </Screen>
    );
  }

  if (step === 'showKey') {
    if (accountKey !== null) return <KeyView value={accountKey} action={KEY_SCREEN.done} onAction={goHome} />;
    return (
      <AskPassword
        title={KEY_SCREEN.askTitle}
        intro={KEY_SCREEN.askIntro}
        action={KEY_SCREEN.askAction}
        wrong={WRONG_PASSWORD}
        explain={showKeyProblem}
        run={async (password) => {
          const key = await whileDeriving(() => Vault.showAccountKey(password));
          if (key === null) return false;
          setAccountKey(key);
          return true;
        }}
        onBack={back}
        onLocked={onLocked}
      />
    );
  }

  const view = status && syncView(status, now);
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Sync" />
      {error && <Notice tone="danger">{error}</Notice>}
      {view && (
        <>
          <Notice tone={view.tone} title={view.title}>
            {view.body}
          </Notice>
          {view.notes.map((note) => (
            <Notice key={note} tone="warn">
              {note}
            </Notice>
          ))}
          {view.actions.map((action, i) => (
            <Button key={action} label={ACTION_LABEL[action]} variant={i === 0 ? 'primary' : 'secondary'} onPress={() => act(action)} busy={action === 'syncNow' && syncing} block />
          ))}
        </>
      )}
    </Screen>
  );
}
