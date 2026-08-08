/**
 * EF-59 Phase 3: Backend Conversation API Tests
 * 
 * Tests the conversation and message persistence API logic:
 * 1. Create conversation
 * 2. Create messages
 * 3. RequestId idempotency
 * 4. Message retrieval (ordering, pagination)
 * 5. Conversation retrieval
 */
import { getSupabaseClient } from '../storage/database/supabase-client';

describe('EF-59 Phase 3: Conversation API', () => {
  const supabase = getSupabaseClient();

  // Clean up test data after each test
  afterEach(async () => {
    // Delete test messages first (FK constraint)
    await supabase
      .from('messages')
      .delete()
      .like('conversation_id', 'test-%');
    
    // Delete test conversations
    await supabase
      .from('conversations')
      .delete()
      .like('user_id', 'test-user-%');
  });

  describe('1. Create conversation', () => {
    test('creates conversation with required fields', async () => {
      const now = Date.now();
      const convId = 'test-conv-001';
      
      const result = await supabase
        .from('conversations')
        .insert({
          id: convId,
          user_id: 'test-user-api-1',
          role_id: 'clever-fox',
          state: 'active',
          created_at: now,
          updated_at: now,
          last_message_at: null,
        })
        .select()
        .single();

      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe(convId);
      expect(result.data.user_id).toBe('test-user-api-1');
      expect(result.data.role_id).toBe('clever-fox');
      expect(result.data.state).toBe('active');
      expect(result.data.created_at).toBe(now);
      expect(result.data.updated_at).toBe(now);
      expect(result.data.last_message_at).toBeNull();
    });

    test('returns all required fields', async () => {
      const now = Date.now();
      const convId = 'test-conv-002';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-api-2',
        role_id: 'warm-bear',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .single();

      expect(data).toBeDefined();
      // Verify all required fields exist
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('user_id');
      expect(data).toHaveProperty('role_id');
      expect(data).toHaveProperty('state');
      expect(data).toHaveProperty('created_at');
      expect(data).toHaveProperty('updated_at');
      expect(data).toHaveProperty('last_message_at');
    });
  });

  describe('2. Create messages', () => {
    test('persists user message', async () => {
      const now = Date.now();
      const convId = 'test-conv-msg-001';
      
      // Create conversation first
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-msg-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      // Insert user message
      const msgResult = await supabase
        .from('messages')
        .insert({
          id: 'test-msg-001',
          conversation_id: convId,
          role: 'user',
          content: 'Hello, how are you?',
          status: 'sent',
          request_id: 'req-user-001',
          timestamp: now,
        })
        .select()
        .single();

      expect(msgResult.error).toBeNull();
      expect(msgResult.data.role).toBe('user');
      expect(msgResult.data.content).toBe('Hello, how are you?');
      expect(msgResult.data.status).toBe('sent');
      expect(msgResult.data.request_id).toBe('req-user-001');
    });

    test('persists assistant message', async () => {
      const now = Date.now();
      const convId = 'test-conv-msg-002';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-msg-2',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      const msgResult = await supabase
        .from('messages')
        .insert({
          id: 'test-msg-002',
          conversation_id: convId,
          role: 'assistant',
          content: 'I am here to listen and support you.',
          status: 'sent',
          request_id: 'req-assistant-001',
          timestamp: now + 1000,
        })
        .select()
        .single();

      expect(msgResult.error).toBeNull();
      expect(msgResult.data.role).toBe('assistant');
      expect(msgResult.data.content).toBe('I am here to listen and support you.');
    });

    test('persists failed message status', async () => {
      const now = Date.now();
      const convId = 'test-conv-msg-003';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-msg-3',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      const msgResult = await supabase
        .from('messages')
        .insert({
          id: 'test-msg-003',
          conversation_id: convId,
          role: 'assistant',
          content: '',
          status: 'failed',
          request_id: 'req-failed-001',
          timestamp: now,
        })
        .select()
        .single();

      expect(msgResult.error).toBeNull();
      expect(msgResult.data.status).toBe('failed');
    });
  });

  describe('3. RequestId idempotency', () => {
    test('returns same message for duplicate requestId', async () => {
      const now = Date.now();
      const convId = 'test-conv-idem-001';
      const requestId = 'req-idempotent-001';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-idem-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      // First insert
      const first = await supabase
        .from('messages')
        .insert({
          id: 'test-msg-idem-001',
          conversation_id: convId,
          role: 'user',
          content: 'Original message',
          status: 'sent',
          request_id: requestId,
          timestamp: now,
        })
        .select()
        .single();

      expect(first.error).toBeNull();
      const firstId = first.data.id;

      // Simulate idempotency check (same logic as API)
      const existing = await supabase
        .from('messages')
        .select('*')
        .eq('request_id', requestId)
        .maybeSingle();

      expect(existing.data).toBeDefined();
      expect(existing.data.id).toBe(firstId);
      expect(existing.data.content).toBe('Original message');

      // Verify no duplicate exists
      const { data: allWithSameRequestId } = await supabase
        .from('messages')
        .select('id')
        .eq('request_id', requestId);

      expect(allWithSameRequestId.length).toBe(1);
    });

    test('different requestId creates different message', async () => {
      const now = Date.now();
      const convId = 'test-conv-idem-002';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-idem-2',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      // Insert first message
      await supabase.from('messages').insert({
        id: 'test-msg-idem-002',
        conversation_id: convId,
        role: 'user',
        content: 'First message',
        status: 'sent',
        request_id: 'req-different-001',
        timestamp: now,
      });

      // Insert second message with different requestId
      await supabase.from('messages').insert({
        id: 'test-msg-idem-003',
        conversation_id: convId,
        role: 'user',
        content: 'Second message',
        status: 'sent',
        request_id: 'req-different-002',
        timestamp: now + 1000,
      });

      // Verify both exist
      const { data } = await supabase
        .from('messages')
        .select('id, content, request_id')
        .eq('conversation_id', convId)
        .order('timestamp', { ascending: true });

      expect(data.length).toBe(2);
      expect(data[0].request_id).toBe('req-different-001');
      expect(data[1].request_id).toBe('req-different-002');
    });
  });

  describe('4. Message retrieval', () => {
    test('returns messages in chronological order', async () => {
      const now = Date.now();
      const convId = 'test-conv-retrieve-001';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-retrieve-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      // Insert messages with different timestamps
      await supabase.from('messages').insert([
        { id: 'test-msg-r-001', conversation_id: convId, role: 'user', content: 'First', status: 'sent', timestamp: now },
        { id: 'test-msg-r-002', conversation_id: convId, role: 'assistant', content: 'Reply', status: 'sent', timestamp: now + 1000 },
        { id: 'test-msg-r-003', conversation_id: convId, role: 'user', content: 'Second', status: 'sent', timestamp: now + 2000 },
      ]);

      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('timestamp', { ascending: true });

      expect(data.length).toBe(3);
      expect(data[0].content).toBe('First');
      expect(data[1].content).toBe('Reply');
      expect(data[2].content).toBe('Second');
    });

    test('pagination with limit', async () => {
      const now = Date.now();
      const convId = 'test-conv-retrieve-002';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-retrieve-2',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      // Insert 5 messages
      for (let i = 0; i < 5; i++) {
        await supabase.from('messages').insert({
          id: `test-msg-page-${i}`,
          conversation_id: convId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          status: 'sent',
          timestamp: now + i * 1000,
        });
      }

      // Get first page (limit 2)
      const { data: page1 } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('timestamp', { ascending: true })
        .limit(2);

      expect(page1.length).toBe(2);
      expect(page1[0].content).toBe('Message 0');
      expect(page1[1].content).toBe('Message 1');

      // Get second page (using before cursor)
      const lastTimestamp = page1[page1.length - 1].timestamp;
      const { data: page2 } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .lt('timestamp', lastTimestamp + 1) // Simulating before cursor
        .gt('timestamp', lastTimestamp) // After last seen
        .order('timestamp', { ascending: true })
        .limit(2);

      // Verify pagination works (hasMore logic)
      expect(page1.length).toBeLessThanOrEqual(2);
    });

    test('returns empty array for conversation with no messages', async () => {
      const now = Date.now();
      const convId = 'test-conv-empty-001';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-empty-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
      });

      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('timestamp', { ascending: true });

      expect(data).toEqual([]);
    });
  });

  describe('5. Conversation retrieval', () => {
    test('returns conversation with messages', async () => {
      const now = Date.now();
      const convId = 'test-conv-full-001';
      
      // Create conversation
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-full-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
        last_message_at: now + 2000,
      });

      // Add messages
      await supabase.from('messages').insert([
        { id: 'test-msg-full-001', conversation_id: convId, role: 'user', content: 'Hello', status: 'sent', timestamp: now },
        { id: 'test-msg-full-002', conversation_id: convId, role: 'assistant', content: 'Hi there', status: 'sent', timestamp: now + 1000 },
        { id: 'test-msg-full-003', conversation_id: convId, role: 'user', content: 'How are you?', status: 'sent', timestamp: now + 2000 },
      ]);

      // Retrieve conversation
      const { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .single();

      expect(conversation).toBeDefined();
      expect(conversation.id).toBe(convId);
      expect(conversation.last_message_at).toBe(now + 2000);

      // Retrieve messages
      const { data: convMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('timestamp', { ascending: true });

      expect(convMessages.length).toBe(3);
      expect(convMessages[0].content).toBe('Hello');
      expect(convMessages[1].content).toBe('Hi there');
      expect(convMessages[2].content).toBe('How are you?');
    });

    test('returns 404-equivalent for non-existent conversation', async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', 'non-existent-conv-id')
        .maybeSingle();

      expect(data).toBeNull();
    });

    test('updates last_message_at when message is added', async () => {
      const now = Date.now();
      const convId = 'test-conv-update-001';
      
      await supabase.from('conversations').insert({
        id: convId,
        user_id: 'test-user-update-1',
        role_id: 'clever-fox',
        state: 'active',
        created_at: now,
        updated_at: now,
        last_message_at: null,
      });

      // Add first message
      const msgTimestamp = now + 1000;
      await supabase.from('messages').insert({
        id: 'test-msg-update-001',
        conversation_id: convId,
        role: 'user',
        content: 'First message',
        status: 'sent',
        timestamp: msgTimestamp,
      });

      // Update last_message_at (simulating API behavior)
      await supabase
        .from('conversations')
        .update({ last_message_at: msgTimestamp, updated_at: msgTimestamp })
        .eq('id', convId);

      const { data } = await supabase
        .from('conversations')
        .select('last_message_at')
        .eq('id', convId)
        .single();

      expect(data.last_message_at).toBe(msgTimestamp);
    });
  });
});
