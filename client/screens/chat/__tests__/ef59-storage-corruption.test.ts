/**
 * EF-59 Session Storage Corruption Protection Tests
 * 
 * Tests for defensive handling of corrupted AsyncStorage data.
 * Root Cause: Historical corrupted storage value "undefined" caused JSON.parse failure.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSessions, saveChatSessions } from '../stores/sessionStore';
import { ChatSession } from '../types';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('EF-59 Storage Corruption Protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getChatSessions - Read Protection', () => {
    it('should return empty array and cleanup when data is "undefined"', async () => {
      // Setup: corrupted data
      mockAsyncStorage.getItem.mockResolvedValue('undefined');
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat_sessions');
    });

    it('should return empty array and cleanup when data is "null"', async () => {
      // Setup: corrupted data
      mockAsyncStorage.getItem.mockResolvedValue('null');
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat_sessions');
    });

    it('should return empty array when data is malformed JSON', async () => {
      // Setup: malformed JSON
      mockAsyncStorage.getItem.mockResolvedValue('{abc');
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat_sessions');
    });

    it('should return empty array and cleanup when data is not an array', async () => {
      // Setup: valid JSON but not an array
      mockAsyncStorage.getItem.mockResolvedValue('{"id": "not-an-array"}');
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat_sessions');
    });

    it('should return sessions when data is valid array', async () => {
      // Setup: valid data
      const mockSessions: ChatSession[] = [
        {
          id: 'session1',
          roleId: 'test-role',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(mockSessions));
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual(mockSessions);
      expect(mockAsyncStorage.removeItem).not.toHaveBeenCalled();
    });

    it('should return empty array when no data exists', async () => {
      // Setup: no data
      mockAsyncStorage.getItem.mockResolvedValue(null);
      
      // Execute
      const result = await getChatSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(mockAsyncStorage.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('saveChatSessions - Write Protection', () => {
    it('should not write when sessions is undefined', async () => {
      // Execute with undefined (bypassing TypeScript)
      await saveChatSessions(undefined as unknown as ChatSession[]);
      
      // Verify: no write occurred
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('should not write when sessions is null', async () => {
      // Execute with null (bypassing TypeScript)
      await saveChatSessions(null as unknown as ChatSession[]);
      
      // Verify: no write occurred
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('should not write when sessions is an object', async () => {
      // Execute with object (bypassing TypeScript)
      await saveChatSessions({ id: 'not-array' } as unknown as ChatSession[]);
      
      // Verify: no write occurred
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('should write when sessions is valid array', async () => {
      // Setup
      const mockSessions: ChatSession[] = [
        {
          id: 'session1',
          roleId: 'test-role',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      
      // Execute
      await saveChatSessions(mockSessions);
      
      // Verify: write occurred with valid JSON
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'chat_sessions',
        JSON.stringify(mockSessions)
      );
    });

    it('should write empty array when sessions is empty', async () => {
      // Execute
      await saveChatSessions([]);
      
      // Verify: write occurred with empty array
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'chat_sessions',
        '[]'
      );
    });
  });

  describe('Integration - Corruption Recovery Flow', () => {
    it('should recover from corrupted storage and allow new writes', async () => {
      // Setup: corrupted data exists
      mockAsyncStorage.getItem.mockResolvedValueOnce('undefined');
      
      // Execute: read (should cleanup)
      const readResult = await getChatSessions();
      expect(readResult).toEqual([]);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalled();
      
      // Execute: write new data
      const newSessions: ChatSession[] = [
        {
          id: 'new-session',
          roleId: 'test-role',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      await saveChatSessions(newSessions);
      
      // Verify: new data was written
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'chat_sessions',
        JSON.stringify(newSessions)
      );
      
      // Setup: next read returns new data
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(newSessions));
      
      // Execute: read again
      const finalResult = await getChatSessions();
      
      // Verify: got new data
      expect(finalResult).toEqual(newSessions);
    });
  });
});
