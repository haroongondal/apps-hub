import type { Availability } from 'ai-hub-client';

export type HubIssue = 'missing' | 'not-allowed' | 'version' | 'no-key';

// The same words the native side writes (HubCopy.kt); modules/inflow-core/fixtures/ai-hub-copy.json holds them and a test on each side reads it.
export const HUB_COPY: Record<HubIssue, string> = {
  missing: 'AI needs AI hub.',
  'not-allowed': 'Allow Inflow in AI hub.',
  version: 'AI needs a newer AI hub.',
  'no-key': 'Add a key in AI hub.',
};

export const HUB_ACTION: Record<HubIssue, { label: string; opens: 'store' | 'hub' }> = {
  missing: { label: 'Install AI hub', opens: 'store' },
  'not-allowed': { label: 'Open AI hub', opens: 'hub' },
  version: { label: 'Update AI hub', opens: 'store' },
  'no-key': { label: 'Open AI hub', opens: 'hub' },
};

export const OPEN_FAILED: Record<'store' | 'hub', string> = {
  store: "Inflow couldn't open the Store. Open it from your home screen.",
  hub: "Inflow couldn't open AI hub. Open it from your home screen.",
};

// A native error text is exactly one of the four words above when AI hub is not ready; anything else is not a hub issue.
export const hubIssueOf = (text: string | null | undefined): HubIssue | null =>
  (Object.keys(HUB_COPY) as HubIssue[]).find((k) => HUB_COPY[k] === text) ?? null;

export function issueOfAvailability(a: Availability): HubIssue | null {
  if (a.ok) return null;
  return a.kind === 'hub-missing' ? 'missing' : a.kind === 'not-allowed' ? 'not-allowed' : a.kind === 'version' ? 'version' : null;
}

export const AI_OFF_ASK = 'Turn on AI in Settings to ask questions.';
export const AI_OFF_NOTE = 'AI is off. Turn it on to send what Inflow saves from now on.';
export const FIRST_ON_NOTE = 'Inflow sends only what it saves from now on. Older items stay as they are.';

// Restored from the deleted KeyPanel in AiSettings.tsx (git show 4a464594:apps/inflow/src/AiSettings.tsx, "Free-tier keys share what Inflow sees"), now worded for AI hub and the health text.
export const FREE_TIER_NOTE = 'With a free-tier Gemini key, Google may use what Inflow sends, including your messages, bank SMS and health text, to improve its products. A key from a project with billing turned on avoids that. Check the key in AI hub.';
export const AI_GOES_TO = 'AI hub sends it to Groq, or to Gemini when Groq has no working key.';
