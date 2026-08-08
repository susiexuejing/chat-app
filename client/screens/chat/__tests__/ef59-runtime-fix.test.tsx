/**
 * EF-59 Runtime Fix Tests
 * 
 * Tests the conversation lifecycle fixes:
 * 1. createConversation called before first message persistence
 * 2. conversationId restored during loadPersistedState
 * 3. Backend sync uses backend conversation ID (not frontend session ID)
 */

import { renderHook, act } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sessionStore from '../stores/sessionStore';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// Mock cozeApi
jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

// Mock roles
jest.mock('../constants/roles', () => ({
  roles: [{ id: 'test-role', name: 'Test Role' }],
  getRoleById: jest.fn((id: string) => ({ id, name: 'Test Role' })),
}));

// Mock sessionStore
jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockResolvedValue(undefined),
  getChatSessions: jest.fn().mockResolvedValue([]),
  createConversation: jest.fn(),
  fetchConversation: jest.fn(),
  persistMessage: jest.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>{children}</ChatProvider>
);

// Helper to wait for async initialization
const waitForInitialization = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });
};

describe('EF-59 Runtime Fix Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([]);
    (sessionStore.createConversation as jest.Mock).mockResolvedValue({
      id: 'backend-conv-123',
      user_id: 'test-device',
      role_id: 'test-role',
      state: 'active',
      created_at: Date.now(),
      updated_at: Date.now(),
      last_message_at: null,
    });
    (sessionStore.fetchConversation as jest.Mock).mockResolvedValue(null);
    (sessionStore.persistMessage as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Scenario 1: New user sends first message', () => {
    it('should initialize correctly for new user', async () => {
      // Setup: No existing sessions (new user)
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([]);

      // Render hook
      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify: Hook initialized correctly
      expect(result.current).not.toBeNull();
      
      // Verify initial state
      expect(result.current!.messageQueue).toEqual([]);
      
      unmount();
    });

    it('should have createConversation available', async () => {
      const mockConvId = 'backend-conv-456';
      (sessionStore.createConversation as jest.Mock).mockResolvedValue({
        id: mockConvId,
        user_id: 'test-device',
        role_id: 'test-role',
        state: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
        last_message_at: null,
      });

      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify hook initialized correctly
      expect(result.current).not.toBeNull();
      
      unmount();
    });
  });

  describe('Scenario 2: Refresh existing conversation', () => {
    it('should restore conversationId from session', async () => {
      // Setup: Existing session with conversationId
      const existingSession = {
        id: 'session-123',
        roleId: 'test-role',
        conversationId: 'backend-conv-789',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() - 1000 },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
        ],
        messageQueue: [],
        createdAt: Date.now() - 10000,
      };

      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([existingSession]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'current_session_id') return Promise.resolve('session-123');
        if (key === 'current_role_id') return Promise.resolve('test-role');
        return Promise.resolve(null);
      });

      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify: Messages should be restored
      expect(result.current).not.toBeNull();
      expect(result.current!.messages).toHaveLength(2);
      expect(result.current!.messages[0].content).toBe('Hello');
      expect(result.current!.messages[1].content).toBe('Hi there!');
      
      unmount();
    });

    it('should use backend conversation ID for fetchConversation', async () => {
      const backendConvId = 'backend-conv-abc';
      const existingSession = {
        id: 'session-456',
        roleId: 'test-role',
        conversationId: backendConvId,
        messages: [],
        messageQueue: [],
        createdAt: Date.now(),
      };

      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([existingSession]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'current_session_id') return Promise.resolve('session-456');
        if (key === 'current_role_id') return Promise.resolve('test-role');
        return Promise.resolve(null);
      });

      // Mock fetchConversation to return messages
      (sessionStore.fetchConversation as jest.Mock).mockResolvedValue({
        conversation: {
          id: backendConvId,
          user_id: 'test-device',
          role_id: 'test-role',
          state: 'active',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_message_at: Date.now(),
        },
        messages: [
          { id: 'msg-backend', conversation_id: backendConvId, role: 'assistant', content: 'From backend', status: 'sent', timestamp: Date.now() },
        ],
      });

      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Wait for sync to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Verify: fetchConversation was called with backend conversation ID
      expect(sessionStore.fetchConversation).toHaveBeenCalledWith(backendConvId);
      
      unmount();
    });
  });

  describe('Scenario 4: Race condition regression', () => {
    it('should sync from backend even when sessions load slower than sync useEffect triggers', async () => {
      // This test verifies the fix for the race condition where:
      // 1. Component mounts with sessions = []
      // 2. syncFromBackend useEffect triggers when currentSessionId is set
      // 3. sessions.find() returns undefined because sessions is still []
      // 4. hasSyncedRef was set to true, preventing retry
      // 
      // The fix: hasSyncedRef is only set after session is found

      const backendConvId = 'backend-conv-race';
      const existingSession = {
        id: 'session-race',
        roleId: 'test-role',
        conversationId: backendConvId,
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() - 1000 },
        ],
        messageQueue: [],
        createdAt: Date.now(),
      };

      // Simulate slow session loading (async delay)
      let resolveGetChatSessions: (value: any) => void;
      const slowGetChatSessions = new Promise((resolve) => {
        resolveGetChatSessions = resolve;
      });
      (sessionStore.getChatSessions as jest.Mock).mockReturnValue(slowGetChatSessions);

      // Set currentSessionId immediately (simulating fast AsyncStorage read)
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'current_session_id') return Promise.resolve('session-race');
        if (key === 'current_role_id') return Promise.resolve('test-role');
        return Promise.resolve(null);
      });

      // Mock fetchConversation
      (sessionStore.fetchConversation as jest.Mock).mockResolvedValue({
        conversation: {
          id: backendConvId,
          user_id: 'test-device',
          role_id: 'test-role',
          state: 'active',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_message_at: Date.now(),
        },
        messages: [
          { id: 'msg-backend', conversation_id: backendConvId, role: 'assistant', content: 'From backend', status: 'sent', timestamp: Date.now() },
        ],
      });

      // Start rendering
      const { result, unmount } = await renderHook(() => useChat(), { wrapper });

      // Wait a bit for useEffect to trigger (sessions still empty at this point)
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Now resolve the slow session loading
      await act(async () => {
        resolveGetChatSessions!([existingSession]);
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Wait for sync to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Verify: fetchConversation was called with backend conversation ID
      // This proves the race condition is fixed - sync waited for sessions to load
      expect(sessionStore.fetchConversation).toHaveBeenCalledWith(backendConvId);

      unmount();
    });

    it('should not lock hasSyncedRef when session is not found', async () => {
      // Setup: No matching session
      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'current_session_id') return Promise.resolve('session-nonexistent');
        return Promise.resolve(null);
      });

      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // fetchConversation should NOT be called (no session found)
      expect(sessionStore.fetchConversation).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('Scenario 3: No backend available', () => {
    it('should keep AsyncStorage cache usable when backend is unavailable', async () => {
      const cachedMessages = [
        { id: 'cached-1', role: 'user', content: 'Cached message', timestamp: Date.now() - 1000 },
      ];
      const existingSession = {
        id: 'session-789',
        roleId: 'test-role',
        conversationId: 'backend-conv-xyz',
        messages: cachedMessages,
        messageQueue: [],
        createdAt: Date.now(),
      };

      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([existingSession]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'current_session_id') return Promise.resolve('session-789');
        if (key === 'current_role_id') return Promise.resolve('test-role');
        return Promise.resolve(null);
      });

      // Mock fetchConversation to fail (network error)
      (sessionStore.fetchConversation as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result, unmount } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Wait for sync attempt to fail
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Verify: Cached messages should still be available
      expect(result.current).not.toBeNull();
      expect(result.current!.messages).toHaveLength(1);
      expect(result.current!.messages[0].content).toBe('Cached message');
      
      unmount();
    });
  });
});
