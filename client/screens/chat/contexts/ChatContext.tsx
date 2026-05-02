/**
 * 聊天上下文 Provider
 * 管理聊天状态：当前角色、消息列表、会话管理、输入状态等
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ChatRole, THERAPIST_ROLES, DEFAULT_ROLE } from '../constants/roles';
import { ChatMessage, ChatSession, createMessage } from '../types';
import {
  getChatSessions,
  createNewSession,
  updateSessionMessages,
  deleteSession as deleteSessionFromStore,
  updateSessionTitle,
} from '../stores/sessionStore';

interface ChatContextValue {
  // 当前角色
  currentRole: ChatRole;
  setCurrentRole: (role: ChatRole) => void;
  
  // 角色列表
  roles: ChatRole[];
  
  // 消息列表
  messages: ChatMessage[];
  
  // 会话列表
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  
  // 添加消息
  addMessage: (message: ChatMessage) => void;
  
  // 发送消息（用户输入）
  sendMessage: (content: string, options?: { imageUri?: string; audioUri?: string }) => void;
  
  // AI 回复
  addAssistantMessage: (content: string) => void;
  
  // 清除当前对话
  clearMessages: () => void;
  
  // 新建对话
  createNewChat: () => Promise<void>;
  
  // 切换会话
  switchSession: (session: ChatSession) => void;
  
  // 删除会话
  deleteSession: (sessionId: string) => Promise<void>;
  
  // 加载会话列表
  loadSessions: () => Promise<void>;
  
  // 加载状态
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  // 输入文本
  inputText: string;
  setInputText: (text: string) => void;
  
  // 是否显示历史列表
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setCurrentRole] = useState<ChatRole>(DEFAULT_ROLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  
  // 保存当前会话消息的防抖定时器
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 加载会话列表
  const loadSessions = useCallback(async () => {
    const loadedSessions = await getChatSessions();
    setSessions(loadedSessions);
  }, []);
  
  // 初始化加载会话列表
  useEffect(() => {
    let mounted = true;
    getChatSessions().then(loadedSessions => {
      if (mounted) {
        setSessions(loadedSessions);
      }
    });
    return () => { mounted = false; };
  }, []);
  
  // 防抖保存消息
  const debouncedSaveMessages = useCallback((sessionId: string, newMessages: ChatMessage[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      updateSessionMessages(sessionId, newMessages);
    }, 500);
  }, []);
  
  // 添加消息并保存
  const addMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => {
      const newMessages = [...prev, message];
      
      // 如果有当前会话，自动保存
      if (currentSession) {
        debouncedSaveMessages(currentSession.id, newMessages);
        
        // 如果是第一条用户消息，更新标题
        if (message.role === 'user' && newMessages.length === 1) {
          const title = message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '');
          updateSessionTitle(currentSession.id, title);
        }
      }
      
      return newMessages;
    });
  }, [currentSession, debouncedSaveMessages]);
  
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
  
  // 清除当前对话（但不删除会话）
  const clearMessages = useCallback(() => {
    setMessages([]);
    if (currentSession) {
      updateSessionMessages(currentSession.id, []);
    }
  }, [currentSession]);
  
  // 新建对话
  const createNewChat = useCallback(async () => {
    // 保存当前会话（如果有消息）
    if (currentSession && messages.length > 0) {
      await updateSessionMessages(currentSession.id, messages);
    }
    
    // 创建新会话
    const newSession = await createNewSession(currentRole);
    setCurrentSession(newSession);
    setMessages([]);
    setShowHistory(false);
    
    // 刷新会话列表
    await loadSessions();
  }, [currentRole, currentSession, messages, loadSessions]);
  
  // 切换会话
  const switchSession = useCallback(async (session: ChatSession) => {
    // 保存当前会话（如果有消息）
    if (currentSession && messages.length > 0) {
      await updateSessionMessages(currentSession.id, messages);
    }
    
    // 找到对应的角色
    const role = THERAPIST_ROLES.find(r => r.id === session.roleId) || DEFAULT_ROLE;
    setCurrentRole(role);
    setCurrentSession(session);
    setMessages(session.messages);
    setShowHistory(false);
  }, [currentSession, messages]);
  
  // 删除会话
  const deleteSessionHandler = useCallback(async (sessionId: string) => {
    await deleteSessionFromStore(sessionId);
    
    // 如果删除的是当前会话，切换到其他会话或创建新会话
    if (currentSession?.id === sessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        await switchSession(remaining[0]);
      } else {
        await createNewChat();
      }
    }
    
    await loadSessions();
  }, [currentSession, sessions, loadSessions, switchSession, createNewChat]);
  
  const value: ChatContextValue = {
    currentRole,
    setCurrentRole,
    roles: THERAPIST_ROLES,
    messages,
    addMessage,
    sendMessage,
    addAssistantMessage,
    clearMessages,
    createNewChat,
    switchSession,
    deleteSession: deleteSessionHandler,
    loadSessions,
    sessions,
    currentSession,
    isLoading,
    setIsLoading,
    inputText,
    setInputText,
    showHistory,
    setShowHistory,
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
