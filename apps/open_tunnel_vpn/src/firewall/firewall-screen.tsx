import React, { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Dot,
  Group,
  Header,
  Notice,
  Pill,
  Row,
  Screen,
  Segmented,
  Sheet,
  Text,
  space,
  type Tone,
} from '@apps-hub/ui';
import type { FirewallApi, FirewallRuleKind, FirewallStatus } from 'open-tunnel-native';

import { formatBytes } from '../ui/format.ts';
import { activityRow } from './activity.ts';
import { FIREWALL_CONSENT_POINTS, LAN_COVERAGE_LINE } from './copy.ts';
import type { AppUseRow } from './data-use.ts';
import { firewallView, type FirewallLabel } from './status.ts';
import { ACTIVITY_LIMIT, useFirewall, type ActivityView } from './use-firewall.ts';

export interface FirewallScreenProps {
  api: FirewallApi;
  /** True while a server tunnel holds the VPN slot (`serverHoldsSlot(tunnel.state)`). */
  serverConnected: boolean;
  /** True once the owner confirmed the consent sheet; it shows on the first turn-on only. */
  consented: boolean;
  /** Called when the owner confirms the consent sheet, to remember it. */
  onConsent(): void;
}

const LABEL_TONE: Record<FirewallLabel, Tone> = { On: 'ok', Paused: 'warn', Off: 'neutral' };

const RULE_OPTIONS = [
  { key: 'allow', label: 'Allow' },
  { key: 'block_on_mobile', label: 'Block mobile', a11yLabel: 'Block on mobile data' },
  { key: 'block_always', label: 'Block always' },
] as const;

const RULE_PILL: Record<FirewallRuleKind, { label: string; tone: Tone }> = {
  allow: { label: 'Allowed', tone: 'neutral' },
  block_on_mobile: { label: 'Blocked on mobile', tone: 'warn' },
  block_always: { label: 'Blocked always', tone: 'danger' },
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All connections' },
  { key: 'blocked', label: 'Blocked only' },
] as const;

const APPS_SHOWN = 25;

export function FirewallScreen({ api, serverConnected, consented, onConsent }: FirewallScreenProps) {
  const [view, setView] = useState<ActivityView>({ blockedOnly: false });
  const [consentOpen, setConsentOpen] = useState(false);
  const fw = useFirewall(api, view);
  const { status, apps } = fw;

  const names = useMemo(() => new Map((apps ?? []).map((app) => [app.uid, app.label])), [apps]);
  const showActivityFor = useCallback((uid: number) => setView((v) => ({ ...v, uid })), []);

  const confirmConsent = () => {
    setConsentOpen(false);
    onConsent();
    void fw.enable();
  };

  return (
    <>
      <Screen scroll refreshing={fw.refreshing} onRefresh={() => void fw.reload()}>
        <Header title="Firewall" subtitle="See which apps connect, and block the ones you choose." />

        {fw.readError !== null && (
          <Notice
            tone="danger"
            title="Couldn't read the firewall"
            action={<Button label="Try again" variant="secondary" size="sm" onPress={() => void fw.reload()} />}
          >
            {fw.readError}
          </Notice>
        )}
        {fw.actionError !== null && (
          <Notice
            tone="danger"
            title="Couldn't change the firewall"
            action={<Button label="Dismiss" variant="secondary" size="sm" onPress={fw.dismissActionError} />}
          >
            {fw.actionError}
          </Notice>
        )}

        {status === null ? (
          fw.readError === null && <Text tone="muted">Checking the firewall.</Text>
        ) : (
          <>
            <StatusGroup
              status={status}
              serverConnected={serverConnected}
              busy={fw.busy}
              onTurnOn={() => (consented ? void fw.enable() : setConsentOpen(true))}
              onRestart={() => void fw.enable()}
              onTurnOff={() => void fw.disable()}
              onPause={() => void fw.setPaused(true)}
              onResume={() => void fw.setPaused(false)}
            />

            {!status.usageAccess && (
              <Notice
                tone="neutral"
                title="Data use is empty"
                action={
                  <Button
                    label="Allow usage access"
                    variant="secondary"
                    size="sm"
                    disabled={fw.busy}
                    onPress={() => void fw.openUsageAccess()}
                  />
                }
              >
                Android shares each app's data use only when you allow usage access, so the amounts stay empty until
                then. This is optional, and the firewall works without it.
              </Notice>
            )}

            <AppsGroup
              apps={apps}
              error={fw.appsError}
              onRetry={fw.reloadApps}
              usageAccess={status.usageAccess}
              onSetRule={fw.setRule}
              onShowActivity={showActivityFor}
            />

            <Group title="Activity" footer={`The latest ${ACTIVITY_LIMIT} connections, newest first.`}>
              <View style={{ padding: space.lg }}>
                <Segmented
                  options={FILTER_OPTIONS}
                  value={view.blockedOnly ? 'blocked' : 'all'}
                  onChange={(key) => setView((v) => ({ ...v, blockedOnly: key === 'blocked' }))}
                  accessibilityLabel="Activity filter"
                />
              </View>
              {view.uid !== undefined && (
                <Row
                  title={`Only ${names.get(view.uid) ?? 'one app'}`}
                  trailing={
                    <Button
                      label="Show all apps"
                      variant="secondary"
                      size="sm"
                      onPress={() => setView((v) => ({ blockedOnly: v.blockedOnly }))}
                    />
                  }
                />
              )}
              {fw.activity.length === 0 ? (
                <Row
                  title="No connections to show"
                  subtitle={
                    status.enabled
                      ? 'Connections appear here as apps use the network.'
                      : 'Turn the firewall on to log connections.'
                  }
                />
              ) : (
                fw.activity.map((entry, index) => {
                  const row = activityRow(entry, names.get(entry.uid));
                  const blocked = entry.verdict === 'blocked';
                  return (
                    <Row
                      key={`${entry.timestampMs}-${index}`}
                      title={row.title}
                      subtitle={row.subtitle}
                      trailing={<Pill label={blocked ? 'Blocked' : 'Allowed'} tone={blocked ? 'danger' : 'neutral'} />}
                    />
                  );
                })
              )}
            </Group>
          </>
        )}
      </Screen>

      <Sheet visible={consentOpen} onClose={() => setConsentOpen(false)} title="Before you turn the firewall on" doneLabel="Cancel">
        <Group title="What to know">
          {FIREWALL_CONSENT_POINTS.map((point) => (
            <Row key={point} title={<Text>{point}</Text>} />
          ))}
        </Group>
        <Notice tone="neutral">{LAN_COVERAGE_LINE}</Notice>
        <Text variant="meta" tone="muted">
          Next, Android asks you to allow a VPN connection. After that you can choose to allow usage access, which fills
          in each app's data use.
        </Text>
        <Button label="Turn on the firewall" block onPress={confirmConsent} />
      </Sheet>
    </>
  );
}

