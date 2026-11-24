import React, { useEffect, useState } from 'react';
import { Group, Header, Notice, Row, Screen, Text } from '@apps-hub/ui';
import Vault, { type HealthReport, type Row as VaultRow } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { sections, summary } from './health.ts';
import { BackButton } from './parts.tsx';

interface Props {
  onBack: () => void;
  onOpen: (id: string) => void;
  onLocked: () => void;
}

export function PasswordCheckScreen({ onBack, onOpen, onLocked }: Props) {
  const [result, setResult] = useState<{ report: HealthReport; rows: VaultRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Vault.passwordCheck()
      .then((report) => live && setResult({ report, rows: Vault.rows() }))
      .catch((e: unknown) => live && (isLocked(e) ? onLocked() : setError(messageOf(e))));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Password check" subtitle="Checked on this phone. Nothing is sent anywhere." />
      {error && <Notice tone="danger">{error}</Notice>}
      {!result && !error && <Text tone="muted">Checking your passwords…</Text>}
      {result && <Text>{summary(result.report)}</Text>}
      {result &&
        sections(result.report, result.rows).map((s) => (
          <Group key={s.key} title={s.title} footer={s.footer}>
            {s.rows.map((r) => (
              <Row key={r.id} title={r.title} subtitle={r.subtitle} onPress={() => onOpen(r.id)} accessibilityHint="Opens the login" />
            ))}
          </Group>
        ))}
    </Screen>
  );
}
