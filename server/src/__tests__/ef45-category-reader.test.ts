import { afterEach, describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyEf45AuditRecord,
  EF45_DIAGNOSTIC_CATEGORIES,
  ef45CategoryReader,
  type Ef45AuditRecord,
  isFixedEf45SyntheticProbe,
  readEf45Category,
} from '../observability/ef45CategoryReader';
import { EF45_R2_PROBE_MARKER } from '../observability/ef118RuntimeAudit';

const originalNodeEnv = process.env.NODE_ENV;

function record(overrides: Partial<Ef45AuditRecord> = {}): Ef45AuditRecord {
  return {
    timestamp: '2026-09-15T00:00:00.000Z',
    deploymentSha: 'a'.repeat(40),
    configPresence: {
      dashscopeApiKey: false,
      dashscopeDeepApiKey: false,
      supabaseUrl: false,
      supabaseAnonKey: false,
      supabaseServiceRoleKey: false,
    },
    dbSessionCategory: null,
    providerCategory: null,
    sseCategory: null,
    frontendErrorMappingCategory: null,
    ef45ProbeMarker: EF45_R2_PROBE_MARKER,
    ...overrides,
  };
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('EF-45 DEV category-only reader', () => {
  it('accepts only the exact marker and immutable two-field synthetic payload', () => {
    expect(isFixedEf45SyntheticProbe(EF45_R2_PROBE_MARKER, {
      roleId: 'clever-fox',
      message: 'EF45_SYNTHETIC_PROBE_V1',
    })).toBe(true);
    expect(isFixedEf45SyntheticProbe(EF45_R2_PROBE_MARKER, {
      roleId: 'clever-fox',
      message: 'different',
    })).toBe(false);
    expect(isFixedEf45SyntheticProbe('other-marker', {
      roleId: 'clever-fox',
      message: 'EF45_SYNTHETIC_PROBE_V1',
    })).toBe(false);
    expect(isFixedEf45SyntheticProbe(EF45_R2_PROBE_MARKER, {
      roleId: 'clever-fox',
      message: 'EF45_SYNTHETIC_PROBE_V1',
      conversationId: 'must-not-be-accepted',
    })).toBe(false);
  });

  it.each([
    ['session_csrf', record({ dbSessionCategory: 'session_missing' })],
    ['chat_start', record({ dbSessionCategory: 'chat_start_processing_error' })],
    ['stream_transport', record({ sseCategory: 'timeout' })],
    ['provider_runtime_config', record({ providerCategory: 'key_missing' })],
    ['application_internal', record()],
  ] as const)('maps %s without returning audit fields', (expected, input) => {
    expect(classifyEf45AuditRecord(input)).toBe(expected);
  });

  it('returns the exact three-field schema for the latest fixed marker only', () => {
    process.env.NODE_ENV = 'development';
    const result = readEf45Category(
      () => [
        JSON.stringify({ ...record(), ef45ProbeMarker: null }),
        JSON.stringify(record({ providerCategory: 'response_server_error' })),
      ].join('\n'),
      () => true,
    );
    expect(Object.keys(result)).toEqual(['buildSha', 'observedAt', 'category']);
    expect(result).toEqual({
      buildSha: 'a'.repeat(40),
      observedAt: '2026-09-15T00:00:00.000Z',
      category: 'provider_runtime_config',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ef45ProbeMarker|dbSessionCategory|providerCategory|sseCategory|frontendErrorMappingCategory|configPresence|rawError/i,
    );
  });

  it('rejects a marker record with an extra field instead of widening the reader schema', () => {
    process.env.NODE_ENV = 'development';
    expect(readEf45Category(
      () => JSON.stringify({ ...record(), rawError: 'must-not-be-accepted' }),
      () => true,
    )).toEqual({
      buildSha: 'unavailable', observedAt: 'unavailable', category: 'no_matching_record',
    });
  });

  it('fails closed for no record, malformed input, and non-DEV environments', () => {
    process.env.NODE_ENV = 'development';
    expect(readEf45Category(() => '{not-json}', () => true)).toEqual({
      buildSha: 'unavailable', observedAt: 'unavailable', category: 'no_matching_record',
    });
    process.env.NODE_ENV = 'production';
    expect(readEf45Category(() => JSON.stringify(record()), () => true)).toEqual({
      buildSha: 'unavailable', observedAt: 'unavailable', category: 'no_matching_record',
    });
  });

  it('is DEV-only, accepts no query parameters, and exposes no browsing controls', async () => {
    const app = express();
    app.get('/api/v1/diagnostics/ef45-category', ef45CategoryReader);
    process.env.NODE_ENV = 'production';
    await request(app).get('/api/v1/diagnostics/ef45-category').expect(404);
    process.env.NODE_ENV = 'development';
    await request(app).get('/api/v1/diagnostics/ef45-category?path=/var/log').expect(404);
  });

  it('keeps the fixed synthetic probe outside conversation/history persistence paths', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const ingress = source.slice(
      source.indexOf("app.post('/api/v1/chat/start'"),
      source.indexOf("app.get('/api/v1/chat/stream'"),
    );
    expect(ingress).toContain('isFixedEf45SyntheticProbe');
    expect(ingress).toContain('if (!ef45ProbeMarker)');
    expect(ingress).not.toMatch(/conversationsRouter\.(?:post|use)|getSupabaseClient\(|createOwnerBinding\(/);
    expect(source).toContain("if (!ef45ProbeMarker && session.userId && session.neuralProfile)");
    expect(source).toContain("process.env.NODE_ENV === 'development' && !ef45ProbeMarker");
  });

  it('keeps the category vocabulary closed', () => {
    expect(EF45_DIAGNOSTIC_CATEGORIES).toEqual([
      'session_csrf', 'chat_start', 'stream_transport', 'provider_runtime_config',
      'application_internal', 'no_matching_record',
    ]);
  });
});
