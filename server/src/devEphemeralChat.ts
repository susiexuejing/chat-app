import type { NeuralProfile } from './flows/neuralProfileManager';

export const DEV_EPHEMERAL_REQUEST_MODE = 'dev-ephemeral-v1' as const;
export const DEV_EPHEMERAL_START_PATH = '/api/v1/chat/dev-journey/start';

/** Closed request contract. No caller-supplied identity, history or settings. */
export function isValidDevEphemeralRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const input = body as Record<string, unknown>;
  const allowed = ['requestMode', 'roleId', 'message', 'requestId'];
  return Object.keys(input).every(key => allowed.includes(key))
    && input.requestMode === DEV_EPHEMERAL_REQUEST_MODE
    && input.roleId === 'clever-fox'
    && typeof input.message === 'string'
    && input.message.trim().length > 0
    && input.message.length <= 1000
    && typeof input.requestId === 'string'
    && /^[\w-]{1,100}$/.test(input.requestId);
}

/** Allocated per turn, never registered with or loaded from neuralManager. */
export function createDevEphemeralProfile(): NeuralProfile {
  return {
    userId: '',
    roleId: 'clever-fox',
    attentionBias: 'default',
    valueBias: 'default',
    influenceLog: [],
    longTermChangeLog: [],
    subconscious: {
      analyticalDepth: 0.4,
      emotionalSupport: 0.5,
      actionGuidance: 0.3,
      reflectiveSpace: 0.4,
      totalInteractions: 0,
      dominantEmotions: [],
      recentTopics: [],
      lastUpdated: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}
