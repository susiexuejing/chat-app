import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatWithDashScope } from '../api/cozeApi';
import { getDefaultRoles, PsychologistRole } from '../constants/roles';
import { ChatMessage, ChatSession } from '../types';

// Context 类型
export interface ChatContextType {
  messages: ChatMessage[];
  inputText: string;
  setInputText: (text: string) => void;
  currentRole: PsychologistRole;
  setCurrentRole: (role: PsychologistRole) => void;
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
  setCurrentRole: () => {},
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

// 导出 useChat hook
export function useChat() {
  return useContext(ChatContext);
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [roles] = useState<PsychologistRole[]>(getDefaultRoles());
  const [currentRole, setCurrentRole] = useState<PsychologistRole>(getDefaultRoles()[0]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // 保存当前会话（只有消息数 >= 1 时才保存）
    if (currentSession && messages.length >= 1) {
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

  // 加载会话
  const loadSession = useCallback((session: ChatSession) => {
    setCurrentSession(session);
    setMessages(session.messages || []);
    
    // 设置对应的角色
    const role = roles.find(r => r.id === session.roleId);
    if (role) {
      setCurrentRole(role);
    }
  }, [roles]);

  // 删除会话
  const deleteSession = useCallback(async (sessionId: string) => {
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
    
    // 只有当消息数量 >= 1 时才创建/保存会话
    // （第一条消息时不创建会话，只有第二条消息开始才保存）
    let session = currentSession;
    const shouldSaveHistory = messages.length >= 1;
    
    if (shouldSaveHistory && !session) {
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
      // 调用百炼 API（直接通过后端）
      // 注意：传递 newMessages（包含新用户消息），而不是旧的 messages
      await chatWithDashScope(
        currentRole.systemPrompt,
        newMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        currentRole.name,
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
      
      // 只有当消息数量 >= 1 时才保存到历史记录
      if (shouldSaveHistory && session) {
        debouncedSaveMessages(session.id, newMessages);
      }
      
    } catch (error: any) {
      console.error('Failed to send message:', error);
      setError(error.message || '发送失败，请稍后再试');
    } finally {
      setIsLoading(false);
    }
  }, [messages, currentRole, currentSession, debouncedSaveMessages]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        inputText,
        setInputText,
        currentRole,
        setCurrentRole,
        roles,
        currentSession,
        sessions,
        isLoading,
        error,
        createNewChat,
        loadSession,
        sendMessage,
        deleteSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
