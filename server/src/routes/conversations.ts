/**
 * EF-59 Phase 2: Conversation API
 * 
 * Endpoints:
 * - POST /api/v1/conversations              → Create conversation
 * - GET  /api/v1/conversations/:id          → Get conversation + messages
 * - POST /api/v1/conversations/:id/messages → Persist message
 * - GET  /api/v1/conversations/:id/messages → Get messages (paginated)
 */

import { Router } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client';
import crypto from 'node:crypto';
import { writeEf118RuntimeAudit } from '../observability/ef118RuntimeAudit';
import { readBackendIdentity } from '../auth/backendIdentity';

const router = Router();

type ConversationFailureCode =
  | 'conversation_storage_error'
  | 'conversation_lookup_error'
  | 'messages_query_error'
  | 'conversation_verify_error'
  | 'idempotency_guard_error'
  | 'message_insert_error'
  | 'conversation_update_error';

function writeSafeInternalError(
  res: { status: (status: number) => { json: (body: unknown) => unknown } },
  code: ConversationFailureCode,
): unknown {
  writeEf118RuntimeAudit({
    dbSessionCategory: code,
    frontendErrorMappingCategory: 'safe_connection_retry',
  });
  return res.status(500).json({
    error: 'internal_server_error',
    code,
    retryable: true,
  });
}

function rejectIdentity(res: { status: (status: number) => { json: (body: unknown) => unknown } }): unknown {
  writeEf118RuntimeAudit({ dbSessionCategory: 'request_invalid' });
  return res.status(401).json({ error: 'invalid_identity_context' });
}

// Types
interface Conversation {
  id: string;
  user_id: string;
  role_id: string;
  state: string;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
}

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  request_id: string | null;
  timestamp: number;
}

// POST /api/v1/conversations - Create conversation
router.post('/', async (req, res) => {
  let failureCode: ConversationFailureCode = 'conversation_storage_error';
  try {
    const { userId, roleId } = req.body;

    const identityResult = readBackendIdentity(req, { bodyUserId: userId });
    if ('failure' in identityResult) return rejectIdentity(res);

    if (!userId || !roleId) {
      writeEf118RuntimeAudit({ dbSessionCategory: 'request_invalid' });
      return res.status(400).json({ error: 'Missing userId or roleId' });
    }

    const client = getSupabaseClient();
    const now = Date.now();
    const id = crypto.randomUUID();

    const { data, error } = await client
      .from('conversations')
      .insert({
        id,
        user_id: identityResult.identity.userId,
        role_id: roleId,
        state: 'active',
        created_at: now,
        updated_at: now,
        last_message_at: null,
      })
      .select()
      .single();

    if (error) {
      failureCode = 'conversation_storage_error';
      throw error;
    }

    writeEf118RuntimeAudit({
      dbSessionCategory: 'conversation_created',
      frontendErrorMappingCategory: 'none',
    });
    res.status(201).json({
      id: data.id,
      userId: data.user_id,
      roleId: data.role_id,
      state: data.state,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastMessageAt: data.last_message_at,
    });
  } catch (err) {
    void err;
    writeSafeInternalError(res, failureCode);
  }
});

// GET /api/v1/conversations/:id - Get conversation + messages
router.get('/:id', async (req, res) => {
  let failureCode: ConversationFailureCode = 'conversation_lookup_error';
  try {
    const { id } = req.params;
    const identityResult = readBackendIdentity(req);
    if ('failure' in identityResult) return rejectIdentity(res);
    const client = getSupabaseClient();

    // Get conversation
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id, user_id, role_id, state, created_at, updated_at, last_message_at')
      .eq('id', id)
      .eq('user_id', identityResult.identity.userId)
      .maybeSingle();

    if (convError) {
      failureCode = 'conversation_lookup_error';
      throw convError;
    }
    if (!conversation) {
      writeEf118RuntimeAudit({ dbSessionCategory: 'conversation_not_found' });
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get messages
    const { data: messageRows, error: msgError } = await client
      .from('messages')
      .select('id, conversation_id, role, content, status, request_id, timestamp')
      .eq('conversation_id', id)
      .order('timestamp', { ascending: true });

    if (msgError) {
      failureCode = 'messages_query_error';
      throw msgError;
    }

    writeEf118RuntimeAudit({ dbSessionCategory: 'conversation_loaded' });
    res.json({
      conversation: {
        id: conversation.id,
        userId: conversation.user_id,
        roleId: conversation.role_id,
        state: conversation.state,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        lastMessageAt: conversation.last_message_at,
      },
      messages: (messageRows || []).map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        role: m.role,
        content: m.content,
        status: m.status,
        requestId: m.request_id,
        timestamp: m.timestamp,
      })),
    });
  } catch (err) {
    void err;
    writeSafeInternalError(res, failureCode);
  }
});

