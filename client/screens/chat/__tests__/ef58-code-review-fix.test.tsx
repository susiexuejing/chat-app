/**
 * EF-58 Real Behavior Tests - Round 3 (Final)
 * 
 * Tests that actually execute queue operations and verify results.
 * 
 * Note: Full end-to-end testing of sendMessage during generation requires
 * mocking the entire SSE stream flow, which is complex. These tests focus
 * on the testable aspects of the queue behavior:
 * 
 * 1. Refresh recovery - queue restoration from AsyncStorage
 * 2. Queue management functions - clearQueue, removeQueuedMessage, retryQueuedMessage
 * 3. Queue state initialization and persistence
 */

import { renderHook, act } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  saveChatSessions: jest.fn(),
  getChatSessions: jest.fn().mockResolvedValue([]),
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

describe('EF-58 Real Behavior Tests - Round 3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Scenario 1: Queue Management Functions', () => {
    it('should clear queue and persist empty state', async () => {
      // Mock AsyncStorage with persisted queue
      const mockQueue = [
        {
          id: 'queued_1',
          text: 'Message 1',
          timestamp: Date.now(),
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-1',
        },
        {
          id: 'queued_2',
          text: 'Message 2',
          timestamp: Date.now() + 100,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-2',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify queue is restored
      expect(result.current!.messageQueue.length).toBe(2);
      expect(result.current!.queueCount).toBe(2);

      // Clear the queue
      await act(async () => {
        result.current!.clearQueue();
      });

      // Verify queue is cleared
      expect(result.current!.messageQueue.length).toBe(0);
      expect(result.current!.queueCount).toBe(0);

      // Verify AsyncStorage was updated (empty queue removes the key)
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('message_queue');
    });

    it('should remove specific message from queue', async () => {
      // Mock AsyncStorage with persisted queue
      const mockQueue = [
        {
          id: 'queued_A',
          text: 'Message A',
          timestamp: Date.now(),
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-A',
        },
        {
          id: 'queued_B',
          text: 'Message B',
          timestamp: Date.now() + 100,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-B',
        },
        {
          id: 'queued_C',
          text: 'Message C',
          timestamp: Date.now() + 200,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-C',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify queue is restored
      expect(result.current!.messageQueue.length).toBe(3);

      // Remove message B
      await act(async () => {
        result.current!.removeQueuedMessage('queued_B');
      });

      // Verify message B is removed
      expect(result.current!.messageQueue.length).toBe(2);
      expect(result.current!.messageQueue[0].id).toBe('queued_A');
      expect(result.current!.messageQueue[1].id).toBe('queued_C');
    });
  });

  describe('Scenario 2: FIFO Ordering Verification', () => {
    it('should maintain FIFO order when queue is restored', async () => {
      // Mock AsyncStorage with persisted queue in FIFO order
      const mockQueue = [
        {
          id: 'queued_first',
          text: 'First message',
          timestamp: 1000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-first',
        },
        {
          id: 'queued_second',
          text: 'Second message',
          timestamp: 2000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-second',
        },
        {
          id: 'queued_third',
          text: 'Third message',
          timestamp: 3000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-third',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify FIFO order is preserved
      expect(result.current!.messageQueue.length).toBe(3);
      expect(result.current!.messageQueue[0].text).toBe('First message');
      expect(result.current!.messageQueue[1].text).toBe('Second message');
      expect(result.current!.messageQueue[2].text).toBe('Third message');

      // Verify timestamps are in order
      expect(result.current!.messageQueue[0].timestamp).toBe(1000);
      expect(result.current!.messageQueue[1].timestamp).toBe(2000);
      expect(result.current!.messageQueue[2].timestamp).toBe(3000);
    });

    it('should preserve requestIds in FIFO order', async () => {
      // Mock AsyncStorage with persisted queue with unique requestIds
      const mockQueue = [
        {
          id: 'queued_1',
          text: 'Message 1',
          timestamp: 1000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-unique-1',
        },
        {
          id: 'queued_2',
          text: 'Message 2',
          timestamp: 2000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-unique-2',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify requestIds are preserved in order
      expect(result.current!.messageQueue[0].requestId).toBe('req-unique-1');
      expect(result.current!.messageQueue[1].requestId).toBe('req-unique-2');

      // Verify all requestIds are unique
      const requestIds = result.current!.messageQueue.map(m => m.requestId);
      expect(new Set(requestIds).size).toBe(2);
    });
  });

  describe('Scenario 3: Refresh Recovery', () => {
    it('should restore queue from AsyncStorage and reset processing to queued', async () => {
      // Mock AsyncStorage with persisted queue
      const mockQueue = [
        {
          id: 'queued_A',
          text: 'Message A (was processing)',
          timestamp: Date.now(),
          status: 'processing' as const, // This should be reset to queued
          retryCount: 2,
          requestId: 'req-A',
        },
        {
          id: 'queued_B',
          text: 'Message B (was queued)',
          timestamp: Date.now() + 100,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-B',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify queue is restored
      expect(result.current!.messageQueue.length).toBe(2);

      // Verify processing message is reset to queued
      expect(result.current!.messageQueue[0].status).toBe('queued');
      expect(result.current!.messageQueue[0].text).toBe('Message A (was processing)');
      expect(result.current!.messageQueue[0].requestId).toBe('req-A');

      // Verify queued message remains queued
      expect(result.current!.messageQueue[1].status).toBe('queued');
      expect(result.current!.messageQueue[1].text).toBe('Message B (was queued)');
      expect(result.current!.messageQueue[1].requestId).toBe('req-B');
    });

    it('should preserve retryCount from persisted queue', async () => {
      // Mock AsyncStorage with persisted queue that has retryCount
      const mockQueue = [
        {
          id: 'queued_retry',
          text: 'Message with retry count',
          timestamp: Date.now(),
          status: 'queued' as const,
          retryCount: 3, // This should be preserved
          requestId: 'req-retry',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify retryCount is preserved
      expect(result.current!.messageQueue.length).toBe(1);
      expect(result.current!.messageQueue[0].retryCount).toBe(3);
    });

    it('should preserve all fields from persisted queue', async () => {
      // Mock AsyncStorage with persisted queue with all fields
      const mockQueue = [
        {
          id: 'queued_full',
          text: 'Full message',
          timestamp: 1234567890,
          status: 'queued' as const,
          retryCount: 5,
          requestId: 'req-full-123',
          options: { emotion: 'happy' },
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { result } = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      // Verify all fields are preserved
      expect(result.current!.messageQueue.length).toBe(1);
      expect(result.current!.messageQueue[0].id).toBe('queued_full');
      expect(result.current!.messageQueue[0].text).toBe('Full message');
      expect(result.current!.messageQueue[0].timestamp).toBe(1234567890);
      expect(result.current!.messageQueue[0].status).toBe('queued');
      expect(result.current!.messageQueue[0].retryCount).toBe(5);
      expect(result.current!.messageQueue[0].requestId).toBe('req-full-123');
    });
  });
});
