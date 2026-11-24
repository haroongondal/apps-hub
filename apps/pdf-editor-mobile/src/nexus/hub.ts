import { AiHubClient } from 'ai-hub-client';

import { hubComplete, hubStatus } from './hub-port';

/** Writes and edits CVs through the AI hub app. */
export const hubAi = hubComplete(AiHubClient);
export const checkHub = () => hubStatus(AiHubClient);
