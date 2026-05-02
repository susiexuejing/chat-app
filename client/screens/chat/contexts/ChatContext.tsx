/**
 * 聊天上下文 Provider
 * 管理聊天状态：当前角色、消息列表、会话管理、输入状态等
 * 
 * 对接百炼 API：POST /api/v1/chat/stream
 * 文档：https://help.aliyun.com/zh/model-studio/qwen-omni
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
import RNSSE, { MessageEvent, ErrorEvent, EventSource } from 'react-native-sse';

const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

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
  
  // 发送消息（用户输入）- 支持流式
  sendMessage: (content: string, options?: { imageUri?: string; audioUri?: string }) => Promise<void>;
  
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
  
  // 刷新角色列表
  loadRoles: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setCurrentRoleState] = useState<ChatRole>(DEFAULT_ROLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [roles, setRoles] = useState<ChatRole[]>(THERAPIST_ROLES);
  
  // SSE 连接引用
  const sseRef = useRef<EventSource | null>(null);
  
  // 保存当前会话消息的防抖定时器
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 加载角色列表（从后端获取）
  const loadRoles = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/roles`);
      if (response.ok) {
        const data = await response.json();
        if (data.roles && Array.isArray(data.roles)) {
          // 转换后端角色格式为前端格式
          const convertedRoles: ChatRole[] = data.roles.map((role: {
            id: string;
            name: string;
            title?: string;
            description?: string;
            systemPrompt: string;
            themeColor?: string;
            avatar?: string;
          }) => ({
            id: role.id,
            name: role.name,
            avatar: role.avatar || 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&h=200&fit=crop',
            shortDesc: role.title || '',
            fullDesc: role.description || '',
            systemPrompt: role.systemPrompt,
            accentColor: role.themeColor || '#10B981',
          }));
          setRoles(convertedRoles);
        }
      }
    } catch (error) {
      console.error('Failed to load roles from server:', error);
      // 使用默认角色列表
      setRoles(THERAPIST_ROLES);
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
      // 加载角色列表
      await loadRoles();
      
      // 加载会话列表
      const loadedSessions = await getChatSessions();
      if (mounted) {
        setSessions(loadedSessions);
      }
    };
    
    init();
    return () => { mounted = false; };
  }, [loadRoles]);
  
  // 切换角色
  const setCurrentRole = useCallback((role: ChatRole) => {
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
  
  /**
   * 发送用户消息并获取 AI 回复（流式）
   * 服务端接口：POST /api/v1/chat/stream
   * Body 参数：systemPrompt: string, messages: Array<{role: string, content: string}>
   * 
   * 使用 react-native-sse 处理 SSE 流式响应
   * 文档参考：expo-advanced/references/audio-record-play.md
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
    
    // 创建 AI 消息占位
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage = createMessage('assistant', '');
    assistantMessage.id = assistantMessageId;
    
    // 先添加空消息用于流式更新
    setMessages(prev => [...prev, assistantMessage]);
    
    // 构建消息历史（用于发送给后端）
    const allMessages = [...messages, userMessage];
    const chatHistory = allMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    
    // 使用 react-native-sse 进行流式请求
    const url = `${API_BASE_URL}/api/v1/chat/stream`;
    
    // 关闭之前的连接
    if (sseRef.current) {
      sseRef.current.close();
    }
    
    const sse = new RNSSE(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemPrompt: currentRole.systemPrompt,
        messages: chatHistory,
        model: 'qwen-plus',
      }),
    });
    
    sseRef.current = sse;
    let fullContent = '';
    
    // 监听消息事件
    sse.addEventListener('message', (event: MessageEvent) => {
      if (event.data === '[DONE]') {
        // 流结束
        sse.close();
        
        // 确保消息以句号或换行结尾
        if (fullContent && !fullContent.trim().match(/[。！？.!?\n]$/)) {
          fullContent += '。';
        }
        
        setMessages(prev => 
          prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, content: fullContent }
              : msg
          )
        );
        return;
      }
      
      try {
        const parsed = JSON.parse(event.data || '{}');
        if (parsed.content) {
          fullContent += parsed.content;
          // 实时更新消息内容
          setMessages(prev => 
            prev.map(msg => 
              msg.id === assistantMessageId 
                ? { ...msg, content: fullContent }
                : msg
            )
          );
        }
        if (parsed.error) {
          console.error('Stream error:', parsed.error);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    // 监听错误事件
    sse.addEventListener('error', (event: ErrorEvent) => {
      console.error('SSE error:', event.message);
      sse.close();
      
      // 添加错误消息
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: '抱歉，发生了错误，请稍后再试。' }
            : msg
        )
      );
      setIsLoading(false);
    });
    
    // 监听关闭事件
    sse.addEventListener('close', () => {
      setIsLoading(false);
    });
    
  }, [currentRole, currentSession, messages, addMessage]);
  
  // AI 回复（非流式，仅在流式失败时使用）
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
    const role = roles.find(r => r.id === session.roleId) || DEFAULT_ROLE;
    setCurrentRole(role);
    setCurrentSession(session);
    setMessages(session.messages);
    setShowHistory(false);
  }, [currentSession, messages, roles]);
  
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
  
  // 组件卸载时清理 SSE 连接
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, []);
  
  const value: ChatContextValue = {
    currentRole,
    setCurrentRole,
    roles,
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
    loadRoles,
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
