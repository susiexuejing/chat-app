import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client';
import { writeEf118RuntimeAudit } from '../observability/ef118RuntimeAudit';

export const EF75_WEB_ORIGIN = 'https://dev.douhaoyu.cn';
export const EF75_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EF75_WEB_COOKIE_NAME = '__Host-ef_guest';
export const EF75_WEB_CSRF_COOKIE_NAME = '__Host-ef_csrf';
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VerifiedAnonymousSession { id: string; transport: 'web'; expiresAt: number; csrfHash: string | null; }
type AuthenticationResult = { ok: true; session: VerifiedAnonymousSession } | { ok: false; kind: 'invalid' | 'request_not_allowed' | 'internal' };

export function createOpaqueToken(): string { return crypto.randomBytes(32).toString('base64url'); }
export function hashAnonymousSecret(value: string): string { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

function cookieValues(req: Request, name: string): string[] {
  const header = req.get('cookie'); if (!header) return [];
  return header.split(';').flatMap((part) => { const item = part.trim(); const at = item.indexOf('='); return at >= 0 && item.slice(0, at) === name ? [item.slice(at + 1)] : []; });
}
function oneCookie(req: Request, name: string, pattern: RegExp): string | null { const values = cookieValues(req, name); return values.length === 1 && pattern.test(values[0]) ? values[0] : null; }
function sameValue(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function hasExactWebOrigin(req: Request): boolean { return req.get('origin') === EF75_WEB_ORIGIN; }

function guestFromRequest(req: Request, requireCsrf: boolean): AuthenticationResult {
  const guest = oneCookie(req, EF75_WEB_COOKIE_NAME, UUID_PATTERN);
  if (!guest) return { ok: false, kind: 'invalid' };
  const origin = req.get('origin');
  if ((requireCsrf && !hasExactWebOrigin(req)) || (!requireCsrf && origin !== undefined && !hasExactWebOrigin(req))) return { ok: false, kind: 'request_not_allowed' };
  if (requireCsrf) {
    if (!req.is('application/json')) return { ok: false, kind: 'request_not_allowed' };
    const csrfCookie = oneCookie(req, EF75_WEB_CSRF_COOKIE_NAME, OPAQUE_TOKEN_PATTERN); const csrfHeader = req.get('x-ef-csrf');
    if (!csrfCookie || !csrfHeader || !OPAQUE_TOKEN_PATTERN.test(csrfHeader) || !sameValue(csrfCookie, csrfHeader)) return { ok: false, kind: 'request_not_allowed' };
  }
  return { ok: true, session: { id: guest, transport: 'web', expiresAt: Date.now() + EF75_SESSION_TTL_MS, csrfHash: null } };
}

export async function authenticateAnonymousRequest(req: Request, options: { requireCsrf?: boolean } = {}): Promise<AuthenticationResult> {
  if (req.get('authorization') !== undefined) return { ok: false, kind: 'invalid' };
  return guestFromRequest(req, Boolean(options.requireCsrf));
}
export function sendAnonymousFailure(res: Response, kind: 'invalid' | 'request_not_allowed' | 'internal'): Response {
  if (kind === 'request_not_allowed') { writeEf118RuntimeAudit({ dbSessionCategory: 'request_invalid' }); return res.status(403).json({ error: 'request_not_allowed' }); }
  if (kind === 'internal') { writeEf118RuntimeAudit({ dbSessionCategory: 'conversation_lookup_error', frontendErrorMappingCategory: 'safe_connection_retry' }); return res.status(500).json({ error: 'internal_server_error' }); }
  writeEf118RuntimeAudit({ dbSessionCategory: 'session_missing' }); return res.status(401).json({ error: 'anonymous_session_invalid' });
}
export async function requireAnonymousSession(req: Request, res: Response, next: NextFunction): Promise<void> { const result = await authenticateAnonymousRequest(req, { requireCsrf: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) }); if (!result.ok) { sendAnonymousFailure(res, result.kind); return; } res.locals.anonymousSession = result.session; next(); }
export function getVerifiedAnonymousSession(res: Response): VerifiedAnonymousSession { return res.locals.anonymousSession as VerifiedAnonymousSession; }
export async function verifyOwnedConversation(ownerSessionId: string, conversationId: string): Promise<'owned' | 'missing' | 'internal'> { try { const { data, error } = await getSupabaseClient().from('conversations').select('id').eq('id', conversationId).eq('user_id', ownerSessionId).maybeSingle(); return error ? 'internal' : data ? 'owned' : 'missing'; } catch { return 'internal'; } }
export function serializeWebSessionCookie(guestId: string, maxAgeSeconds: number): string { return `${EF75_WEB_COOKIE_NAME}=${guestId}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Strict`; }
export function serializeWebCsrfCookie(csrf: string, maxAgeSeconds: number): string { return `${EF75_WEB_CSRF_COOKIE_NAME}=${csrf}; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=Strict`; }
export function clearWebGuestCookies(): string[] { return [`${EF75_WEB_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`, `${EF75_WEB_CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; SameSite=Strict`]; }
export function currentWebGuest(req: Request): string | null { return oneCookie(req, EF75_WEB_COOKIE_NAME, UUID_PATTERN); }
