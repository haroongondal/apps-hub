import React, { useState } from 'react';
import { Button, Group, Notice, Row } from '@apps-hub/ui';

import { useNetworkScan } from '../scan/ScanProvider';

function whenText(at: number): string {
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function NewDevices() {
  const { homeWatch } = useNetworkScan();
  const [problem, setProblem] = useState<string | null>(null);
  const status = homeWatch.status;
  if (!status?.supported || !status.settings.newDevices) return null;
  const fresh = status.newDevices.filter((d) => !d.acknowledged);
  if (fresh.length === 0) return null;
  return (
    <>
      <Group title="New on your Wi-Fi" footer="Found by the check in the background. Mark the ones you know so HomeNet stops asking.">
        {fresh.map((d) => (
          <Row
            key={d.ip}
            title={d.label}
            subtitle={`${d.ip}, joined ${whenText(d.firstSeenAt)}`}
            mono
            trailing={
              <Button
                label="This is mine"
                variant="secondary"
                size="sm"
                accessibilityHint="HomeNet stops telling you about this device for 30 days"
                onPress={() => {
                  homeWatch.markDeviceMine(d.ip).then(
                    () => setProblem(null),
                    (e: unknown) => setProblem(`HomeNet could not save this: ${e instanceof Error ? e.message : String(e)}`),
                  );
                }}
              />
            }
          />
        ))}
      </Group>
      {problem !== null ? <Notice tone="danger">{problem}</Notice> : null}
    </>
  );
}
