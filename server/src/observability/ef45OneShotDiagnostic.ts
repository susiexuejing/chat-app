import crypto from 'node:crypto';
import type { Request, Response } from 'express';

export const EF45_ONE_SHOT_DIAGNOSTIC_HEADER = 'x-ef45-one-shot-marker';
export const EF45_ONE_SHOT_DIAGNOSTIC_RESPONSE_HEADER = 'X-EF45-One-Shot-Marker';
export const EF45_ONE_SHOT_DIAGNOSTIC_TTL_MS = 60_000;

export const EF45_ONE_SHOT_DIAGNOSTIC_CATEGORIES = [
  'identity_or_session_failed',
  'provider_failed',
  'sse_completion_failed',
  'frontend_terminal_failed',
] as const;

export type Ef45OneShotDiagnosticCategory =
  (typeof EF45_ONE_SHOT_DIAGNOSTIC_CATEGORIES)[number];

type OneShotEntry = { category: Ef45OneShotDiagnosticCategory | null; timer: ReturnType<typeof setTimeout> };

// This is deliberately the whole diagnostic state: an opaque marker and its
// single terminal category. The timer is only a process-local cleanup handle.
const entries = new Map<string, OneShotEntry>();
const sessionMarkers = new WeakMap<object, string>();

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isEf45OneShotDiagnosticMarker(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deleteMarker(marker: string): void {
  const entry = entries.get(marker);
  if (!entry) return;
  clearTimeout(entry.timer);
  entries.delete(marker);
}

export function createEf45OneShotDiagnosticMarker(): string | null {
  if (!isDevelopment()) return null;
  const marker = crypto.randomBytes(32).toString('hex');
  const timer = setTimeout(() => deleteMarker(marker), EF45_ONE_SHOT_DIAGNOSTIC_TTL_MS);
  entries.set(marker, { category: null, timer });
  return marker;
}

export function knownEf45OneShotDiagnosticMarker(value: unknown): string | null {
  if (!isDevelopment() || !isEf45OneShotDiagnosticMarker(value) || !entries.has(value)) return null;
  return value;
}

export function bindEf45OneShotDiagnosticMarker(session: object, marker: string | null): void {
  if (!marker) return;
  sessionMarkers.set(session, marker);
}

export function markerForEf45OneShotDiagnosticSession(session: object): string | null {
  const marker = sessionMarkers.get(session);
  return knownEf45OneShotDiagnosticMarker(marker);
}

export function recordEf45OneShotDiagnosticCategory(
  marker: string | null,
  category: Ef45OneShotDiagnosticCategory,
): void {
  if (!marker) return;
  const entry = entries.get(marker);
  // A terminal result is immutable. This also prevents a later client callback
  // from overwriting a server-observed failure category.
  if (entry && entry.category === null) entry.category = category;
}

export function readEf45OneShotDiagnosticCategory(marker: unknown): Ef45OneShotDiagnosticCategory | null {
  const known = knownEf45OneShotDiagnosticMarker(marker);
  if (!known) return null;
  const entry = entries.get(known);
  if (!entry || entry.category === null) return null;
  const category = entry.category;
  deleteMarker(known);
  return category;
}

export function ef45OneShotDiagnosticArm(req: Request, res: Response): void {
  if (!isDevelopment() || Object.keys(req.query).length > 0 || req.get(EF45_ONE_SHOT_DIAGNOSTIC_HEADER)) {
    res.status(404).end();
    return;
  }
  const marker = createEf45OneShotDiagnosticMarker();
  if (!marker) {
    res.status(404).end();
    return;
  }
  res.setHeader(EF45_ONE_SHOT_DIAGNOSTIC_RESPONSE_HEADER, marker);
  res.status(204).end();
}

export function ef45OneShotDiagnosticReader(req: Request, res: Response): void {
  if (!isDevelopment() || Object.keys(req.query).length > 0) {
    res.status(404).end();
    return;
  }
  const category = readEf45OneShotDiagnosticCategory(req.get(EF45_ONE_SHOT_DIAGNOSTIC_HEADER));
  if (!category) {
    res.status(404).end();
    return;
  }
  res.status(200).json({ category });
}

export function ef45OneShotDiagnosticFrontendTerminal(req: Request, res: Response): void {
  const contentLength = req.get('content-length');
  if (!isDevelopment() || Object.keys(req.query).length > 0 || (contentLength && contentLength !== '0')) {
    res.status(404).end();
    return;
  }
  const marker = knownEf45OneShotDiagnosticMarker(req.get(EF45_ONE_SHOT_DIAGNOSTIC_HEADER));
  if (!marker) {
    res.status(404).end();
    return;
  }
  recordEf45OneShotDiagnosticCategory(marker, 'frontend_terminal_failed');
  res.status(204).end();
}

// Test-only reset. It is not registered as an HTTP capability.
export function resetEf45OneShotDiagnosticForTest(): void {
  for (const marker of entries.keys()) deleteMarker(marker);
}
