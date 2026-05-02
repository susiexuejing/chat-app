/**
 * 聊天上下文 Provider
 * 管理聊天状态：当前角色、消息列表、输入状态等
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ChatRole, THERAPIST_ROLES, DEFAULT_ROLE } from '../constants/roles';
import { ChatMessage, ChatSession, createMessage, generateId } from '../types';

interface ChatContextValue {
  // 当前角色
  currentRole: ChatRole;
  setCurrentRole: (role: ChatRole) => void;
  
  // 角色列表
  roles: ChatRole[];
  
  // 消息列表
  messages: ChatMessage[];
  
  // 添加消息
  addMessage: (message: ChatMessage) => void;
  
  // 发送消息（用户输入）
  sendMessage: (content: string, options?: { imageUri?: string; audioUri?: string }) => void;
  
  // AI 回复
  addAssistantMessage: (content: string) => void;
  
  // 清除对话
  clearMessages: () => void;
  
  // 加载状态
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  // 输入文本
  inputText: string;
  setInputText: (text: string) => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setCurrentRole] = useState<ChatRole>(DEFAULT_ROLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  
  // 添加消息
  const addMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => [...prev, message]);
  }, []);
  
  // 发送用户消息
  const sendMessage = useCallback((content: string, options?: { imageUri?: string; audioUri?: string }) => {
    const userMessage = createMessage('user', content, options);
    addMessage(userMessage);
    setInputText('');
    return userMessage;
  }, [addMessage]);
  
  // AI 回复
  const addAssistantMessage = useCallback((content: string) => {
    const assistantMessage = createMessage('assistant', content);
    addMessage(assistantMessage);
    return assistantMessage;
  }, [addMessage]);
  
  // 清除对话
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);
  
  const value: ChatContextValue = {
    currentRole,
    setCurrentRole,
    roles: THERAPIST_ROLES,
    messages,
    addMessage,
    sendMessage,
    addAssistantMessage,
    clearMessages,
    isLoading,
    setIsLoading,
    inputText,
    setInputText,
  };
  
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
