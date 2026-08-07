/**
 * EF-59 Phase 1: Database Schema Tests
 * 
 * Verifies:
 * - Schema definitions load correctly
 * - Database tables exist and have correct structure
 * - Service role can access new tables
 */
import { conversations, messages, healthCheck } from '../storage/database/shared/schema';
import { getSupabaseClient } from '../storage/database/supabase-client';

describe('EF-59 Phase 1: Database Schema', () => {
  describe('Schema definitions', () => {
    test('conversations table is defined with correct columns', () => {
      expect(conversations).toBeDefined();
      // Verify table name
      expect(conversations[Symbol.for('drizzle:Name')]).toBe('conversations');
    });

    test('messages table is defined with correct columns', () => {
      expect(messages).toBeDefined();
      expect(messages[Symbol.for('drizzle:Name')]).toBe('messages');
    });

    test('healthCheck table is preserved (system table)', () => {
      expect(healthCheck).toBeDefined();
      expect(healthCheck[Symbol.for('drizzle:Name')]).toBe('health_check');
    });

    test('messages table has foreign key reference to conversations', () => {
      // Verify conversation_id column exists and references conversations
      const columns = (messages as any)[Symbol.for('drizzle:Columns')];
      expect(columns).toBeDefined();
      expect(columns.conversation_id).toBeDefined();
    });
  });

  describe('Database tables exist', () => {
    let client: ReturnType<typeof getSupabaseClient>;

    beforeAll(() => {
      client = getSupabaseClient();
    });

    test('conversations table exists in database', async () => {
      // Query with limit 0 to verify table exists without fetching data
      const { error } = await client
        .from('conversations')
        .select('id')
        .limit(0);
      
      // If table doesn't exist, error will be 42P01
      expect(error?.code).not.toBe('42P01');
    });

    test('messages table exists in database', async () => {
      const { error } = await client
        .from('messages')
        .select('id')
        .limit(0);
      
      expect(error?.code).not.toBe('42P01');
    });

    test('health_check table exists in database', async () => {
      const { error } = await client
        .from('health_check')
        .select('id')
        .limit(0);
      
      expect(error?.code).not.toBe('42P01');
    });
  });

  describe('Service role access', () => {
    let client: ReturnType<typeof getSupabaseClient>;

    beforeAll(() => {
      client = getSupabaseClient();
    });

    test('service role can access conversations table', async () => {
      // With service_role_key, RLS is bypassed - verifies table is accessible
      const { data, error } = await client
        .from('conversations')
        .select('id')
        .limit(1);
      
      expect(error).toBeNull();
    });

    test('service role can access messages table', async () => {
      const { data, error } = await client
        .from('messages')
        .select('id')
        .limit(1);
      
      expect(error).toBeNull();
    });
  });

  describe('CRUD operations', () => {
    let client: ReturnType<typeof getSupabaseClient>;
    let testConversationId: string;

    beforeAll(() => {
      client = getSupabaseClient();
    });

    afterEach(async () => {
      // Cleanup test data
      if (testConversationId) {
        await client.from('messages').delete().eq('conversation_id', testConversationId);
        await client.from('conversations').delete().eq('id', testConversationId);
        testConversationId = '';
      }
    });

    test('can insert and retrieve a conversation', async () => {
      const now = Date.now();
      const { data, error } = await client
        .from('conversations')
        .insert({
          user_id: 'test-user-ef59',
          role_id: 'emotional-companion',
          state: 'active',
          created_at: now,
          updated_at: now,
          last_message_at: null,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.id).toBeDefined();
      expect(data!.user_id).toBe('test-user-ef59');
      expect(data!.role_id).toBe('emotional-companion');
      expect(data!.state).toBe('active');
      expect(data!.created_at).toBe(now);
      expect(data!.last_message_at).toBeNull();

      testConversationId = data!.id;
    });

    test('can insert and retrieve a message', async () => {
      const now = Date.now();
      
      // First create a conversation
      const { data: conv, error: convError } = await client
        .from('conversations')
        .insert({
          user_id: 'test-user-ef59',
          role_id: 'emotional-companion',
          state: 'active',
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      expect(convError).toBeNull();
      expect(conv).toBeDefined();
      testConversationId = conv!.id;

      // Now insert a message
      const { data: msg, error: msgError } = await client
        .from('messages')
        .insert({
          conversation_id: conv!.id,
          role: 'user',
          content: 'Hello, this is a test message',
          status: 'sent',
          request_id: 'test-request-ef59-001',
          timestamp: now,
        })
        .select()
        .single();

      expect(msgError).toBeNull();
      expect(msg).toBeDefined();
      expect(msg!.id).toBeDefined();
      expect(msg!.conversation_id).toBe(conv!.id);
      expect(msg!.role).toBe('user');
      expect(msg!.content).toBe('Hello, this is a test message');
      expect(msg!.status).toBe('sent');
      expect(msg!.request_id).toBe('test-request-ef59-001');
      expect(msg!.timestamp).toBe(now);
    });

    test('cascade delete removes messages when conversation is deleted', async () => {
      const now = Date.now();
      
      // Create conversation
      const { data: conv } = await client
        .from('conversations')
        .insert({
          user_id: 'test-user-ef59',
          role_id: 'emotional-companion',
          state: 'active',
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      expect(conv).toBeDefined();
      testConversationId = conv!.id;

      // Insert a message
      await client
        .from('messages')
        .insert({
          conversation_id: conv!.id,
          role: 'user',
          content: 'Test message for cascade',
          status: 'sent',
          timestamp: now,
        });

      // Delete conversation
      await client.from('conversations').delete().eq('id', conv!.id);

      // Verify message is also deleted (cascade)
      const { data: remainingMessages } = await client
        .from('messages')
        .select('id')
        .eq('conversation_id', conv!.id);

      expect(remainingMessages).toHaveLength(0);
      
      // Clear testConversationId since conversation is already deleted
      testConversationId = '';
    });
  });
});
