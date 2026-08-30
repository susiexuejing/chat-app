import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import type { ChatSession } from '../index';

const originalApiKey = process.env.DASHSCOPE_API_KEY;
process.env.DASHSCOPE_API_KEY = 'synthetic-ef110-provider-key';

jest.unstable_mockModule('../security/anonymousSession', () => ({
  EF75_WEB_ORIGIN: 'https://dev.douhaoyu.cn',
  requireAnonymousSession: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.anonymousSession = {
      id: '33333333-3333-4333-8333-333333333333',
      transport: 'native',
      expiresAt: Date.now() + 60_000,
      csrfHash: null,
    };
    next();
  },
  getVerifiedAnonymousSession: (res: { locals: { anonymousSession: unknown } }) =>
    res.locals.anonymousSession,
  authenticateAnonymousRequest: jest.fn(async () => ({
    ok: true,
    session: {
      id: '33333333-3333-4333-8333-333333333333',
      transport: 'native',
      expiresAt: Date.now() + 60_000,
      csrfHash: null,
    },
  })),
  sendAnonymousFailure: jest.fn(),
  verifyOwnedConversation: jest.fn(async () => 'owned'),
}));

jest.unstable_mockModule('../routes/anonymousSessions', () => ({
  default: express.Router(),
}));

const { app, startDeepAnalysis } = await import('../index');
const { neuralManager } = await import('../flows/neuralProfileManager');

const SENTINELS = [
  'session-sentinel-110',
  'response-run-sentinel-110',
  'request-sentinel-110',
  'conversation-sentinel-110',
  'message-sentinel-110',
  'user-sentinel-110',
  'USER-CONTENT-SENTINEL-110',
  'MODEL-CONTENT-SENTINEL-110',
  'provider-fragment-sentinel-110',
  'database-detail-sentinel-110',
  'token-sentinel-110',
  'Cookie=sentinel-110',
  'credential-sentinel-110',
  'secret-sentinel-110',
  '/private/path/sentinel-110',
  'STACK-SENTINEL-110',
] as const;

function sensitiveError(): Error {
  const error = new Error(SENTINELS.join(' '));
  error.stack = `STACK-SENTINEL-110 at /private/path/sentinel-110:42`;
  return error;
}

function makeSession(): ChatSession {
  return {
    sessionId: SENTINELS[0],
    ownerSessionId: '33333333-3333-4333-8333-333333333333',
    userId: SENTINELS[5],
    roleId: 'clever-fox',
    roleName: 'synthetic-role',
    userMessage: SENTINELS[6],
    emotionTag: 'general',
    eventTag: 'general',
    state: 'general',
    keywords: [SENTINELS[6]],
    frontFlowText: SENTINELS[7],
    reactionLayer: '',
    companionLayer: '',
    deepReadyAt: 0,
    createdAt: 0,
    deepChunks: [],
    deepDone: false,
    deepStreaming: false,
    deepError: null,
    neuralProfile: {
      userId: SENTINELS[5],
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
    },
    flowResult: null,
    flowContext: null,
    eventSequencer: {} as ChatSession['eventSequencer'],
  };
}

function expectNoSensitiveData(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe('EF-110 index production-path sanitization', () => {
  let consoleError: jest.SpiedFunction<typeof console.error>;
  let consoleLog: jest.SpiedFunction<typeof console.log>;
  let consoleWarn: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    const logOutput = [
      ...consoleError.mock.calls,
      ...consoleLog.mock.calls,
      ...consoleWarn.mock.calls,
    ];
    expectNoSensitiveData(logOutput);
    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalApiKey;
  });

  test('provider rejection keeps only allowlisted diagnostic metadata', async () => {
    const providerBody = SENTINELS.join(' ');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(providerBody, { status: 503 }),
    );
    const session = makeSession();

    await startDeepAnalysis(session, 2);

    expect(session.deepError).toBe('provider_api_error');
    expect(session.deepStreaming).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      '[Deep] Provider response rejected',
      {
        code: 'provider_api_error',
        retryable: true,
        statusClass: 'server_error',
      },
    );
  });

  test('missing provider reader returns a stable safe class', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const session = makeSession();

    await startDeepAnalysis(session, 2);

    expect(session.deepError).toBe('stream_reader_missing');
    expect(session.deepStreaming).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      '[Deep] Provider response reader missing',
      { code: 'stream_reader_missing', retryable: true },
    );
  });

  test('chat/start exception returns a stable generic HTTP 500 without raw cause', async () => {
    jest.spyOn(neuralManager, 'getOrCreateProfile').mockImplementationOnce(() => {
      throw sensitiveError();
    });

    const response = await request(app)
      .post('/api/v1/chat/start')
      .send({
        roleId: 'clever-fox',
        message: SENTINELS[6],
        userId: SENTINELS[5],
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'internal_server_error',
    });
    expectNoSensitiveData(response.body);
    expect(consoleError).toHaveBeenCalledWith(
      '[Start] Request handling failed',
      { code: 'chat_start_processing_failed', retryable: true },
    );
  });

  test('confirmed historical log sites no longer interpolate raw runtime values', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:sessionId|userId|requestId|conversationId)/);
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:errorText|substring\(|trigger\.detail)/);
    expect(source).not.toMatch(/console\.error\([^\n]*,\s*(?:error|err|e|flowErr|ltuErr)\b/);
    expect(source).not.toContain('DashScope error: ${response.status} - ${errorText}');
    expect(source).not.toContain('Raw SSE line (no content): ${data.substring');
    expect(source).not.toContain('Parse error for line: ${data.substring');
    expect(source).not.toContain('Non-SSE line: ${line.substring');
  });
});
