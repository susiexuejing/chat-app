import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client';
import { verifyExactOwnerBinding } from '../storage/database/rds-owner-binding-store';
import { writeEf118RuntimeAudit } from '../observability/ef118RuntimeAudit';

export const EF75_WEB_ORIGIN = 'https://dev.douhaoyu.cn';
export const EF75_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EF75_WEB_COOKIE_NAME = '__Host-ef_anon';

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type AnonymousTransport = 'native' | 'web';

export interface VerifiedAnonymousSession {
  id: string;
  transport: AnonymousTransport;
  expiresAt: number;
  csrfHash: string | null;
}

type AuthenticationResult =
  | { ok: true; session: VerifiedAnonymousSession }
  | { ok: false; kind: 'invalid' | 'request_not_allowed' | 'internal' };

interface AnonymousSessionRow {
  id: string;
  credential_hash: string;
  transport: string;
  csrf_hash: string | null;
  expires_at: number;
  revoked_at: number | null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashAnonymousSecret(value: string): string {
  return sha256(value);
}

function exactBearer(req: Request): string | null {
  const authorization = req.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

function exactCookie(req: Request): { credential: string | null; malformed: boolean } {
  const header = req.get('cookie');
  if (!header) return { credential: null, malformed: false };
  const matches: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    if (trimmed.slice(0, separator) === EF75_WEB_COOKIE_NAME) {
      matches.push(trimmed.slice(separator + 1));
    }
  }
  if (matches.length !== 1 || !OPAQUE_TOKEN_PATTERN.test(matches[0])) {
    return { credential: null, malformed: matches.length > 0 };
  }
  return { credential: matches[0], malformed: false };
}

function hasExactWebOrigin(req: Request): boolean {
  return req.get('origin') === EF75_WEB_ORIGIN;
}

function safeEqualHash(actual: string | null, expected: string): boolean {
  if (!actual || !HASH_PATTERN.test(actual) || !HASH_PATTERN.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

async function lookupSession(
  credentialValue: string,
  transport: AnonymousTransport,
): Promise<AuthenticationResult> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('anonymous_sessions')
      .select('id, credential_hash, transport, csrf_hash, expires_at, revoked_at')
      .eq('credential_hash', sha256(credentialValue))
      .eq('transport', transport)
      .maybeSingle();
    if (error) return { ok: false, kind: 'internal' };
    const row = data as AnonymousSessionRow | null;
    if (!row
      || row.transport !== transport
      || row.revoked_at !== null
      || !Number.isFinite(row.expires_at)
      || row.expires_at <= Date.now()) {
      return { ok: false, kind: 'invalid' };
    }
    return {
      ok: true,
      session: {
        id: row.id,
        transport,
        expiresAt: row.expires_at,
        csrfHash: row.csrf_hash,
      },
    };
  } catch {
    return { ok: false, kind: 'internal' };
  }
}

export async function authenticateAnonymousRequest(
  req: Request,
  options: { requireCsrf?: boolean } = {},
): Promise<AuthenticationResult> {
  const bearerHeaderPresent = req.get('authorization') !== undefined;
  const bearer = exactBearer(req);
  const cookie = exactCookie(req);

  if (bearerHeaderPresent && !bearer) return { ok: false, kind: 'invalid' };
  if (cookie.malformed || (bearer && cookie.credential)) return { ok: false, kind: 'invalid' };

  if (cookie.credential) {
    const origin = req.get('origin');
    if (options.requireCsrf) {
      if (!hasExactWebOrigin(req)) return { ok: false, kind: 'request_not_allowed' };
    } else if (origin !== undefined && origin !== EF75_WEB_ORIGIN) {
      return { ok: false, kind: 'request_not_allowed' };
    }
    const result = await lookupSession(cookie.credential, 'web');
    if (!result.ok || !options.requireCsrf) return result;
    if (!req.is('application/json')) return { ok: false, kind: 'request_not_allowed' };
    const csrf = req.get('x-ef-csrf');
    if (!csrf || !OPAQUE_TOKEN_PATTERN.test(csrf)
      || !safeEqualHash(result.session.csrfHash, sha256(csrf))) {
      return { ok: false, kind: 'request_not_allowed' };
    }
    return result;
  }

  if (bearer) {
    if (req.get('origin') !== undefined || req.get('sec-fetch-site') !== undefined) {
      return { ok: false, kind: 'request_not_allowed' };
    }
    return lookupSession(bearer, 'native');
  }

  return { ok: false, kind: 'invalid' };
}

export function sendAnonymousFailure(
  res: Response,
  kind: 'invalid' | 'request_not_allowed' | 'internal',
): Response {
  if (kind === 'request_not_allowed') {
    writeEf118RuntimeAudit({ dbSessionCategory: 'request_invalid' });
    return res.status(403).json({ error: 'request_not_allowed' });
  }
  if (kind === 'internal') {
    writeEf118RuntimeAudit({
      dbSessionCategory: 'conversation_lookup_error',
      frontendErrorMappingCategory: 'safe_connection_retry',
    });
    return res.status(500).json({ error: 'internal_server_error' });
  }
  writeEf118RuntimeAudit({ dbSessionCategory: 'session_missing' });
  return res.status(401).json({ error: 'anonymous_session_invalid' });
}

export async function requireAnonymousSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const result = await authenticateAnonymousRequest(req, {
    requireCsrf: !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  });
  if (!result.ok) {
    sendAnonymousFailure(res, result.kind);
    return;
  }
  res.locals.anonymousSession = result.session;
  next();
}

export function getVerifiedAnonymousSession(res: Response): VerifiedAnonymousSession {
  return res.locals.anonymousSession as VerifiedAnonymousSession;
}

export async function verifyOwnedConversation(
  ownerSessionId: string,
  conversationId: string,
): Promise<'owned' | 'missing' | 'internal'> {
  return verifyExactOwnerBinding(conversationId, ownerSessionId);
}

export function serializeWebSessionCookie(credentialValue: string, maxAgeSeconds: number): string {
  return `${EF75_WEB_COOKIE_NAME}=${credentialValue}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Strict`;
}
