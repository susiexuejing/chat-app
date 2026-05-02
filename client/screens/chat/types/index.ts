/**
 * 聊天消息类型定义
 */

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  imageUri?: string;
  audioUri?: string;
}

export interface ChatSession {
  id: string;
  roleId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 创建新消息
 */
export function createMessage(
  role: MessageRole,
  content: string,
  options?: { imageUri?: string; audioUri?: string }
): ChatMessage {
  return {
    id: generateId(),
    role,
    content,
    timestamp: Date.now(),
    ...options,
  };
}
