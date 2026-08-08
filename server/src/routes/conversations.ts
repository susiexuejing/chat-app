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
import { conversations, messages } from '../storage/database/shared/schema.js';
import { eq, and, lt, desc, asc } from 'drizzle-orm';
import crypto from 'node:crypto';

const router = Router();

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

    if (error) throw new Error(`Create conversation failed: ${error.message}`);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/v1/conversations/:id - Get conversation + messages
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const client = getSupabaseClient();

    // Get conversation
    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id, user_id, role_id, state, created_at, updated_at, last_message_at')
      .eq('id', id)
      .maybeSingle();

    if (convError) throw new Error(`Get conversation failed: ${convError.message}`);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get messages
    const { data: messageRows, error: msgError } = await client
      .from('messages')
      .select('id, conversation_id, role, content, status, request_id, timestamp')
      .eq('conversation_id', id)
      .order('timestamp', { ascending: true });

    if (msgError) throw new Error(`Get messages failed: ${msgError.message}`);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/v1/conversations/:id/messages - Persist message
router.post('/:id/messages', async (req, res) => {
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

    if (convError) throw new Error(`Verify conversation failed: ${convError.message}`);
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

      if (dupError) throw new Error(`Idempotency check failed: ${dupError.message}`);
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

    if (msgError) throw new Error(`Insert message failed: ${msgError.message}`);

    // Update conversation last_message_at and updated_at
    const { error: updateError } = await client
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', id);

    if (updateError) throw new Error(`Update conversation failed: ${updateError.message}`);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/v1/conversations/:id/messages - Get messages (paginated)
router.get('/:id/messages', async (req, res) => {
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

    if (convError) throw new Error(`Verify conversation failed: ${convError.message}`);
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

    if (msgError) throw new Error(`Get messages failed: ${msgError.message}`);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
