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
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import crypto from 'node:crypto';

const router = Router();

type ConversationServerErrorCode =
  | 'conversation_storage_error'
  | 'conversation_lookup_error'
  | 'messages_query_error'
  | 'conversation_verify_error'
  | 'idempotency_guard_error'
  | 'message_insert_error'
  | 'conversation_update_error'
  | 'internal_server_error';

const conversationServerErrorCodes = new Set<ConversationServerErrorCode>([
  'conversation_storage_error',
  'conversation_lookup_error',
  'messages_query_error',
  'conversation_verify_error',
  'idempotency_guard_error',
  'message_insert_error',
  'conversation_update_error',
  'internal_server_error',
]);

const routeSafeErrorCode: Record<string, ConversationServerErrorCode> = {
  createConversation: 'conversation_storage_error',
  getConversation: 'conversation_lookup_error',
  getMessages: 'messages_query_error',
  verifyConversation: 'conversation_verify_error',
  idempotency: 'idempotency_guard_error',
  insertMessage: 'message_insert_error',
  updateConversation: 'conversation_update_error',
};

type ErrorResponse = {
  error: string;
  code: string;
  retryable: boolean;
};

function writeInternalError(
  res: { status: (code: number) => { json: (body: ErrorResponse) => void } },
  _err: unknown,
  code: ConversationServerErrorCode = 'internal_server_error',
) {
  res.status(500).json({
    error: code,
    code,
    retryable: true,
  });
}

function classifyErrorCode(err: unknown, fallback: ConversationServerErrorCode): ConversationServerErrorCode {
  if (err instanceof Error && conversationServerErrorCodes.has(err.message as ConversationServerErrorCode)) {
    return err.message as ConversationServerErrorCode;
  }
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const typedCode = (err as { code?: string }).code;
    if (typeof typedCode === 'string' && conversationServerErrorCodes.has(typedCode as ConversationServerErrorCode)) {
      return typedCode as ConversationServerErrorCode;
    }
  }
  return fallback;
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
  let failureCode = routeSafeErrorCode.createConversation;
  try {
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      return res.status(400).json({ error: 'Missing userId or roleId' });
    }

    const client = getSupabaseClient();
    const now = Date.now();
    const id = crypto.randomUUID();

    const { data, error } = await client
      .from('conversations')
      .insert({
        id,
        user_id: userId,
        role_id: roleId,
        state: 'active',
        created_at: now,
        updated_at: now,
        last_message_at: null,
      })
      .select()
      .single();

    if (error) {
      failureCode = routeSafeErrorCode.createConversation;
      throw new Error(routeSafeErrorCode.createConversation);
    }

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
    writeInternalError(res, err, classifyErrorCode(err, failureCode));
  }
});

// GET /api/v1/conversations/:id - Get conversation + messages
router.get('/:id', async (req, res) => {
  let failureCode = routeSafeErrorCode.getConversation;
  try {
    const { id } = req.params;
    const client = getSupabaseClient();

    // Get conversation
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id, user_id, role_id, state, created_at, updated_at, last_message_at')
      .eq('id', id)
      .maybeSingle();

    if (convError) {
      failureCode = routeSafeErrorCode.getConversation;
      throw new Error(routeSafeErrorCode.getConversation);
    }
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get messages
    const { data: messageRows, error: msgError } = await client
      .from('messages')
      .select('id, conversation_id, role, content, status, request_id, timestamp')
      .eq('conversation_id', id)
      .order('timestamp', { ascending: true });

    if (msgError) {
      failureCode = routeSafeErrorCode.getMessages;
      throw new Error(routeSafeErrorCode.getMessages);
    }

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
    writeInternalError(res, err, classifyErrorCode(err, failureCode));
  }
});

// POST /api/v1/conversations/:id/messages - Persist message
router.post('/:id/messages', async (req, res) => {
  let failureCode = routeSafeErrorCode.insertMessage;
  try {
    const { id } = req.params;
    const { role, content, status, requestId } = req.body;

    if (!role || content === undefined) {
      return res.status(400).json({ error: 'Missing role or content' });
    }

    const client = getSupabaseClient();

    // Verify conversation exists
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (convError) {
      failureCode = routeSafeErrorCode.verifyConversation;
      throw new Error(routeSafeErrorCode.verifyConversation);
    }
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Idempotency check
    if (requestId) {
      const { data: existing, error: dupError } = await client
        .from('messages')
        .select('id, conversation_id, role, content, status, request_id, timestamp')
        .eq('request_id', requestId)
        .maybeSingle();

      if (dupError) {
        failureCode = routeSafeErrorCode.idempotency;
        throw new Error(routeSafeErrorCode.idempotency);
      }
      if (existing) {
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
      failureCode = routeSafeErrorCode.insertMessage;
      throw new Error(routeSafeErrorCode.insertMessage);
    }

    // Update conversation last_message_at and updated_at
    const { error: updateError } = await client
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', id);

    if (updateError) {
      failureCode = routeSafeErrorCode.updateConversation;
      throw new Error(routeSafeErrorCode.updateConversation);
    }

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
    writeInternalError(res, err, classifyErrorCode(err, failureCode));
  }
});

// GET /api/v1/conversations/:id/messages - Get messages (paginated)
router.get('/:id/messages', async (req, res) => {
  let failureCode = routeSafeErrorCode.getMessages;
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const before = req.query.before ? parseInt(req.query.before as string) : undefined;

    const client = getSupabaseClient();

    // Verify conversation exists
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (convError) {
      failureCode = routeSafeErrorCode.verifyConversation;
      throw new Error(routeSafeErrorCode.verifyConversation);
    }
    if (!conversation) {
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
      failureCode = routeSafeErrorCode.getMessages;
      throw new Error(routeSafeErrorCode.getMessages);
    }

    const hasMore = (messageRows?.length || 0) > limit;
    const rows = (messageRows || []).slice(0, limit);

    // Reverse to ascending order
    rows.reverse();

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
    writeInternalError(res, err, classifyErrorCode(err, failureCode));
  }
});

export default router;
