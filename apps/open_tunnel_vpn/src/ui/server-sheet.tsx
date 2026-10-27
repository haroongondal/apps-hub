/**
 * Server list sheet (phase-4 plan §5): a filterable modal grouped by
 * country (ISO codes — never flag emoji). Rows are display-only; the list
 * is loaded configless, and connecting re-fetches the sanitized payload by
 * node id in the parent before `startTunnel`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Empty,
  Field,
  Group,
  Pill,
  Row,
  Sheet,
  Text,
} from '@apps-hub/ui';

import type { VpnNode } from 'open-tunnel-core';
import type { TunnelSnapshot } from '../tunnel/tunnel-client.ts';
import { countryLabel, fitnessLabel, rttLabel, speedLabel } from './format.ts';

export interface ServerSheetProps {
  visible: boolean;
  onClose(): void;
  nodes: readonly VpnNode[];
  /** Node the tunnel client is currently attached to (pill marker). */
  activeId: string | null;
  /** True while the native state is live (connected family or busy). */
  live: boolean;
  tunnel: TunnelSnapshot;
  /** Disabled while the tunnel client is mid-transition. */
  busy: boolean;
  onConnect(node: VpnNode): void;
}

interface CountryGroup {
  code: string;
  title: string;
  nodes: VpnNode[];
}

function pillLabelFor(tunnel: TunnelSnapshot): string {
  switch (tunnel.state) {
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'reasserting':
      return 'Reconnecting';
    case 'disconnecting':
      return 'Disconnecting';
    default:
      return 'Selected';
  }
}

export function ServerSheet({ visible, onClose, nodes, activeId, live, tunnel, busy, onConnect }: ServerSheetProps) {
  const [filter, setFilter] = useState('');

  // A fresh sheet starts with an unfiltered list.
  useEffect(() => {
    if (visible) setFilter('');
  }, [visible]);

  const groups = useMemo<CountryGroup[]>(() => {
    const needle = filter.trim().toLowerCase();
    const matches = nodes.filter((node) => {
      if (needle.length === 0) return true;
      return (
        node.hostName.toLowerCase().includes(needle) ||
        node.countryShort.toLowerCase().includes(needle) ||
        node.countryLong.toLowerCase().includes(needle)
      );
    });
    const byCode = new Map<string, CountryGroup>();
    for (const node of matches) {
      const code = node.countryShort || '--';
      let group = byCode.get(code);
      if (!group) {
        group = { code, title: countryLabel(node), nodes: [] };
        byCode.set(code, group);
      }
      group.nodes.push(node);
    }
    return [...byCode.values()];
  }, [nodes, filter]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a server">
      <Field
        label="Filter"
        placeholder="Host name or country"
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {groups.length === 0 ? (
        <Empty
          title={nodes.length === 0 ? 'No servers cached yet' : 'No servers match'}
          body={
            nodes.length === 0
              ? 'Pull down on the home screen to load the VPN Gate list.'
              : 'Try another host name or country code.'
          }
        />
      ) : (
        groups.map((group) => (
          <Group
            key={group.code}
            title={group.title}
            footer="Measured latency appears once the relay is probed; the listed ping is the VPN Gate value."
          >
            {group.nodes.map((node) => {
              const attached = live && node.id === activeId;
              return (
                <Row
                  key={node.id}
                  title={node.hostName}
                  subtitle={
                    <View style={{ gap: 2 }}>
                      <Text variant="meta" tone="muted">
                        {`${rttLabel(node)} · ${speedLabel(node)} · ${node.numSessions} sessions`}
                      </Text>
                      <Text variant="meta" tone="faint">
                        {`score ${node.score} · ${fitnessLabel(node)}`}
                      </Text>
                    </View>
                  }
                  trailing={attached ? <Pill label={pillLabelFor(tunnel)} tone="ok" /> : undefined}
                  onPress={busy ? undefined : () => onConnect(node)}
                  accessibilityLabel={`Connect to ${node.hostName} in ${group.code}`}
                  accessibilityHint="Fetches this relay's config and starts the tunnel"
                />
              );
            })}
          </Group>
        ))
      )}
    </Sheet>
  );
}
