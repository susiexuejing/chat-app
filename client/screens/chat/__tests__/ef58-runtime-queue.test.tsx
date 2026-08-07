/**
 * EF-58 Real Runtime Queue Behavior Tests - Round 4
 * 
 * These tests verify real runtime queue behavior:
 * 1. Scenario 1: Queue during generation (chatStart never resolves)
 * 2. Scenario 2: FIFO ordering (multiple messages queued)
 * 3. Scenario 3: Refresh recovery (restore queue from AsyncStorage)
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import * as cozeApi from '../api/cozeApi';
import React from 'react';

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
    await new Promise(resolve => setTimeout(resolve, 200));
  });
};

describe('EF-58 Real Runtime Queue Behavior Tests - Round 4', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hook: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Critical: unmount to terminate pending async work
    // (chatStart never-resolving Promise + polling loop at line 673)
    if (hook) {
      hook.unmount();
      hook = null;
    }
  });

  describe('Scenario 1: Real Queue During Generation', () => {
    it('should queue second message when first is generating', async () => {
      // chatStart never resolves → sendingRef stays true, isLoading stays true
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      (cozeApi.chatStart as jest.Mock).mockImplementation(() => new Promise(() => {}));

      hook = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      expect(hook.result.current).not.toBeNull();
      expect(hook.result.current!.isLoading).toBe(false);

      // Fire first message - await act(async) ensures setIsLoading(true) is flushed
      await act(async () => {
        // Don't await sendMessage itself (it never resolves due to chatStart pending)
        // But we need to be inside await act(async) so state updates are flushed
        hook.result.current!.sendMessage('First message');
        // Yield to let the synchronous prefix execute (sendingRef=true, setIsLoading=true)
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Verify isLoading is now true
      await waitFor(() => {
        expect(hook.result.current!.isLoading).toBe(true);
      }, { timeout: 3000 });

      // Send second message - sendingRef.current is true → should be queued
      let secondResult: boolean | undefined;
      await act(async () => {
        secondResult = await hook.result.current!.sendMessage('Second message');
      });

      // Verify second message is queued
      expect(secondResult).toBe(false);
      expect(hook.result.current!.messageQueue.length).toBe(1);
      expect(hook.result.current!.messageQueue[0].text).toBe('Second message');
      expect(hook.result.current!.messageQueue[0].status).toBe('queued');
      expect(hook.result.current!.queueCount).toBe(1);
    }, 15000);
  });

  describe('Scenario 2: Real FIFO Ordering', () => {
    it('should maintain FIFO order when multiple messages are queued', async () => {
      // chatStart never resolves → keeps sendingRef.current = true
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      (cozeApi.chatStart as jest.Mock).mockImplementation(() => new Promise(() => {}));

      hook = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      expect(hook.result.current).not.toBeNull();

      // Fire first message
      await act(async () => {
        hook.result.current!.sendMessage('A');
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Wait for isLoading to become true
      await waitFor(() => {
        expect(hook.result.current!.isLoading).toBe(true);
      }, { timeout: 3000 });

      // Send B - should be queued
      await act(async () => {
        await hook.result.current!.sendMessage('B');
      });

      // Send C - should be queued
      await act(async () => {
        await hook.result.current!.sendMessage('C');
      });

      // Verify FIFO order: B before C
      expect(hook.result.current!.messageQueue.length).toBe(2);
      expect(hook.result.current!.messageQueue[0].text).toBe('B');
      expect(hook.result.current!.messageQueue[0].status).toBe('queued');
      expect(hook.result.current!.messageQueue[1].text).toBe('C');
      expect(hook.result.current!.messageQueue[1].status).toBe('queued');
      expect(hook.result.current!.queueCount).toBe(2);

      // Verify timestamps preserve order
      const timestamps = hook.result.current!.messageQueue.map((m: { timestamp: number }) => m.timestamp);
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
    }, 15000);
  });

  describe('Scenario 3: Refresh Recovery', () => {
    it('should restore queue from AsyncStorage with correct state', async () => {
      const persistedQueue = [
        {
          id: 'msg-1',
          text: 'Message A',
          timestamp: 1000,
          status: 'processing' as const,
          retryCount: 2,
          requestId: 'req-A',
          options: {},
        },
        {
          id: 'msg-2',
          text: 'Message B',
          timestamp: 2000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-B',
          options: {},
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') {
          return Promise.resolve(JSON.stringify(persistedQueue));
        }
        return Promise.resolve(null);
      });

      hook = await renderHook(() => useChat(), { wrapper });
      await waitForInitialization();

      expect(hook.result.current).not.toBeNull();

      // Verify queue is restored
      expect(hook.result.current!.messageQueue.length).toBe(2);

      // First message: was processing → reset to queued on restore
      expect(hook.result.current!.messageQueue[0].id).toBe('msg-1');
      expect(hook.result.current!.messageQueue[0].text).toBe('Message A');
      expect(hook.result.current!.messageQueue[0].status).toBe('queued');
      expect(hook.result.current!.messageQueue[0].requestId).toBe('req-A');
      expect(hook.result.current!.messageQueue[0].retryCount).toBe(2);

      // Second message: stays queued
      expect(hook.result.current!.messageQueue[1].id).toBe('msg-2');
      expect(hook.result.current!.messageQueue[1].text).toBe('Message B');
      expect(hook.result.current!.messageQueue[1].status).toBe('queued');
      expect(hook.result.current!.messageQueue[1].requestId).toBe('req-B');
      expect(hook.result.current!.messageQueue[1].retryCount).toBe(0);

      expect(hook.result.current!.queueCount).toBe(2);
    });
  });
});
