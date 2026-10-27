import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, PermissionsAndroid, Platform, View } from 'react-native';
import {
  Button,
  Empty,
  Field,
  Group,
  Header,
  Notice,
  Pill,
  Progress,
  Row,
  Screen,
  Segmented,
  Text,
  ThemeProvider,
  fonts,
  radius,
  space,
  useTheme,
} from '@apps-hub/ui';
import { SIGNING_CERT_SHA256, type StoreApp, type StoreManifest } from '@apps-hub/store-manifest';
import StoreInstaller, { type InstallProgress, type InstallStatusEvent } from 'store-installer';
import { fetchManifest, signUrl, type Credentials } from './src/api';
import { downloadLabel, installFailure, listSummary, statusPill, versionLines } from './src/present';
import { appStatus, type Installed } from './src/status';

const CHECK_INTERVALS = [
  { key: '0', label: 'Off' },
  { key: '6', label: '6h', a11yLabel: 'Every 6 hours' },
  { key: '12', label: '12h', a11yLabel: 'Every 12 hours' },
  { key: '24', label: '24h', a11yLabel: 'Every 24 hours' },
] as const;

interface Busy {
  label: string;
  value: number | null;
}

interface Problem {
  title: string;
  body: string;
}

export default function App() {
  const [creds, setCreds] = useState<Credentials | null>(() => StoreInstaller.getCredentials());
  return (
    <ThemeProvider brand="store">
      {creds ? <StoreList creds={creds} onSignOut={() => setCreds(null)} /> : <Setup onSaved={setCreds} />}
    </ThemeProvider>
  );
}

