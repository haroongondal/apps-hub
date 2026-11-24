import { requireNativeModule } from 'expo';

// Errors reject with a CodedException whose code is the hub's kind (auth, rate_limited, denied, ...) or one of
// hub_missing, hub_unreachable, hub_died, timeout, bad_reply.
export interface AiHubClientModule {
  /** Sends one request (docs/ai-hub/PLAN.md, apiVersion 1) and resolves with the result JSON. */
  submit(requestJson: string): Promise<string>;
  /** The hub's status JSON: apiVersion, key counts per service, and the model per job. */
  status(): Promise<string>;
}

export const AiHubClient = requireNativeModule<AiHubClientModule>('AiHubClient');
