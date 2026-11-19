import React, { useState } from 'react';
import { View } from 'react-native';
import { Header, Row, space } from '@apps-hub/ui';
import { AppIcon, AppList, Check, SearchField, useApps } from '../AppPicker.tsx';
import { BackButton } from '../Stepper.tsx';
import { PEEK_MAX_APPS } from './settings';

export function MessageApps({ value, onChange, onBack }: { value: string[]; onChange: (apps: string[]) => void; onBack: () => void }) {
  const apps = useApps();
  const [query, setQuery] = useState('');
  const full = value.length >= PEEK_MAX_APPS;
  const toggle = (pkg: string) => {
    if (value.includes(pkg)) onChange(value.filter((p) => p !== pkg));
    else if (!full) onChange([...value, pkg]);
  };

  const header = (
    <View style={{ gap: space.xl }}>
      <BackButton onPress={onBack} />
      <Header
        title="Message peek apps"
        subtitle={full ? `You have chosen ${PEEK_MAX_APPS} apps, the most allowed. Remove one to add another.` : 'New messages from these apps peek out of the pill.'}
      />
      <SearchField value={query} onChange={setQuery} />
    </View>
  );

  return (
    <AppList
      apps={apps}
      query={query}
      header={header}
      renderRow={(a) => {
        const on = value.includes(a.pkg);
        return (
          <Row
            leading={<AppIcon pkg={a.pkg} label={a.label} />}
            title={a.label}
            accessibilityLabel={`${a.label}, ${on ? 'chosen' : 'not chosen'}`}
            accessibilityHint={on ? 'Stop messages from this app peeking' : full ? 'Remove another app first' : 'Let messages from this app peek'}
            trailing={<Check on={on} />}
            onPress={() => toggle(a.pkg)}
          />
        );
      }}
    />
  );
}