function Setup({ onSaved }: { onSaved: (c: Credentials) => void }) {
  const [apiUrl, setApiUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const c = { apiUrl: apiUrl.trim(), token: token.trim() };
    setBusy(true);
    setError(null);
    try {
      await fetchManifest(c);
      StoreInstaller.setCredentials(c.apiUrl, c.token);
      StoreInstaller.scheduleUpdateCheck(StoreInstaller.getUpdateCheckHours());
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      onSaved(c);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="Store" subtitle="Connect to your private app server to install your apps and keep them up to date." />
      <View style={{ gap: space.lg }}>
        <Field
          label="Server address"
          hint="Your store’s API URL, usually ending in workers.dev."
          value={apiUrl}
          onChangeText={setApiUrl}
          mono
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://apps-hub-store.you.workers.dev"
        />
        <Field
          label="Device token"
          hint="The STORE_TOKEN value. Store keeps it encrypted on this phone."
          value={token}
          onChangeText={setToken}
          mono
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>
      {error && (
        <Notice tone="danger" title="Could not connect">
          {`${error}\nCheck the server address and token, then try again.`}
        </Notice>
      )}
      <Button label={busy ? 'Connecting' : 'Connect'} onPress={save} busy={busy} disabled={!apiUrl.trim() || !token.trim()} block />
    </Screen>
  );
}

function Monogram({ name }: { name: string }) {
  const { c } = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{ width: 44, height: 44, borderRadius: radius.control + 2, backgroundColor: c.raised, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="heading" style={{ fontFamily: fonts.heavy }}>
        {name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function StoreList({ creds, onSignOut }: { creds: Credentials; onSignOut: () => void }) {
  const { c } = useTheme();
  const [manifest, setManifest] = useState<StoreManifest | null>(null);
  const [installed, setInstalled] = useState<Record<string, Installed | null>>({});
  const [progress, setProgress] = useState<Record<string, Busy>>({});
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(() => StoreInstaller.getUpdateCheckHours());

  const setBusy = (pkg: string, b: Busy | null) => setProgress(({ [pkg]: _, ...rest }) => (b ? { ...rest, [pkg]: b } : rest));
  const report = (pkg: string, p: Problem | null) =>
    setProblems(({ [pkg]: _, ...rest }) => (p ? { ...rest, [pkg]: p } : rest));

  const readInstalled = useCallback((m: StoreManifest | null) => {
    if (!m) return;
    const next: Record<string, Installed | null> = {};
    for (const app of m.apps) if (app.android) next[app.id] = StoreInstaller.getInstalledVersion(app.android.packageName);
    setInstalled(next);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const m = await fetchManifest(creds);
      setManifest(m);
      readInstalled(m);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [creds, readInstalled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && readInstalled(manifest));
    return () => sub.remove();
  }, [manifest, readInstalled]);

  useEffect(() => {
    const downloading = (e: InstallProgress) =>
      setBusy(e.packageName, { label: downloadLabel(e.bytes, e.total), value: e.total > 0 ? e.bytes / e.total : null });
    StoreInstaller.getActiveInstalls().then((list) => list.forEach(downloading));
    const sub = StoreInstaller.addListener('onInstallProgress', downloading);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = StoreInstaller.addListener('onInstallStatus', (e: InstallStatusEvent) => {
      const pkg = e.packageName ?? '';
      if (e.status === 'PENDING_USER_ACTION' || e.status === 'INSTALLING') {
        setBusy(pkg, { label: e.status === 'INSTALLING' ? 'Installing' : 'Waiting for you to confirm', value: null });
        return;
      }
      setBusy(pkg, null);
      readInstalled(manifest);
      const body = installFailure(e.status, e.message);
      if (body) report(pkg, { title: 'Install failed', body });
    });
    return () => sub.remove();
  }, [manifest, readInstalled]);

  const install = async (app: StoreApp) => {
    const release = app.android!;
    if (!StoreInstaller.canRequestPackageInstalls()) {
      Alert.alert('Allow installs', 'Turn on "Install unknown apps" for Store, then come back and tap again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => StoreInstaller.openInstallPermissionSettings() },
      ]);
      return;
    }
    if (release.signingCertSha256 !== SIGNING_CERT_SHA256) {
      report(release.packageName, {
        title: 'Install blocked',
        body: 'The server lists a signing key this Store does not trust, so Store will not install it. Republish it with the apps-hub release key.',
      });
      return;
    }
    report(release.packageName, null);
    setBusy(release.packageName, { label: 'Downloading', value: null });
    try {
      const url = await signUrl(creds, release.apkPath);
      StoreInstaller.installApk(url, release.packageName, app.name, release.sha256, SIGNING_CERT_SHA256);
    } catch (e) {
      setBusy(release.packageName, null);
      report(release.packageName, { title: 'Install failed', body: String((e as Error).message) });
    }
  };

  const changeInterval = (h: number) => {
    StoreInstaller.scheduleUpdateCheck(h);
    setHours(h);
  };

  const signOut = () => {
    StoreInstaller.clearCredentials();
    StoreInstaller.scheduleUpdateCheck(0);
    onSignOut();
  };

  const apps = manifest?.apps ?? [];
  const statuses = apps.map((a) => appStatus(a, installed[a.id] ?? null));
  const subtitle = manifest ? listSummary(statuses) : error ? undefined : 'Loading your apps';
  const retry = <Button label="Try again" variant="secondary" size="sm" onPress={refresh} busy={refreshing} />;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={refresh}>
      <Header title="Store" subtitle={subtitle} />

      {error && (
        <Notice tone="danger" title={manifest ? 'Could not refresh' : 'Could not load your apps'} action={retry}>
          {manifest ? `${error}\nShowing the list from the last successful check.` : error}
        </Notice>
      )}
      {problems[''] && (
        <Notice tone="danger" title={problems[''].title} action={<Button label="Dismiss" variant="ghost" size="sm" onPress={() => report('', null)} />}>
          {problems[''].body}
        </Notice>
      )}

      {manifest && apps.length === 0 && (
        <Empty
          title="No apps yet"
          body="Publish an app with the release tool and it appears here. Pull down to check again."
          action={<Button label="Check again" variant="secondary" onPress={refresh} busy={refreshing} />}
        />
      )}

      {apps.length > 0 && (
        <Group title="Apps">
          {apps.map((item, i) => {
            const status = statuses[i];
            const pill = statusPill(status);
            const pkg = item.android?.packageName;
            const busy = pkg ? progress[pkg] : undefined;
            const problem = pkg ? problems[pkg] : undefined;
            const lines = versionLines(item, installed[item.id] ?? null);
            return (
              <Row
                key={item.id}
                leading={<Monogram name={item.name} />}
                title={
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
                    <Text variant="bodyStrong">{item.name}</Text>
                    <Pill label={pill.label} tone={pill.tone} />
                  </View>
                }
                subtitle={lines.map((l) => (
                  <Text key={l.label} variant="meta" tone="muted">
                    {`${l.label} `}
                    <Text variant="data" tone={l.label === 'Available' && status.kind === 'update' ? 'text' : 'muted'}>
                      {l.version}
                    </Text>
                  </Text>
                ))}
                trailing={
                  !busy && status.action ? (
                    <Button
                      label={status.action}
                      size="sm"
                      variant={status.action === 'Reinstall' ? 'secondary' : 'primary'}
                      onPress={() => install(item)}
                      accessibilityHint={`${status.action}s ${item.name}`}
                    />
                  ) : undefined
                }
              >
                {busy && (
                  <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
                    <Progress value={busy.value} />
                    <Text variant="meta" tone="muted">
                      {busy.label}
                    </Text>
                  </View>
                )}
                {status.warning && (
                  <Text variant="meta" tone="warn">
                    {status.warning}
                  </Text>
                )}
                {status.kind === 'update' && !!item.changelog && (
                  <View style={{ gap: 2 }}>
                    <Text variant="caption" tone="muted">
                      What’s new
                    </Text>
                    <Text variant="meta">{item.changelog}</Text>
                  </View>
                )}
                {problem && (
                  <Notice tone="danger" title={problem.title} action={<Button label="Dismiss" variant="ghost" size="sm" onPress={() => report(pkg!, null)} />}>
                    {problem.body}
                  </Notice>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      <Group title="Updates" footer="Checks run on Wi-Fi only.">
        <Row title="Check for updates" subtitle="Store notifies you when a new version is ready.">
          <Segmented<string>
            options={CHECK_INTERVALS}
            value={String(hours)}
            onChange={(k) => changeInterval(Number(k))}
            accessibilityLabel="How often to check for updates"
          />
        </Row>
      </Group>

      <Group title="Server">
        <Row title="Connected to" subtitle={creds.apiUrl} mono />
      </Group>
      <Button label="Sign out" variant="danger" onPress={signOut} block accessibilityHint="Removes the server address and token from this phone" />
    </Screen>
  );
}
