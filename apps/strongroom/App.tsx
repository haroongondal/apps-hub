import React, { useState } from 'react';
import { Button, Header, Screen, Text, ThemeProvider } from '@apps-hub/ui';
import StrongroomVault from 'strongroom-vault';

// Temporary Task 9 bridge check (debug builds only in practice); Task 11 replaces this file with the real screens.
const CHECK_PASSWORD = 'correct horse battery staple';

function useCheckLog() {
  const [lines, setLines] = useState<string[]>([]);
  const note = (label: string, value: unknown) => {
    const line = `${label}: ${JSON.stringify(value)}`;
    console.log(`[strongroom-check] ${line}`);
    setLines((l) => [...l, line]);
  };
  return { lines, note, clear: () => setLines([]) };
}

const codeOf = (e: unknown) => (e as { code?: string }).code ?? String(e);

export default function App() {
  const { lines, note, clear } = useCheckLog();

  const runCheck = async () => {
    clear();
    try {
      note('status', StrongroomVault.getStatus());
      if (!StrongroomVault.getStatus().setUp) {
        await StrongroomVault.setUp(CHECK_PASSWORD, StrongroomVault.generateRecoveryKey());
        note('setUp', 'done');
      }
      StrongroomVault.lock();
      note('locked', !StrongroomVault.getStatus().unlocked);
      note('wrong password', await StrongroomVault.unlock('not the password at all'));
      note('unlock', await StrongroomVault.unlock(CHECK_PASSWORD));
      if (StrongroomVault.rows().length === 0) {
        note('saved', StrongroomVault.save(null, { type: 'login', name: 'Example', username: 'me@example.com', password: 'check-password-1', sites: ['example.com'], note: '' }));
      }
      try {
        StrongroomVault.save(null, { type: 'login', name: 'Bad', username: '', password: '', sites: ['not a site'], note: '' });
      } catch (e) {
        note('bad site', codeOf(e));
      }
      const rows = StrongroomVault.rows();
      note('rows', rows);
      if (rows[0]) note('entry', StrongroomVault.entry(rows[0].id));
      note('status', StrongroomVault.getStatus());
      note('diagnostics', StrongroomVault.diagnostics());
    } catch (e) {
      note('error', `${codeOf(e)} ${String(e)}`);
    }
  };

  const runImport = async () => {
    try {
      const preview = await StrongroomVault.pickGoogleCsv();
      note('import preview', preview);
      if (preview) note('imported', StrongroomVault.commitImport());
      note('rows', StrongroomVault.rows().length);
    } catch (e) {
      note('import error', `${codeOf(e)} ${String(e)}`);
    }
  };

  const runFingerprint = async () => {
    try {
      note('fingerprint, wrong password', await StrongroomVault.setBiometric(true, 'not the password at all'));
      note('fingerprint on', await StrongroomVault.setBiometric(true, CHECK_PASSWORD));
      StrongroomVault.lock();
      note('fingerprint unlock', await StrongroomVault.unlockWithBiometric());
      note('status', StrongroomVault.getStatus());
    } catch (e) {
      note('fingerprint error', `${codeOf(e)} ${String(e)}`);
    }
  };

  return (
    <ThemeProvider brand="strongroom">
      <Screen scroll>
        <Header title="Strongroom" />
        <Button label="Run bridge check" onPress={runCheck} />
        <Button label="Import a CSV" variant="secondary" onPress={runImport} />
        <Button label="Fingerprint" variant="secondary" onPress={runFingerprint} />
        <Button
          label="Fingerprint unlock"
          variant="secondary"
          onPress={async () => {
            StrongroomVault.lock();
            note('fingerprint unlock', await StrongroomVault.unlockWithBiometric());
            note('status', StrongroomVault.getStatus());
          }}
        />
        {lines.map((line, i) => (
          <Text key={i} variant="caption">
            {line}
          </Text>
        ))}
      </Screen>
    </ThemeProvider>
  );
}
