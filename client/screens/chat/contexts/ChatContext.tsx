/**
 * 聊天上下文 Provider
 * 管理聊天状态：当前角色、消息列表、会话管理、输入状态等
 * 
 * 对接百炼 API：POST /api/v1/chat（非流式）
 * 文档：https://help.aliyun.com/zh/model-studio/qwen-omni
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { ChatRole, THERAPIST_ROLES, DEFAULT_ROLE, getDefaultRoles, buildSystemPrompt } from '../constants/roles';
import { ChatMessage, ChatSession, createMessage } from '../types';
import {
  getChatSessions,
  createNewSession,
  updateSessionMessages,
  deleteSession as deleteSessionFromStore,
  updateSessionTitle,
} from '../stores/sessionStore';

interface ChatContextType {
  messages: ChatMessage[];
  inputText: string;
  setInputText: (text: string) => void;
  roles: ChatRole[];
  currentRole: ChatRole;
  setCurrentRole: (role: ChatRole) => void;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  setCurrentSession: (session: ChatSession | null) => void;
  isLoading: boolean;
  isInitialized: boolean;
  sendMessage: (content: string, options?: { imageUri?: string; audioUri?: string }) => Promise<void>;
  clearMessages: () => void;
  createNewChat: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSession: (session: ChatSession) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
}

// 获取后端基础URL
function getBackendBaseUrl(): string {
  // 优先使用环境变量
  const configUrl = Constants.expoConfig?.extra?.backendBaseUrl;
  if (configUrl) return configUrl;
  
  // 开发环境默认地址
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:9091';
  }
  
  return 'http://localhost:9091';
}

const API_BASE_URL = getBackendBaseUrl();

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [roles, setRoles] = useState<ChatRole[]>([]);
  const [currentRole, setCurrentRoleState] = useState<ChatRole>(DEFAULT_ROLE);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 设置当前角色
  const setCurrentRole = useCallback((role: ChatRole) => {
    setCurrentRoleState(role);
  }, []);

  // 加载角色列表
  const loadRoles = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/roles`);
      if (response.ok) {
        const data = await response.json();
        if (data.roles && Array.isArray(data.roles)) {
          const convertedRoles = data.roles.map((role: any) => ({
            id: role.id,
            name: role.name,
            title: role.title,
            avatar: role.avatar,
            themeColor: role.themeColor,
            description: role.description,
            shortDesc: role.shortDesc || '',
            fullDesc: role.description || '',
            systemPrompt: role.systemPrompt,
            growthBackground: role.growthBackground,
            educationBackground: role.educationBackground,
            workBackground: role.workBackground,
            counselingStyle: role.counselingStyle,
            classicQuotes: role.classicQuotes,
          }));
          setRoles(convertedRoles);
        }
      }
    } catch (error) {
      console.error('Failed to load roles from server:', error);
      // 使用本地默认角色
      setRoles(getDefaultRoles());
    }
  }, []);
  
  // 加载会话列表
  const loadSessions = useCallback(async () => {
    const loadedSessions = await getChatSessions();
    setSessions(loadedSessions);
  }, []);
  
  // 初始化加载
  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      await loadRoles();
      const loadedSessions = await getChatSessions();
      if (mounted) {
        setSessions(loadedSessions);
        setIsInitialized(true);
      }
    };
    
    init();
    return () => { mounted = false; };
  }, [loadRoles]);
  
  // 切换角色
  const setCurrentRoleHandler = useCallback((role: ChatRole) => {
    setCurrentRoleState(role);
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
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 添加消息并保存
  const addMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => {
      const newMessages = [...prev, message];
      
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
  
  /**
   * 发送用户消息并获取 AI 回复（非流式）
   * 服务端接口：POST /api/v1/chat
   * Body 参数：systemPrompt: string, messages: Array<{role: string, content: string}>
   */
  const sendMessage = useCallback(async (content: string, options?: { imageUri?: string; audioUri?: string }) => {
    // 创建用户消息
    const userMessage = createMessage('user', content, options);
    addMessage(userMessage);
    setInputText('');
    setIsLoading(true);
    
    // 确保有会话
    let session = currentSession;
    if (!session) {
      session = await createNewSession(currentRole);
      setCurrentSession(session);
    }
    
    // 构建消息历史
    const allMessages = [...messages, userMessage];
    const chatHistory = allMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemPrompt: buildSystemPrompt(currentRole),
          messages: chatHistory,
          model: 'qwen-plus',
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // 添加 AI 回复
      const assistantMessage = createMessage('assistant', data.content || '抱歉，我没有收到回复。');
      addMessage(assistantMessage);
      
    } catch (error) {
      console.error('Failed to send message:', error);
      // 添加错误消息
      const errorMessage = createMessage('assistant', '抱歉，发生了错误，请稍后再试。');
      addMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
    
  }, [currentRole, currentSession, messages, addMessage]);
  
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
    
    // 更新会话列表
    const loadedSessions = await getChatSessions();
    setSessions(loadedSessions);
  }, [currentRole, currentSession, messages]);
  
  // 删除会话
  const deleteSession = useCallback(async (sessionId: string) => {
    await deleteSessionFromStore(sessionId);
    
    // 如果删除的是当前会话，切换到其他会话或创建新会话
    if (currentSession?.id === sessionId) {
      const loadedSessions = await getChatSessions();
      if (loadedSessions.length > 0) {
        loadSession(loadedSessions[0]);
      } else {
        await createNewChat();
      }
      setSessions(loadedSessions);
    } else {
      setSessions(await getChatSessions());
    }
  }, [currentSession, createNewChat]);
  
  // 加载会话
  const loadSession = useCallback((session: ChatSession) => {
    setCurrentSession(session);
    setMessages(session.messages || []);
  }, []);
  
  const value: ChatContextType = {
    messages,
    inputText,
    setInputText,
    roles,
    currentRole,
    setCurrentRole: setCurrentRoleHandler,
    sessions,
    currentSession,
    setCurrentSession,
    isLoading,
    isInitialized,
    sendMessage,
    clearMessages,
    createNewChat,
    deleteSession,
    loadSession,
  };
  
  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}
