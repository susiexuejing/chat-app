/**
 * 对话历史存储管理
 * 使用 AsyncStorage 持久化存储对话历史
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatSession, ChatMessage } from '../types';
import { PsychologistRole } from '../constants/roles';

const STORAGE_KEY = 'chat_sessions';

// 生成唯一ID
function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 创建消息对象
function createMessage(
  role: 'user' | 'assistant',
  content: string
): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

// 获取所有对话历史
export async function getChatSessions(): Promise<ChatSession[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('获取对话历史失败:', error);
    return [];
  }
}

// 保存所有对话历史
export async function saveChatSessions(sessions: ChatSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('保存对话历史失败:', error);
  }
}

// 创建新对话
export async function createNewSession(role: PsychologistRole): Promise<ChatSession> {
  const sessions = await getChatSessions();
  
  const newSession: ChatSession = {
    id: generateId(),
    roleId: role.id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  sessions.unshift(newSession); // 新对话置顶
  await saveChatSessions(sessions);
  
  return newSession;
}

// 更新对话消息
export async function updateSessionMessages(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  const sessions = await getChatSessions();
  
  const index = sessions.findIndex(s => s.id === sessionId);
  if (index !== -1) {
    sessions[index].messages = messages;
    sessions[index].updatedAt = Date.now();
    
    // 如果不是最新对话，移到最前面
    if (index !== 0) {
      const session = sessions.splice(index, 1)[0];
      sessions.unshift(session);
    }
    
    await saveChatSessions(sessions);
  }
}

// 删除对话
export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await getChatSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  await saveChatSessions(filtered);
}

// 清空所有对话
export async function clearAllSessions(): Promise<void> {
  await saveChatSessions([]);
}

// 获取单个对话
export async function getSession(sessionId: string): Promise<ChatSession | null> {
  const sessions = await getChatSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

// ====== EF-59 Phase 4: 后端持久化 API ======

// 获取后端基础 URL
function getBackendBaseUrl(): string | null {
  return process.env.EXPO_PUBLIC_BACKEND_BASE_URL || null;
}

// EF-59: 持久化消息到后端
export interface PersistedMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'sent' | 'failed';
  requestId?: string;
  timestamp: number;
}

// EF-59: 创建对话（如果不存在）
export async function createConversation(
  userId: string,
  roleId: string
): Promise<{ id: string } | null> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/api/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, roleId }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('[EF-59] createConversation failed:', error);
    return null;
  }
}

// EF-59: 持久化消息到后端
export async function persistMessage(
  conversationId: string,
  message: {
    role: 'user' | 'assistant';
    content: string;
    status: 'sent' | 'failed';
    requestId?: string;
  }
): Promise<PersistedMessage | null> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) return null;

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('[EF-59] persistMessage failed:', error);
    return null;
  }
}

// EF-59: 从后端获取对话和消息
export async function fetchConversation(
  conversationId: string
): Promise<{ conversation: unknown; messages: PersistedMessage[] } | null> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/api/v1/conversations/${conversationId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('[EF-59] fetchConversation failed:', error);
    return null;
  }
}
