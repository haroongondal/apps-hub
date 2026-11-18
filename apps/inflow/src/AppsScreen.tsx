import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Row, Screen, space } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type AppRow, type ItemFilter } from 'inflow-core';
import { appRoute } from './apps.ts';
import { startOfToday, whenLabel } from './format.ts';
import { LOAD_ERROR } from './messages.ts';

// Every app that has items, newest first; same-label apps are one row.
export function AppsScreen({ onBack, onOpen, onOpenContacts }: { onBack: () => void; onOpen: (filter: ItemFilter, title: string) => void; onOpenContacts: (pkg: string, title: string) => void }) {
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setApps(InflowCore.apps(startOfToday()));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  const now = Date.now();
  const open = (a: AppRow) => {
    const r = appRoute(a);
    if (r.kind === 'contacts') onOpenContacts(r.pkg, a.label);
    else onOpen(r.filter, a.label);
  };
  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="All apps" />
      </View>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {apps !== null && apps.length === 0 && error === null && <Empty title="Nothing saved yet" body="Apps will appear here once they send a notification." />}
      {apps !== null && apps.length > 0 && (
        <Group>
          {apps.map((a) => (
            <Row key={a.pkgs.join('|')} title={a.label} subtitle={`${a.today > 0 ? `${a.today} today · ` : ''}${whenLabel(a.lastAt, now)}`} onPress={() => open(a)} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
