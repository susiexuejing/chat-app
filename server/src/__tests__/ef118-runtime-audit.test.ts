import { jest } from '@jest/globals';

// ESM imports are evaluated before jest.mock; register the filesystem mock first.
jest.unstable_mockModule('node:fs', () => ({
  appendFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
  lstatSync: jest.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => false })),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const fs = await import('node:fs');
const {
  EF45_R2_PROBE_MARKER,
  EF118_AUDIT_FIELD_WHITELIST,
  EF118_PROVIDER_HTTP_CLIENT_ERROR_CATEGORIES,
  EF118_RUNTIME_AUDIT_PATH,
  classifyEf118ProviderHttpStatus,
  createEf118RuntimeAuditRecord,
  isEf118RuntimeAuditEnabled,
  writeEf118RuntimeAudit,
} = await import('../observability/ef118RuntimeAudit');
const {
  EF45_DIAGNOSTIC_CATEGORIES,
  classifyEf45AuditRecord,
  ef45CategoryReader,
  readEf45Category,
} = await import('../observability/ef45CategoryReader');

describe('EF-118 sanitized runtime audit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
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
      'ef45ProbeMarker',
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
      ef45ProbeMarker: null,
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
    expect(JSON.parse(serialized).ef45ProbeMarker).toBeNull();
  });

  it('is enabled only for the development runtime', () => {
    process.env.NODE_ENV = 'test';
    expect(isEf118RuntimeAuditEnabled()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(isEf118RuntimeAuditEnabled()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(isEf118RuntimeAuditEnabled()).toBe(true);
  });

  it('classifies all integer 4xx values into exactly six fixed literals', () => {
    expect(EF118_PROVIDER_HTTP_CLIENT_ERROR_CATEGORIES).toEqual([
      'response_http_400', 'response_http_401', 'response_http_403',
      'response_http_404', 'response_http_429', 'response_http_other_4xx',
    ]);
    const known = new Map([
      [400, 'response_http_400'], [401, 'response_http_401'], [403, 'response_http_403'],
      [404, 'response_http_404'], [429, 'response_http_429'],
    ]);
    for (let status = 400; status <= 499; status++) {
      expect(classifyEf118ProviderHttpStatus(status)).toBe(known.get(status) ?? 'response_http_other_4xx');
    }
    for (const status of [199, 200, 302, 399, 500, 599, 400.5, NaN, Infinity, -Infinity,
      '401', 'response_http_401', null, undefined, true, [], {}, { valueOf: () => 401 }]) {
      expect(classifyEf118ProviderHttpStatus(status)).toBeNull();
    }
  });

  it('allows only the six new private categories and never serializes raw diagnostics', () => {
    for (const providerCategory of EF118_PROVIDER_HTTP_CLIENT_ERROR_CATEGORIES) {
      const record = createEf118RuntimeAuditRecord({ providerCategory });
      expect(record.providerCategory).toBe(providerCategory);
      expect(Object.keys(record)).toEqual(EF118_AUDIT_FIELD_WHITELIST);
    }
    for (const providerCategory of ['response_http_402', 'response_http_500', 'response_http_401_extra',
      ' response_http_401', 'RESPONSE_HTTP_401', 'raw-sensitive-value']) {
      const record = createEf118RuntimeAuditRecord({ providerCategory,
        status: 401, code: 'raw-sensitive-code', message: 'raw-sensitive-message',
        body: 'raw-sensitive-body', url: 'raw-sensitive-url', model: 'raw-sensitive-model',
      } as unknown as Parameters<typeof createEf118RuntimeAuditRecord>[0]);
      expect(record.providerCategory).toBeNull();
      expect(Object.keys(record)).toEqual(EF118_AUDIT_FIELD_WHITELIST);
      expect(JSON.stringify(record)).not.toMatch(/raw-sensitive|"status"|"code"|"message"|"body"|"url"|"model"/);
    }
  });

  it('writes new categories only to the unchanged private DEV sink and permissions', () => {
    for (const env of ['production', 'test', '', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      writeEf118RuntimeAudit({ providerCategory: 'response_http_401' });
    }
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'development';
    for (const providerCategory of EF118_PROVIDER_HTTP_CLIENT_ERROR_CATEGORIES) {
      writeEf118RuntimeAudit({ providerCategory });
    }
    expect(fs.appendFileSync).toHaveBeenCalledTimes(6);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/var/log/emotionflow', { recursive: true, mode: 0o750 });
    for (const [path, line, options] of (fs.appendFileSync as jest.Mock<typeof fs.appendFileSync>).mock.calls) {
      expect(path).toBe(EF118_RUNTIME_AUDIT_PATH);
      expect(options).toEqual({ encoding: 'utf8', mode: 0o640, flag: 'a' });
      expect(typeof line).toBe('string');
      if (typeof line !== 'string') throw new Error('Audit record must be serialized as a string');
      expect(Object.keys(JSON.parse(line))).toEqual(EF118_AUDIT_FIELD_WHITELIST);
      expect(line).not.toMatch(/synthetic-provider-secret|synthetic-deep-secret|synthetic\.invalid|synthetic-anon-secret|synthetic-service-secret/);
    }
  });

  it('downgrades every private status to the original public category and three fields', () => {
    process.env.NODE_ENV = 'development';
    expect(EF45_DIAGNOSTIC_CATEGORIES).toEqual([
      'session_csrf', 'chat_start', 'stream_transport', 'provider_runtime_config',
      'application_internal', 'no_matching_record',
    ]);
    for (const providerCategory of EF118_PROVIDER_HTTP_CLIENT_ERROR_CATEGORIES) {
      const record = createEf118RuntimeAuditRecord({ providerCategory, ef45ProbeMarker: EF45_R2_PROBE_MARKER });
      expect(classifyEf45AuditRecord(record)).toBe('provider_runtime_config');
      const result = readEf45Category(() => JSON.stringify(record), () => true);
      expect(result).toEqual({ buildSha: record.deploymentSha, observedAt: record.timestamp, category: 'provider_runtime_config' });
      expect(Object.keys(result)).toEqual(['buildSha', 'observedAt', 'category']);
      expect(JSON.stringify(result)).not.toMatch(/response_http|providerCategory|configPresence|ef45ProbeMarker/);
      expect(classifyEf45AuditRecord({ ...record, sseCategory: 'deep_failure' })).toBe('stream_transport');
      expect(classifyEf45AuditRecord({ ...record, dbSessionCategory: 'session_missing' })).toBe('session_csrf');
      for (const unknown of [providerCategory + '_extra', providerCategory.toUpperCase(), ' ' + providerCategory, 'response_http_402']) {
        expect(classifyEf45AuditRecord({ ...record, providerCategory: unknown })).toBe('application_internal');
      }
    }
  });

  it('keeps the public reader DEV-only, fixed-marker-only, and rejects all query options', () => {
    const record = createEf118RuntimeAuditRecord({ providerCategory: 'response_http_429', ef45ProbeMarker: EF45_R2_PROBE_MARKER });
    const read = jest.fn(() => JSON.stringify(record));
    for (const env of ['production', 'test', '']) {
      process.env.NODE_ENV = env;
      expect(readEf45Category(read, () => true).category).toBe('no_matching_record');
    }
    expect(read).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'development';
    expect(readEf45Category(() => JSON.stringify({ ...record, ef45ProbeMarker: null }), () => true).category).toBe('no_matching_record');
    expect(readEf45Category(() => JSON.stringify({ ...record, status: 429 }), () => true).category).toBe('no_matching_record');
    expect(readEf45Category(() => 'not-json', () => true).category).toBe('no_matching_record');
    for (const query of [{ status: '401' }, { path: '/different' }, { marker: 'caller' }]) {
      const res = { status: jest.fn().mockReturnThis(), end: jest.fn(), json: jest.fn() };
      ef45CategoryReader({ query } as unknown as Parameters<typeof ef45CategoryReader>[0],
        res as unknown as Parameters<typeof ef45CategoryReader>[1]);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(res.json).not.toHaveBeenCalled();
    }
  });
});
