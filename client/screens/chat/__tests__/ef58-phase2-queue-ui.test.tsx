/**
 * EF-58 Phase 2: QueueStatusBar UI Tests
 * 
 * Tests the visual queue status component:
 * 1. Processing + queued message display
 * 2. Multiple queued messages display order
 * 3. Queue cleared after processing (component hidden)
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { QueueStatusBar } from '../components/QueueStatusBar';
import { ChatProvider } from '../contexts/ChatContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Fix: StyleSheet.flatten may not be available in test environment with Uniwind
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFlatten = (StyleSheet as any).flatten;
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(StyleSheet as any).flatten) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (StyleSheet as any).flatten = (style: any) => style;
  }
});
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (StyleSheet as any).flatten = originalFlatten;
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props: Record<string, unknown>) => React.createElement(Text, { testID: 'icon' }),
    FontAwesome6: (props: Record<string, unknown>) => React.createElement(Text, { testID: 'icon' }),
  };
});

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

// Helper to wait for async initialization
const waitForInitialization = async () => {
  await new Promise(resolve => setTimeout(resolve, 200));
};

describe('EF-58 Phase 2: QueueStatusBar UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Scenario 1: Processing + Queued Message Display', () => {
    it('should show queue bar with queued message when AI is generating', async () => {
      // Persist a queue with one message to simulate queued state
      const mockQueue = [
        {
          id: 'queued_1',
          text: 'I also want to say something else',
          timestamp: Date.now(),
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-1',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { getByTestId, queryByTestId } = await render(
        <ChatProvider>
          <QueueStatusBar />
        </ChatProvider>
      );

      await waitForInitialization();

      // Queue bar should be visible
      expect(getByTestId('queue-status-bar')).toBeTruthy();

      // Queued message should be displayed
      expect(getByTestId('queue-item-0')).toBeTruthy();
      // Text is truncated at 30 chars + "..."
      expect(getByTestId('queue-item-text-0').props.children).toContain('...');
      expect(getByTestId('queue-item-text-0').props.children).toMatch(/^I also want to say somethin/);
    });
  });

  describe('Scenario 2: Multiple Queued Messages Display Order', () => {
    it('should display multiple queued messages in FIFO order', async () => {
      const mockQueue = [
        {
          id: 'queued_A',
          text: 'First queued message',
          timestamp: 1000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-A',
        },
        {
          id: 'queued_B',
          text: 'Second queued message',
          timestamp: 2000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-B',
        },
        {
          id: 'queued_C',
          text: 'Third queued message is a very long text that should be truncated',
          timestamp: 3000,
          status: 'queued' as const,
          retryCount: 0,
          requestId: 'req-C',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { getByTestId } = await render(
        <ChatProvider>
          <QueueStatusBar />
        </ChatProvider>
      );

      await waitForInitialization();

      // All three messages should be displayed
      expect(getByTestId('queue-item-0')).toBeTruthy();
      expect(getByTestId('queue-item-1')).toBeTruthy();
      expect(getByTestId('queue-item-2')).toBeTruthy();

      // Verify FIFO order by text content
      expect(getByTestId('queue-item-text-0').props.children).toBe('First queued message');
      expect(getByTestId('queue-item-text-1').props.children).toBe('Second queued message');

      // Long text should be truncated with "..."
      const longText = getByTestId('queue-item-text-2').props.children;
      expect(longText).toContain('...');
      expect(longText.length).toBeLessThan('Third queued message is a very long text that should be truncated'.length);
    });
  });

  describe('Scenario 3: Queue Cleared After Processing', () => {
    it('should not render queue bar when queue is empty', async () => {
      // No persisted queue → empty queue
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      const { queryByTestId } = await render(
        <ChatProvider>
          <QueueStatusBar />
        </ChatProvider>
      );

      await waitForInitialization();

      // Queue bar should NOT be visible when queue is empty
      expect(queryByTestId('queue-status-bar')).toBeNull();
    });

    it('should not render queue bar when all messages are completed', async () => {
      // Queue with only completed messages (should be filtered out)
      const mockQueue = [
        {
          id: 'completed_1',
          text: 'Already processed',
          timestamp: Date.now(),
          status: 'completed' as const,
          retryCount: 0,
          requestId: 'req-done',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'message_queue') return Promise.resolve(JSON.stringify(mockQueue));
        return Promise.resolve(null);
      });

      const { queryByTestId } = await render(
        <ChatProvider>
          <QueueStatusBar />
        </ChatProvider>
      );

      await waitForInitialization();

      // Queue bar should NOT be visible (no queued messages)
      expect(queryByTestId('queue-status-bar')).toBeNull();
    });
  });
});
