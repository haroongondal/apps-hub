import React, { useEffect, useState, type ReactElement } from 'react';
import { FlatList, Image, View } from 'react-native';
import { Field, Group, Header, Row, Screen, Text, radius, space, useTheme } from '@apps-hub/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HaloEngine, { type AppInfo, type Settings } from 'halo-engine';
import { sortApps } from './notifyForm.ts';
import { BackButton } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

export function useApps(): AppInfo[] | null {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    HaloEngine.listApps().then(
      (a) => live && setApps(a),
      () => live && setApps([]),
    );
    return () => {
      live = false;
    };
  }, []);
  return apps;
}

export function AppIcon({ pkg, label }: { pkg: string; label: string }) {
  const { c } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    HaloEngine.appIconUri(pkg).then(
      (u) => live && setUri(u),
      () => live && setUri(null),
    );
    return () => {
      live = false;
    };
  }, [pkg]);
  if (uri) return <Image source={{ uri }} style={{ width: 36, height: 36 }} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="bodyStrong" tone="muted">
        {label.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export function AppList({ apps, query, header, renderRow }: { apps: AppInfo[] | null; query: string; header: ReactElement; renderRow: (a: AppInfo) => ReactElement }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const data = apps ? sortApps(apps, query) : [];
  const last = data.length - 1;
  return (
    <Screen>
      <FlatList
        data={data}
        keyExtractor={(a) => a.pkg}
        // An element, not a component, so the search field keeps focus while typing.
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={
          <Text tone="muted" style={{ paddingHorizontal: space.xs }}>
            {apps === null ? 'Loading your apps.' : 'No apps match your search.'}
          </Text>
        }
        renderItem={({ item, index }) => {
          const top = index === 0 ? radius.group : 0;
          const bottom = index === last ? radius.group : 0;
          return (
            <View
              style={{
                backgroundColor: c.surface,
                borderColor: c.line,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: index === 0 ? 1 : 0,
                borderBottomWidth: index === last ? 1 : 0,
                borderTopLeftRadius: top,
                borderTopRightRadius: top,
                borderBottomLeftRadius: bottom,
                borderBottomRightRadius: bottom,
                overflow: 'hidden',
              }}
            >
              {index > 0 && <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />}
              {renderRow(item)}
            </View>
          );
        }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        contentContainerStyle={{ paddingTop: space.lg, paddingBottom: insets.bottom + space.xxxl, paddingHorizontal: space.lg }}
      />
    </Screen>
  );
}

export const SearchField = ({ value, onChange }: { value: string; onChange: (q: string) => void }) => (
  <Group>
    <View style={{ padding: space.md }}>
      <Field label="Search apps" value={value} onChangeText={onChange} placeholder="Name or package" autoCorrect={false} autoCapitalize="none" />
    </View>
  </Group>
);

export default function AppPicker({ settings, update, onBack }: { settings: Settings; update: UpdateSettings; onBack: () => void }) {
  const { c } = useTheme();
  const apps = useApps();
  const [query, setQuery] = useState('');
  const chosen = settings.rules.apps;
  const toggle = (pkg: string) => update({ rules: { apps: chosen.includes(pkg) ? chosen.filter((p) => p !== pkg) : [...chosen, pkg] } });

  const header = (
    <View style={{ gap: space.xl }}>
      <BackButton onPress={onBack} />
      <Header title="Hide over these apps" subtitle="The lights go out while one of these apps is open." />
      <SearchField value={query} onChange={setQuery} />
    </View>
  );

  return (
    <AppList
      apps={apps}
      query={query}
      header={header}
      renderRow={(a) => {
        const on = chosen.includes(a.pkg);
        return (
          <Row
            leading={<AppIcon pkg={a.pkg} label={a.label} />}
            title={a.label}
            accessibilityLabel={`${a.label}, ${on ? 'chosen' : 'not chosen'}`}
            accessibilityHint={on ? 'Show the lights over this app' : 'Hide the lights over this app'}
            trailing={
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on && <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c.surface }} />}
              </View>
            }
            onPress={() => toggle(a.pkg)}
          />
        );
      }}
    />
  );
}
