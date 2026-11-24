import React, { useEffect, useState } from 'react';
import { aiHub } from 'ai-hub-client';
import { Button, Notice } from '@apps-hub/ui';
import InflowCore from 'inflow-core';
import { HUB_ACTION, HUB_COPY, OPEN_FAILED, hubIssueOf, issueOfAvailability, type HubIssue } from './aiHub.ts';

// Plain words and one button for a hub that is not ready. No hub error text ever reaches the screen.
export function HubIssueNotice({ issue }: { issue: HubIssue }) {
  const [failed, setFailed] = useState(false);
  const { label, opens } = HUB_ACTION[issue];
  const open = () => {
    try {
      setFailed(!(opens === 'store' ? InflowCore.openStore() : InflowCore.openAiHub()));
    } catch {
      setFailed(true);
    }
  };
  return (
    <Notice tone="warn" title={HUB_COPY[issue]} action={<Button label={label} variant="secondary" size="sm" onPress={open} />}>
      {failed ? OPEN_FAILED[opens] : undefined}
    </Notice>
  );
}

// An error text from the native side: the hub words get their button, any other text stays a plain notice.
export function AiErrorNotice({ text, title }: { text: string; title?: string }) {
  const issue = hubIssueOf(text);
  return issue !== null ? <HubIssueNotice issue={issue} /> : <Notice tone="danger" title={title}>{text}</Notice>;
}

// Asking the hub once also lists Inflow in AI hub's Apps, so the owner can allow it there.
export function useHubIssue(): HubIssue | null {
  const [issue, setIssue] = useState<HubIssue | null>(null);
  useEffect(() => {
    let live = true;
    aiHub.available().then((a) => live && setIssue(issueOfAvailability(a))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return issue;
}
