import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatWithCoze } from '../api/cozeApi';
import { getDefaultRoles, PsychologistRole } from '../constants/roles';
import { ChatMessage, ChatSession } from '../types';

// Context 类型
export interface ChatContextType {
  messages: ChatMessage[];
  inputText: string;
  setInputText: (text: string) => void;
  currentRole: PsychologistRole;
  roles: PsychologistRole[];
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  isLoading: boolean;
  error: string | null;
  createNewChat: () => Promise<void>;
  loadSession: (session: ChatSession) => void;
  sendMessage: (content: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

// Coze Bot 配置
const COZE_BOT_ID = '7635592039983644682';

// 获取 Coze API Token
function getCozeToken(): string {
  const configToken = Constants.expoConfig?.extra?.cozeToken;
  if (configToken) return configToken;
  return 'pat_PQ6QGqmJ6cqlxSJKRTgzI883P7unwnOn0bApEBzm4DA1wyXy2ibq6adYc6ntqyLq';
}

const COZE_TOKEN = getCozeToken();

// 获取会话列表（从 AsyncStorage）
async function getChatSessions(): Promise<ChatSession[]> {
  try {
    const data = await AsyncStorage.getItem('chat_sessions');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// 保存会话列表
async function saveChatSessions(sessions: ChatSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem('chat_sessions', JSON.stringify(sessions));
  } catch (error) {
    console.error('Failed to save sessions:', error);
  }
}

// 创建新会话
async function createNewSession(role: PsychologistRole): Promise<ChatSession> {
  const sessions = await getChatSessions();
  const newSession: ChatSession = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    roleId: role.id,
    roleName: role.name,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.unshift(newSession);
  await saveChatSessions(sessions);
  return newSession;
}

// 更新会话消息
async function updateSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
  const sessions = await getChatSessions();
  const index = sessions.findIndex(s => s.id === sessionId);
  if (index !== -1) {
    sessions[index].messages = messages;
    sessions[index].updatedAt = Date.now();
    await saveChatSessions(sessions);
  }
}

// 删除会话
async function deleteSessionFromStore(sessionId: string): Promise<void> {
  const sessions = await getChatSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  await saveChatSessions(filtered);
}

// 空的 Context（eslint-disable 忽略空方法，因为只是默认值）
/* eslint-disable @typescript-eslint/no-empty-function */
const emptyContext: ChatContextType = {
  messages: [],
  inputText: '',
  setInputText: () => {},
  currentRole: getDefaultRoles()[0],
  roles: [],
  currentSession: null,
  sessions: [],
  isLoading: false,
  error: null,
  createNewChat: async () => {},
  loadSession: () => {},
  sendMessage: async () => {},
  deleteSession: async () => {},
};
/* eslint-enable @typescript-eslint/no-empty-function */

export const ChatContext = createContext<ChatContextType>(emptyContext);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [roles] = useState<PsychologistRole[]>(getDefaultRoles());
  const [currentRole, setCurrentRole] = useState<PsychologistRole>(getDefaultRoles()[0]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coze 会话 ID
  const conversationIdRef = useRef<string | null>(null);
  // 保存定时器
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化加载
  useEffect(() => {
    const loadInitialData = async () => {
      const loadedSessions = await getChatSessions();
      setSessions(loadedSessions);
    };
    loadInitialData();
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

  // 新建对话
  const createNewChat = useCallback(async () => {
    // 保存当前会话
    if (currentSession && messages.length > 0) {
      await updateSessionMessages(currentSession.id, messages);
    }
    
    // 创建新会话
    const newSession = await createNewSession(currentRole);
    setCurrentSession(newSession);
    setMessages([]);
    conversationIdRef.current = null;
    
    const loadedSessions = await getChatSessions();
    setSessions(loadedSessions);
  }, [currentRole, currentSession, messages]);

  // 加载会话
  const loadSession = useCallback((session: ChatSession) => {
    setCurrentSession(session);
    setMessages(session.messages || []);
    conversationIdRef.current = null;
    
    // 设置对应的角色
    const role = roles.find(r => r.id === session.roleId);
    if (role) {
      setCurrentRole(role);
    }
  }, [roles]);

  // 删除会话
  const deleteSessionFn = useCallback(async (sessionId: string) => {
    await deleteSessionFromStore(sessionId);
    
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
  }, [currentSession, loadSession, createNewChat]);

  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    
    // 创建用户消息
    const userMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsLoading(true);
    setError(null);
    
    // 确保有会话
    let session = currentSession;
    if (!session) {
      session = await createNewSession(currentRole);
      setCurrentSession(session);
      const loadedSessions = await getChatSessions();
      setSessions(loadedSessions);
    }
    
    // 创建占位 AI 消息
    const assistantMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 10)}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, assistantMessage]);
    
    try {
      // 调用 Coze API
      const response = await chatWithCoze(
        COZE_BOT_ID,
        content,
        conversationIdRef.current || undefined,
        (chunk: string) => {
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              return prev.map((m, i) => 
                i === prev.length - 1 
                  ? { ...m, content: m.content + chunk }
                  : m
              );
            }
            return prev;
          });
        }
      );
      
      // 保存会话 ID
      if (response && response.conversation_id) {
        conversationIdRef.current = response.conversation_id;
      }
      
      // 保存消息到本地
      debouncedSaveMessages(session.id, newMessages);
      
    } catch (error: any) {
      console.error('Failed to send message:', error);
      setError(error.message || '发送失败，请稍后再试');
      
      // 替换最后的空消息为错误消息
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          return prev.map((m, i) => 
            i === prev.length - 1 
              ? { ...m, content: `抱歉，发生了错误：${error.message || '请稍后再试'}` }
              : m
          );
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
    
  }, [currentRole, currentSession, messages, debouncedSaveMessages]);

  const value: ChatContextType = {
    messages,
    inputText,
    setInputText,
    roles,
    currentRole,
    currentSession,
    sessions,
    isLoading,
    error,
    createNewChat,
    loadSession,
    sendMessage,
    deleteSession: deleteSessionFn,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
