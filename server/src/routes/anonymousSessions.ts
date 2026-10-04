import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  authenticateAnonymousRequest,
  clearWebGuestCookies,
  createOpaqueToken,
  currentWebGuest,
  EF75_SESSION_TTL_MS,
  EF75_WEB_ORIGIN,
  serializeWebCsrfCookie,
  serializeWebSessionCookie,
} from '../security/anonymousSession';
import { writeEf118RuntimeAudit } from '../observability/ef118RuntimeAudit';

const router = Router();
const TTL_SECONDS = EF75_SESSION_TTL_MS / 1000;

function safeInternal(res: Response) {
  writeEf118RuntimeAudit({
    dbSessionCategory: 'conversation_storage_error',
    frontendErrorMappingCategory: 'safe_connection_retry',
  });
  return res.status(500).json({ error: 'internal_server_error' });
}

function createWebSession(guestId = crypto.randomUUID()) {
  const csrfToken = createOpaqueToken();
  const now = Date.now();
  const expiresAt = now + EF75_SESSION_TTL_MS;
  return { guestId, csrfToken, expiresAt };
}

function webRequestIsAllowed(req: Request): boolean {
  return req.get('origin') === EF75_WEB_ORIGIN
    && Boolean(req.is('application/json'))
    && req.get('x-ef-client') === 'web';
}

router.post('/native', async (req, res) => {
  void req;
  return res.status(501).json({ error: 'native_guest_session_not_available' });
});

router.post('/web', async (req, res) => {
  if (!webRequestIsAllowed(req)) {
    return res.status(403).json({ error: 'request_not_allowed' });
  }
  try {
    if (req.get('authorization') !== undefined) {
      return res.status(401).json({ error: 'anonymous_session_invalid' });
    }
    const created = createWebSession(currentWebGuest(req) ?? undefined);
    res.setHeader('Set-Cookie', [
      serializeWebSessionCookie(created.guestId, TTL_SECONDS),
      serializeWebCsrfCookie(created.csrfToken, TTL_SECONDS),
    ]);
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
    res.setHeader('Set-Cookie', clearWebGuestCookies());
    return res.status(204).end();
  } catch {
    return safeInternal(res);
  }
});

export default router;
