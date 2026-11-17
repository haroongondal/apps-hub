import React, { useEffect, useState } from 'react';
import { Button, Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import Vault, { type AuthenticatorProgress, type AuthenticatorReview } from 'strongroom-vault';
import { hasCode, isLocked, messageOf } from './call.ts';
import { plural } from './forms.ts';
import { BackButton } from './parts.tsx';

const STEPS = [
  'In Google Authenticator, tap Transfer accounts, then Export accounts.',
  'Select every account it lists, then tap Next.',
  'Scan each QR it shows, one after another.',
];

interface Props {
  onBack: () => void;
  onDone: () => void;
  onLocked: () => void;
}

export function AuthenticatorImportScreen({ onBack, onDone, onLocked }: Props) {
  const [progress, setProgress] = useState<AuthenticatorProgress | null>(null);
  const [review, setReview] = useState<AuthenticatorReview | null>(null);
  const [imported, setImported] = useState<{ created: number; attached: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Entering fresh drops whatever an abandoned run left behind.
  useEffect(() => {
    try {
      Vault.cancelAuthenticatorImport();
    } catch {
      // A locked vault never holds scan state anyway.
    }
  }, []);

  const fail = (e: unknown) => {
    if (isLocked(e)) return onLocked();
    setError(messageOf(e));
    // A batch count that changed mid-scan leaves the earlier batches unusable.
    if (hasCode(e, 'MIGRATION_STATE')) restart();
  };

  const restart = () => {
    try {
      Vault.cancelAuthenticatorImport();
    } catch {
      // Nothing to clear on a locked vault.
    }
    setProgress(null);
    setReview(null);
    setImported(null);
  };

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await Vault.scanAuthenticatorBatch();
      if (!next) {
        setBusy(false);
        return; // the scan screen's Cancel keeps the batches scanned so far
      }
      setProgress(next);
      // Every batch is in: the review list is the confirmation.
      if (next.scanned === next.total) setReview(Vault.authenticatorReview());
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };

  const commit = () => {
    try {
      setImported(Vault.commitAuthenticatorImport());
      setReview(null);
    } catch (e) {
      fail(e);
    }
  };

  const goBack = () => {
    if (imported === null && (progress !== null || review !== null)) restart();
    (imported === null ? onBack : onDone)();
  };

  const scanning = imported === null && review === null;
  const done =
    imported !== null
      ? [
          imported.created > 0 ? `${plural(imported.created, 'new login', 'new logins')}.` : null,
          imported.attached > 0 ? `${plural(imported.attached, 'code added to an existing login', 'codes added to existing logins')}.` : null,
        ]
          .filter((line) => line !== null)
          .join(' ')
      : '';

  return (
    <Screen scroll>
      <BackButton onPress={goBack} />
      <Header title="Import from Google Authenticator" subtitle="A one-time move of your authenticator codes into Strongroom." />
      {scanning && (
        <Group title="How">
          {STEPS.map((s, i) => (
            <Row key={s} title={`${i + 1}. ${s}`} />
          ))}
        </Group>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {scanning && progress !== null && (
        <Group title="Progress">
          <Row
            title={`${progress.scanned} of ${progress.total} scanned`}
            subtitle={progress.entries > 0 ? plural(progress.entries, 'account read so far.', 'accounts read so far.') : undefined}
          />
          {progress.hotp > 0 && (
            <Row
              title={plural(progress.hotp, 'counter-based code skipped', 'counter-based codes skipped')}
              subtitle="Strongroom only supports time-based codes."
            />
          )}
        </Group>
      )}
      {scanning && (
        <Button
          label={
            progress === null
              ? 'Scan the first QR'
              : progress.scanned < progress.total
                ? `Scan QR ${progress.scanned + 1} of ${progress.total}`
                : 'Scan a QR again'
          }
          variant={progress === null ? 'primary' : 'secondary'}
          onPress={scan}
          busy={busy}
          block
        />
      )}
      {imported === null && review !== null && (
        <>
          <Group
            title="Review"
            footer="A code joins a login whose name and username match the entry; the rest become new logins with no password."
          >
            {review.items.length === 0 && (
              <Row title="Nothing to import" subtitle="Every code in this export is already in your vault." />
            )}
            {review.items.map((item, i) =>
              item.kind === 'attach' ? (
                <Row
                  key={`${item.login}-${i}`}
                  title={item.login}
                  subtitle={`Adds the code for ${item.issuer ?? 'this account'}${item.account ? ` · ${item.account}` : ''}`}
                />
              ) : (
                <Row
                  key={`${item.name}-${i}`}
                  title={item.name}
                  subtitle={item.account ? `New login for ${item.account}` : 'New login with the code and no password'}
                />
              ),
            )}
          </Group>
          {(review.duplicates > 0 || review.hotp > 0 || review.bad > 0) && (
            <Group title="Left out">
              {review.duplicates > 0 && (
                <Row title={plural(review.duplicates, 'duplicate code', 'duplicate codes')} subtitle="Already in your vault." />
              )}
              {review.hotp > 0 && (
                <Row
                  title={plural(review.hotp, 'counter-based code', 'counter-based codes')}
                  subtitle="Strongroom only supports time-based codes."
                />
              )}
              {review.bad > 0 && (
                <Row title={plural(review.bad, 'unreadable entry', 'unreadable entries')} subtitle="Left out of the import." />
              )}
            </Group>
          )}
          {review.items.length > 0 && (
            <Button label={`Import ${plural(review.created + review.attached, 'code', 'codes')}`} onPress={commit} block />
          )}
          <Button label="Start over" variant="secondary" onPress={restart} block />
        </>
      )}
      {imported !== null && (
        <>
          <Notice tone="ok">{`${plural(imported.created + imported.attached, 'code', 'codes')} imported. ${done}`}</Notice>
          <Notice tone="warn">
            Anyone who scans the export QRs gets every code. Delete the moved accounts from Google Authenticator when you are done.
          </Notice>
          <Button label="Done" onPress={onDone} block />
        </>
      )}
    </Screen>
  );
}
