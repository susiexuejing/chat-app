import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  authenticateAnonymousRequest,
  createOpaqueToken,
  EF75_SESSION_TTL_MS,
  EF75_WEB_COOKIE_NAME,
  EF75_WEB_ORIGIN,
  hashAnonymousSecret,
  serializeWebSessionCookie,
} from '../security/anonymousSession';
import { getSupabaseClient } from '../storage/database/supabase-client';
import { writeEf118RuntimeAudit } from '../observability/ef118RuntimeAudit';

const router = Router();
const TTL_SECONDS = EF75_SESSION_TTL_MS / 1000;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function safeInternal(res: Response) {
  writeEf118RuntimeAudit({
    dbSessionCategory: 'conversation_storage_error',
    frontendErrorMappingCategory: 'safe_connection_retry',
  });
  return res.status(500).json({ error: 'internal_server_error' });
}

async function createSession(transport: 'native' | 'web') {
  const credentialValue = createOpaqueToken();
  const csrfToken = transport === 'web' ? createOpaqueToken() : null;
  const now = Date.now();
  const expiresAt = now + EF75_SESSION_TTL_MS;
  const client = getSupabaseClient();
  const { error } = await client.from('anonymous_sessions').insert({
    id: crypto.randomUUID(),
    credential_hash: hashAnonymousSecret(credentialValue),
    transport,
    csrf_hash: csrfToken ? hashAnonymousSecret(csrfToken) : null,
    created_at: now,
    expires_at: expiresAt,
    revoked_at: null,
  });
  if (error) throw new Error('anonymous_session_storage_failed');
  return { credential: credentialValue, csrfToken, expiresAt };
}

function webRequestIsAllowed(req: Request): boolean {
  return req.get('origin') === EF75_WEB_ORIGIN
    && Boolean(req.is('application/json'))
    && req.get('x-ef-client') === 'web';
}

function targetCookieValues(req: Request): string[] {
  const header = req.get('cookie');
  if (!header) return [];
  return header.split(';').flatMap(part => {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    return separator >= 0 && trimmed.slice(0, separator) === EF75_WEB_COOKIE_NAME
      ? [trimmed.slice(separator + 1)]
      : [];
  });
}

router.post('/native', async (req, res) => {
  if (req.get('origin') !== undefined
    || req.get('sec-fetch-site') !== undefined
    || req.get('authorization') !== undefined
    || targetCookieValues(req).length > 0) {
    return res.status(403).json({ error: 'request_not_allowed' });
  }
  try {
    const created = await createSession('native');
    writeEf118RuntimeAudit({ dbSessionCategory: 'session_created' });
    return res.status(201).json({ credential: created.credential, expiresAt: created.expiresAt });
  } catch {
    return safeInternal(res);
  }
});

router.post('/web', async (req, res) => {
  if (!webRequestIsAllowed(req)) {
    return res.status(403).json({ error: 'request_not_allowed' });
  }
  try {
    if (req.get('authorization') !== undefined) {
      return res.status(401).json({ error: 'anonymous_session_invalid' });
    }
    const cookies = targetCookieValues(req);
    if (cookies.length > 1 || (cookies.length === 1 && !OPAQUE_TOKEN_PATTERN.test(cookies[0]))) {
      return res.status(401).json({ error: 'anonymous_session_invalid' });
    }
    const existing = await authenticateAnonymousRequest(req);
    if (existing.ok && existing.session.transport === 'web') {
      const csrfToken = createOpaqueToken();
      const client = getSupabaseClient();
      const { error } = await client
        .from('anonymous_sessions')
        .update({ csrf_hash: hashAnonymousSecret(csrfToken) })
        .eq('id', existing.session.id)
        .eq('transport', 'web');
      if (error) throw new Error('anonymous_csrf_storage_failed');
      return res.status(200).json({ csrfToken, expiresAt: existing.session.expiresAt });
    }
    if (!existing.ok && existing.kind === 'internal') return safeInternal(res);
    if (!existing.ok && existing.kind === 'request_not_allowed') {
      return res.status(403).json({ error: 'request_not_allowed' });
    }

    const created = await createSession('web');
    res.setHeader('Set-Cookie', serializeWebSessionCookie(created.credential, TTL_SECONDS));
    writeEf118RuntimeAudit({ dbSessionCategory: 'session_created' });
    return res.status(201).json({ csrfToken: created.csrfToken, expiresAt: created.expiresAt });
  } catch {
    return safeInternal(res);
  }
});

router.post('/revoke', async (req, res) => {
  const authenticated = await authenticateAnonymousRequest(req, { requireCsrf: true });
  if (!authenticated.ok) {
    const status = authenticated.kind === 'request_not_allowed' ? 403
      : authenticated.kind === 'internal' ? 500 : 401;
    const error = status === 403 ? 'request_not_allowed'
      : status === 500 ? 'internal_server_error' : 'anonymous_session_invalid';
    return res.status(status).json({ error });
  }
  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('anonymous_sessions')
      .update({ revoked_at: Date.now() })
      .eq('id', authenticated.session.id);
    if (error) throw new Error('anonymous_session_revoke_failed');
    if (authenticated.session.transport === 'web') {
      res.setHeader('Set-Cookie', `${EF75_WEB_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
    }
    return res.status(204).end();
  } catch {
    return safeInternal(res);
  }
});

export default router;