// POST /api/v1/conversations/:id/messages - Persist message
router.post('/:id/messages', async (req, res) => {
  let failureCode: ConversationFailureCode = 'conversation_verify_error';
  try {
    const { id } = req.params;
    const { role, content, status, requestId } = req.body;
    const identityResult = readBackendIdentity(req);
    if ('failure' in identityResult) return rejectIdentity(res);

    if (!role || content === undefined) {
      writeEf118RuntimeAudit({ dbSessionCategory: 'request_invalid' });
      return res.status(400).json({ error: 'Missing role or content' });
    }

    const client = getSupabaseClient();

    // Verify conversation exists
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', identityResult.identity.userId)
      .maybeSingle();

    if (convError) {
      failureCode = 'conversation_verify_error';
      throw convError;
    }
    if (!conversation) {
      writeEf118RuntimeAudit({ dbSessionCategory: 'conversation_not_found' });
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Idempotency check
    if (requestId) {
      const { data: existing, error: dupError } = await client
        .from('messages')
        .select('id, conversation_id, role, content, status, request_id, timestamp')
        .eq('request_id', requestId)
        .eq('conversation_id', id)
        .maybeSingle();

      if (dupError) {
        failureCode = 'idempotency_guard_error';
        throw dupError;
      }
      if (existing) {
        writeEf118RuntimeAudit({ dbSessionCategory: 'idempotent_replay' });
        // Return existing message (idempotent)
        return res.status(200).json({
          id: existing.id,
          conversationId: existing.conversation_id,
          role: existing.role,
          content: existing.content,
          status: existing.status,
          requestId: existing.request_id,
          timestamp: existing.timestamp,
        });
      }
    }

    const now = Date.now();
    const msgId = crypto.randomUUID();

    // Insert message
    const { data: message, error: msgError } = await client
      .from('messages')
      .insert({
        id: msgId,
        conversation_id: id,
        role,
        content,
        status: status || 'sent',
        request_id: requestId || null,
        timestamp: now,
      })
      .select()
      .single();

    if (msgError) {
      failureCode = 'message_insert_error';
      throw msgError;
    }

    // Update conversation last_message_at and updated_at
    const { error: updateError } = await client
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', id);

    if (updateError) {
      failureCode = 'conversation_update_error';
      throw updateError;
    }

    writeEf118RuntimeAudit({ dbSessionCategory: 'message_persisted' });
    res.status(201).json({
      id: message.id,
      conversationId: message.conversation_id,
      role: message.role,
      content: message.content,
      status: message.status,
      requestId: message.request_id,
      timestamp: message.timestamp,
    });
  } catch (err) {
    void err;
    writeSafeInternalError(res, failureCode);
  }
});

// GET /api/v1/conversations/:id/messages - Get messages (paginated)
router.get('/:id/messages', async (req, res) => {
  let failureCode: ConversationFailureCode = 'conversation_verify_error';
  try {
    const { id } = req.params;
    const identityResult = readBackendIdentity(req);
    if ('failure' in identityResult) return rejectIdentity(res);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const before = req.query.before ? parseInt(req.query.before as string) : undefined;

    const client = getSupabaseClient();

    // Verify conversation exists
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', identityResult.identity.userId)
      .maybeSingle();

    if (convError) {
      failureCode = 'conversation_verify_error';
      throw convError;
    }
    if (!conversation) {
      writeEf118RuntimeAudit({ dbSessionCategory: 'conversation_not_found' });
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Build query
    let query = client
      .from('messages')
      .select('id, conversation_id, role, content, status, request_id, timestamp')
      .eq('conversation_id', id);

    if (before) {
      query = query.lt('timestamp', before);
    }

    // Fetch limit + 1 to determine hasMore
    const { data: messageRows, error: msgError } = await query
      .order('timestamp', { ascending: false })
      .limit(limit + 1);

    if (msgError) {
      failureCode = 'messages_query_error';
      throw msgError;
    }

    const hasMore = (messageRows?.length || 0) > limit;
    const rows = (messageRows || []).slice(0, limit);

    // Reverse to ascending order
    rows.reverse();

    writeEf118RuntimeAudit({ dbSessionCategory: 'messages_loaded' });
    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        role: m.role,
        content: m.content,
        status: m.status,
        requestId: m.request_id,
        timestamp: m.timestamp,
      })),
      hasMore,
    });
  } catch (err) {
    void err;
    writeSafeInternalError(res, failureCode);
  }
});

export default router;
