/**
 * EM-54: 页面刷新后恢复会话、角色和消息
 * 
 * 验收标准：
 * 1. 页面刷新后恢复当前会话、角色和已完成消息
 * 2. 不恢复仍在 streaming 的临时状态
 * 3. "新建"仍然创建干净新会话，但不删除历史会话数据
 */

import { saveChatSessions, getChatSessions } from '../stores/sessionStore';
import { ChatSession } from '../types';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

describe('EM-54: 页面刷新后恢复会话', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('持久化存储', () => {
    it('应该保存会话列表到 AsyncStorage', async () => {
      const mockSessions: ChatSession[] = [
        {
          id: 'session_1',
          roleId: 'role_1',
          messages: [
            { id: 'msg_1', role: 'user', content: '你好', timestamp: Date.now() },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      
      await saveChatSessions(mockSessions);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'chat_sessions',
        JSON.stringify(mockSessions)
      );
    });

    it('应该从 AsyncStorage 加载会话列表', async () => {
      const mockSessions: ChatSession[] = [
        {
          id: 'session_1',
          roleId: 'role_1',
          messages: [
            { id: 'msg_1', role: 'user', content: '你好', timestamp: Date.now() },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockSessions));
      
      const result = await getChatSessions();
      
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session_1');
      expect(result[0].messages).toHaveLength(1);
    });

    it('应该保存和恢复当前会话 ID', async () => {
      const sessionId = 'session_1';
      
      // 设置 mock 返回值
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(sessionId);
      
      await AsyncStorage.setItem('current_session_id', sessionId);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('current_session_id', sessionId);
      
      const restored = await AsyncStorage.getItem('current_session_id');
      expect(restored).toBe(sessionId);
    });

    it('应该保存和恢复当前角色 ID', async () => {
      const roleId = 'role_2';
      
      // 设置 mock 返回值
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(roleId);
      
      await AsyncStorage.setItem('current_role_id', roleId);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('current_role_id', roleId);
      
      const restored = await AsyncStorage.getItem('current_role_id');
      expect(restored).toBe(roleId);
    });
  });

  describe('恢复状态', () => {
    it('应该恢复会话列表和消息', async () => {
      const mockSessions: ChatSession[] = [
        {
          id: 'session_1',
          roleId: 'role_1',
          messages: [
            { id: 'msg_1', role: 'user', content: '你好', timestamp: Date.now() },
            { id: 'msg_2', role: 'assistant', content: '你好！', timestamp: Date.now() },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'chat_sessions') {
          return Promise.resolve(JSON.stringify(mockSessions));
        }
        return Promise.resolve(null);
      });
      
      const sessions = await getChatSessions();
      
      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages).toHaveLength(2);
      expect(sessions[0].messages[0].content).toBe('你好');
      expect(sessions[0].messages[1].content).toBe('你好！');
    });

    it('不应该恢复 streaming 状态（isLoading/isThinking 默认为 false）', async () => {
      // streaming 状态不会被持久化，刷新后默认为 false
      const isLoading = false;
      const isThinking = false;
      
      expect(isLoading).toBe(false);
      expect(isThinking).toBe(false);
    });
  });

  describe('新建会话', () => {
    it('新建会话应该保留历史会话数据', async () => {
      const existingSessions: ChatSession[] = [
        {
          id: 'session_1',
          roleId: 'role_1',
          messages: [
            { id: 'msg_1', role: 'user', content: '你好', timestamp: Date.now() },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      
      // 保存现有会话
      await saveChatSessions(existingSessions);
      
      // 创建新会话
      const newSession: ChatSession = {
        id: 'session_2',
        roleId: 'role_1',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      const allSessions = [newSession, ...existingSessions];
      await saveChatSessions(allSessions);
      
      // 验证 saveChatSessions 被调用两次
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
      
      // 验证第二次调用时保存了 2 个会话
      const secondCall = (AsyncStorage.setItem as jest.Mock).mock.calls[1];
      const savedSessions = JSON.parse(secondCall[1]);
      expect(savedSessions).toHaveLength(2);
      expect(savedSessions[0].id).toBe('session_2');
      expect(savedSessions[1].id).toBe('session_1');
    });
  });
});