function StatusGroup({
  status,
  serverConnected,
  busy,
  onTurnOn,
  onRestart,
  onTurnOff,
  onPause,
  onResume,
}: {
  status: FirewallStatus;
  serverConnected: boolean;
  busy: boolean;
  onTurnOn(): void;
  onRestart(): void;
  onTurnOff(): void;
  onPause(): void;
  onResume(): void;
}) {
  const view = firewallView(status, serverConnected);
  const tone = LABEL_TONE[view.label];
  const startDisabled = busy || !view.canStart;
  return (
    <Group title="Status" footer={LAN_COVERAGE_LINE}>
      <Row
        title="Firewall"
        subtitle={view.detail ?? undefined}
        leading={<Dot tone={tone} />}
        trailing={<Pill label={view.label} tone={tone} />}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, padding: space.lg }}>
        {view.label === 'On' && <Button label="Pause" variant="secondary" disabled={busy} onPress={onPause} />}
        {view.label === 'Paused' && <Button label="Resume" disabled={startDisabled} onPress={onResume} />}
        {!status.enabled && <Button label="Turn on" disabled={startDisabled} onPress={onTurnOn} />}
        {status.enabled && view.label === 'Off' && (
          <Button label="Start again" disabled={startDisabled} onPress={onRestart} />
        )}
        {status.enabled && <Button label="Turn off" variant="danger" disabled={busy} onPress={onTurnOff} />}
      </View>
    </Group>
  );
}

const AppsGroup = memo(function AppsGroup({
  apps,
  error,
  onRetry,
  usageAccess,
  onSetRule,
  onShowActivity,
}: {
  apps: AppUseRow[] | null;
  error: string | null;
  onRetry(): void;
  usageAccess: boolean;
  onSetRule(uid: number, rule: FirewallRuleKind): void;
  onShowActivity(uid: number): void;
}) {
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const failure = error !== null && (
    <Notice
      tone="danger"
      title="Couldn't load apps"
      action={<Button label="Try again" variant="secondary" size="sm" onPress={onRetry} />}
    >
      {error}
    </Notice>
  );
  if (apps === null) {
    return (
      failure || (
        <Group title="Apps">
          <Row title="Loading apps" />
        </Group>
      )
    );
  }
  const shown = showAll ? apps : apps.slice(0, APPS_SHOWN);
  return (
    <>
      {failure}
      <Group title="Apps" footer={usageAccess ? 'Data use covers the last 30 days, most mobile data first.' : undefined}>
        {shown.map((app) => {
          const pill = RULE_PILL[app.rule];
          const open = openUid === app.uid;
          return (
            <Row
              key={app.uid}
              title={app.label}
              subtitle={
                usageAccess ? `Wi-Fi ${formatBytes(app.wifiBytes)} · Mobile ${formatBytes(app.cellBytes)}` : app.pkg
              }
              mono={!usageAccess}
              trailing={<Pill label={pill.label} tone={pill.tone} />}
              onPress={() => setOpenUid(open ? null : app.uid)}
              accessibilityLabel={`${app.label}, ${pill.label}, ${open ? 'expanded' : 'collapsed'}`}
              accessibilityHint="Shows the rule for this app"
            >
              {open && (
                <View style={{ gap: space.md }}>
                  <Segmented
                    options={RULE_OPTIONS}
                    value={app.rule}
                    onChange={(rule) => onSetRule(app.uid, rule)}
                    accessibilityLabel={`Rule for ${app.label}`}
                  />
                  <Button
                    label="Show this app's activity"
                    variant="secondary"
                    size="sm"
                    onPress={() => onShowActivity(app.uid)}
                  />
                </View>
              )}
            </Row>
          );
        })}
        {apps.length > APPS_SHOWN && (
          <Row
            title={showAll ? 'Show fewer apps' : `Show all ${apps.length} apps`}
            onPress={() => setShowAll((all) => !all)}
          />
        )}
      </Group>
    </>
  );
});
