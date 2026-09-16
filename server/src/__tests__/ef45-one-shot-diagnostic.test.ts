import { afterEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import {
  EF45_ONE_SHOT_DIAGNOSTIC_CATEGORIES,
  EF45_ONE_SHOT_DIAGNOSTIC_HEADER,
  createEf45OneShotDiagnosticMarker,
  ef45OneShotDiagnosticArm,
  ef45OneShotDiagnosticFrontendTerminal,
  ef45OneShotDiagnosticReader,
  knownEf45OneShotDiagnosticMarker,
  readEf45OneShotDiagnosticCategory,
  recordEf45OneShotDiagnosticCategory,
  resetEf45OneShotDiagnosticForTest,
} from '../observability/ef45OneShotDiagnostic';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  resetEf45OneShotDiagnosticForTest();
  process.env.NODE_ENV = originalNodeEnv;
});

function app() {
  const result = express();
  result.post('/arm', ef45OneShotDiagnosticArm);
  result.get('/read', ef45OneShotDiagnosticReader);
  result.post('/terminal', ef45OneShotDiagnosticFrontendTerminal);
  return result;
}

describe('EF-45 one-shot in-process diagnostic', () => {
  it('arms only in DEV and returns an opaque marker in a header, not a body', async () => {
    process.env.NODE_ENV = 'development';
    const response = await request(app()).post('/arm').expect(204);
    const marker = response.header['x-ef45-one-shot-marker'];
    expect(marker).toMatch(/^[a-f0-9]{64}$/);
    expect(response.text).toBe('');
    expect(knownEf45OneShotDiagnosticMarker(marker)).toBe(marker);
  });

  it('returns exactly one terminal category and atomically deletes it', async () => {
    process.env.NODE_ENV = 'development';
    const marker = (await request(app()).post('/arm')).header['x-ef45-one-shot-marker'];
    recordEf45OneShotDiagnosticCategory(marker, 'provider_failed');
    const first = await request(app()).get('/read').set(EF45_ONE_SHOT_DIAGNOSTIC_HEADER, marker).expect(200);
    expect(first.body).toEqual({ category: 'provider_failed' });
    expect(await request(app()).get('/read').set(EF45_ONE_SHOT_DIAGNOSTIC_HEADER, marker).expect(404)).toBeDefined();
  });

  it('keeps the first terminal category and never exposes marker or ancillary fields', async () => {
    process.env.NODE_ENV = 'development';
    const marker = (await request(app()).post('/arm')).header['x-ef45-one-shot-marker'];
    recordEf45OneShotDiagnosticCategory(marker, 'sse_completion_failed');
    recordEf45OneShotDiagnosticCategory(marker, 'frontend_terminal_failed');
    expect(readEf45OneShotDiagnosticCategory(marker)).toBe('sse_completion_failed');
  });

  it('expires an unread marker using the fixed TTL', () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'development';
    const marker = createEf45OneShotDiagnosticMarker();
    expect(marker).not.toBeNull();
    jest.advanceTimersByTime(60_000);
    expect(readEf45OneShotDiagnosticCategory(marker)).toBeNull();
    jest.useRealTimers();
  });

  it('rejects malformed, unknown, query-bearing, non-DEV, and body-bearing requests', async () => {
    process.env.NODE_ENV = 'development';
    await request(app()).get('/read').set(EF45_ONE_SHOT_DIAGNOSTIC_HEADER, 'bad').expect(404);
    await request(app()).post('/arm?unexpected=1').expect(404);
    const marker = (await request(app()).post('/arm')).header['x-ef45-one-shot-marker'];
    await request(app()).post('/terminal').set(EF45_ONE_SHOT_DIAGNOSTIC_HEADER, marker).send({ not: 'allowed' }).expect(404);
    process.env.NODE_ENV = 'production';
    await request(app()).post('/arm').expect(404);
  });

  it('uses a closed failure-only vocabulary and introduces no persistence or provider execution', () => {
    expect(EF45_ONE_SHOT_DIAGNOSTIC_CATEGORIES).toEqual([
      'identity_or_session_failed',
      'provider_failed',
      'sse_completion_failed',
      'frontend_terminal_failed',
    ]);
    const source = readFileSync(
      new URL('../observability/ef45OneShotDiagnostic.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/node:fs|readFile|writeFile|console\.|fetch\(|callDashScope|database|localStorage|AsyncStorage/);
  });
});
