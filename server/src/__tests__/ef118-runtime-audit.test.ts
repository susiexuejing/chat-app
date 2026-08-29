import {
  EF118_AUDIT_FIELD_WHITELIST,
  EF118_RUNTIME_AUDIT_PATH,
  createEf118RuntimeAuditRecord,
  isEf118RuntimeAuditEnabled,
} from '../observability/ef118RuntimeAudit';

describe('EF-118 sanitized runtime audit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GIT_COMMIT: 'a'.repeat(40),
      DASHSCOPE_API_KEY: 'synthetic-provider-secret',
      DASHSCOPE_API_KEY_DEEP: 'synthetic-deep-secret',
      COZE_SUPABASE_URL: 'https://synthetic.invalid',
      COZE_SUPABASE_ANON_KEY: 'synthetic-anon-secret',
      COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-secret',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the fixed DEV-only evidence path and exact top-level whitelist', () => {
    expect(EF118_RUNTIME_AUDIT_PATH).toBe('/var/log/emotionflow/ef118-runtime-sanitized.jsonl');
    expect(EF118_AUDIT_FIELD_WHITELIST).toEqual([
      'timestamp',
      'deploymentSha',
      'configPresence',
      'dbSessionCategory',
      'providerCategory',
      'sseCategory',
      'frontendErrorMappingCategory',
    ]);
  });

  it('serializes only booleans and bounded classifications', () => {
    const record = createEf118RuntimeAuditRecord({
      dbSessionCategory: 'conversation_storage_error',
      providerCategory: 'response_server_error',
      sseCategory: 'deep_failure',
      frontendErrorMappingCategory: 'safe_connection_retry',
    }, new Date('2026-08-29T00:00:00.000Z'));

    expect(Object.keys(record)).toEqual(EF118_AUDIT_FIELD_WHITELIST);
    expect(record).toEqual({
      timestamp: '2026-08-29T00:00:00.000Z',
      deploymentSha: 'a'.repeat(40),
      configPresence: {
        dashscopeApiKey: true,
        dashscopeDeepApiKey: true,
        supabaseUrl: true,
        supabaseAnonKey: true,
        supabaseServiceRoleKey: true,
      },
      dbSessionCategory: 'conversation_storage_error',
      providerCategory: 'response_server_error',
      sseCategory: 'deep_failure',
      frontendErrorMappingCategory: 'safe_connection_retry',
    });
  });

  it('drops extra fields, raw text, identifiers, and invalid classifications', () => {
    const unsafe = {
      dbSessionCategory: 'raw database error',
      providerCategory: 'request_started',
      message: 'private user message',
      requestBody: { token: 'x' },
      sessionId: 'session-sensitive',
      userId: 'user-sensitive',
      ip: '203.0.113.1',
      error: new Error('raw provider detail'),
    } as unknown as Parameters<typeof createEf118RuntimeAuditRecord>[0];

    const serialized = JSON.stringify(createEf118RuntimeAuditRecord(unsafe));
    expect(serialized).not.toMatch(/private user message|session-sensitive|user-sensitive|203\.0\.113\.1|raw provider detail|"token":"x"/);
    expect(JSON.parse(serialized).dbSessionCategory).toBeNull();
    expect(JSON.parse(serialized).providerCategory).toBe('request_started');
  });

  it('records only configuration presence and never configuration values', () => {
    const serialized = JSON.stringify(createEf118RuntimeAuditRecord({
      dbSessionCategory: 'runtime_started',
    }));
    expect(serialized).not.toMatch(/synthetic-provider-secret|synthetic-deep-secret|synthetic\.invalid|synthetic-anon-secret|synthetic-service-secret/);
    expect(JSON.parse(serialized).configPresence).toEqual({
      dashscopeApiKey: true,
      dashscopeDeepApiKey: true,
      supabaseUrl: true,
      supabaseAnonKey: true,
      supabaseServiceRoleKey: true,
    });
  });

  it('is enabled only for the development runtime', () => {
    process.env.NODE_ENV = 'test';
    expect(isEf118RuntimeAuditEnabled()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(isEf118RuntimeAuditEnabled()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(isEf118RuntimeAuditEnabled()).toBe(true);
  });
});
