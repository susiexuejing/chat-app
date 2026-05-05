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
  roleName?: string;
  title?: string; // 对话标题，基于第一条用户消息
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 轻量分析结果类型
 */
export interface AnalysisResult {
  emotions: string[]; // 识别出的情绪
  keywords: string[]; // 关键词
  summary: string; // 内容摘要
  keyEvent: string; // 关键事件
  thoughts: Array<{ label: string; question: string }>; // 可能的念头
  interactionOptions: Array<{ label: string; value: string }>; // 互动选项
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
