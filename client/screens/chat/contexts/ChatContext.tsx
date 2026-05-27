import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PsychologistRole, DEFAULT_ROLES } from '../constants/roles';
import { ChatMessage, ChatSession, LightAnalysisResult, DeepAnalysisData } from '../types';
import { analyzeText } from '../utils/textAnalyzer';
import { chatStart, chatStream, ChatStartResponse } from '../api/cozeApi';

interface ChatContextValue {
  messages: ChatMessage[];
  sessions: ChatSession[];
  currentRole: PsychologistRole | null;
  currentSessionId: string | null;
  isLoading: boolean;
  isThinking: boolean;
  thinkingContent: string;
  error: string | null;
  showHistory: boolean;
  lightAnalysis: LightAnalysisResult | null;
  inputText: string;
  showRoleIntro: boolean;
  deepThinkingContent: string; // Deep 分析流式思考内容
  roles: PsychologistRole[];
  onSelectRole?: (role: PsychologistRole) => void;
  onShowIntro?: () => void;
  setShowRoleIntro: (show: boolean) => void;
  setShowHistory: (show: boolean) => void;
  sendMessage: (content: string) => Promise<void>;
  setLightAnalysis: (analysis: LightAnalysisResult | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setInputText: (text: string) => void;
  setCurrentRole: (role: PsychologistRole | null) => void;
  clearError: () => void;
  createNewChat: (role?: PsychologistRole) => void;
  loadSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  currentSession: ChatSession | null;
}

const STORAGE_KEY = 'chat_sessions';

export const ChatContext = createContext<ChatContextValue>({
  messages: [],
  sessions: [],
  currentRole: null,
  currentSessionId: null,
  isLoading: false,
  isThinking: false,
  thinkingContent: '',
  error: null,
  showHistory: false,
  lightAnalysis: null,
  inputText: '',
  showRoleIntro: false,
  deepThinkingContent: '',
  roles: DEFAULT_ROLES,
  onSelectRole: undefined,
  onShowIntro: undefined,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setShowRoleIntro: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setShowHistory: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setMessages: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setInputText: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setLightAnalysis: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setCurrentRole: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  createNewChat: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  loadSession: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  deleteSession: async () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  clearError: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  sendMessage: async () => {},
  currentSession: null,
});

export const useChat = () => useContext(ChatContext);

interface ChatProviderProps {
  children: ReactNode;
  onSelectRole?: (role: PsychologistRole) => void;
  onShowIntro?: () => void;
}

export function ChatProvider({ children, onSelectRole, onShowIntro }: ChatProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // 默认选择第一个角色（聪明狐狸）
  const [currentRole, setCurrentRole] = useState<PsychologistRole | null>(DEFAULT_ROLES[0]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lightAnalysis, setLightAnalysis] = useState<LightAnalysisResult | null>(null);
  const [inputText, setInputText] = useState('');
  const [showRoleIntro, setShowRoleIntro] = useState(false);
  // Deep 分析流式思考内容（用于打字机效果）
  const [deepThinkingContent, setDeepThinkingContent] = useState('');
  const roles = DEFAULT_ROLES;

  const currentSession = sessions.find(s => s.id === currentSessionId) || null;

  // Save sessions to storage
  const saveSessionsToStorage = useCallback(async (newSessions: ChatSession[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSessions));
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  }, []);

  // Load sessions from storage on mount
  useEffect(() => {
    const loadSessionsFromStorage = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          setSessions(JSON.parse(stored));
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    };
    loadSessionsFromStorage();
  }, []);

  const createNewChat = useCallback((role?: PsychologistRole) => {
    const targetRole = role || currentRole;
    if (!targetRole) return;
    
    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      roleId: targetRole.id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions(prev => {
      const updated = [newSession, ...prev];
      saveSessionsToStorage(updated);
      return updated;
    });

    setCurrentSessionId(newSession.id);
    setCurrentRole(targetRole);
    setMessages([]);
    setLightAnalysis(null);
    setError(null);
    setShowHistory(false);
  }, [saveSessionsToStorage, currentRole]);

  const loadSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === sessionId);
      if (session) {
        const role = DEFAULT_ROLES.find(r => r.id === session.roleId) || null;
        setCurrentSessionId(session.id);
        setCurrentRole(role);
        setMessages(session.messages);
        setLightAnalysis(null);
        setError(null);
        setShowHistory(false);
      }
      return prev;
    });
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== sessionId);
      saveSessionsToStorage(updated);
      
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
        setCurrentRole(null);
      }
      return updated;
    });
  }, [currentSessionId, saveSessionsToStorage]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // 打字机效果定时器引用
  const typingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!currentRole || !userMessage.trim()) return;

    // 清理之前的打字机定时器
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setDeepThinkingContent('');
    setError(null);
    setIsLoading(true);

    try {
      // ====== 第一阶段：调用 /chat/start 获取前端流 ======
      const startResponse: ChatStartResponse = await chatStart(
        currentRole.id,
        userMessage
      );

      const { sessionId, frontFlowText } = startResponse;

      // ====== 第二阶段：单气泡打字机效果 ======
      const bubbleMsgId = `bubble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const bubbleMsg: ChatMessage = {
        id: bubbleMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, bubbleMsg]);

      // 打字机效果：逐字连续渲染
      let charIndex = 0;
      const charsPerTick = 3;   // 每 tick 渲染 3 个字
      const tickMs = 30;        // 每 30ms 渲染一次
      typingTimerRef.current = setInterval(() => {
        charIndex += charsPerTick;
        if (charIndex >= frontFlowText.length) {
          charIndex = frontFlowText.length;
          if (typingTimerRef.current) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
        }
        setMessages(prev =>
          prev.map(m =>
            m.id === bubbleMsgId
              ? { ...m, content: frontFlowText.slice(0, charIndex) }
              : m
          )
        );
      }, tickMs);

      // ====== 第三阶段：百炼结果追加 ======
      // 等打字机结束后，再请求百炼
      const typingDuration = (frontFlowText.length / charsPerTick) * tickMs + 500;

      setTimeout(async () => {
        // 确保打字机完成
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        // 设置最终完整文本
        setMessages(prev =>
          prev.map(m =>
            m.id === bubbleMsgId
              ? { ...m, content: frontFlowText }
              : m
          )
        );

        setIsThinking(true);

        try {
          let deepReceived = false;
          await chatStream(sessionId, {
            onChunk: (chunk) => {
              try {
                const parsed = JSON.parse(chunk);
                if (parsed.content) {
                  const transition = deepReceived ? '' : '\n\n我们继续往深一层看。\n\n';
                  deepReceived = true;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === bubbleMsgId
                        ? { ...m, content: frontFlowText + transition + parsed.content }
                        : m
                    )
                  );
                }
              } catch {
                // 非 JSON，尝试追加 raw text
                const transition = deepReceived ? '' : '\n\n我们继续往深一层看。\n\n';
                deepReceived = true;
                setMessages(prev =>
                  prev.map(m =>
                    m.id === bubbleMsgId
                      ? { ...m, content: frontFlowText + transition + chunk }
                      : m
                  )
                );
              }
            },
            onDone: () => {
              setIsThinking(false);
              setIsLoading(false);
              // 保存会话
              if (currentSessionId) {
                setSessions(prev => {
                  const allMsgs: ChatMessage[] = [];
                  setMessages(m => { allMsgs.push(...m); return m; });
                  const updated = prev.map(s => {
                    if (s.id === currentSessionId) {
                      return { ...s, messages: allMsgs, updatedAt: Date.now() };
                    }
                    return s;
                  });
                  saveSessionsToStorage(updated);
                  return updated;
                });
              }
            },
            onError: (error) => {
              console.error('[chatStream] Error:', error);
              setIsThinking(false);
              setIsLoading(false);
              setError(typeof error === 'string' ? error : error?.message || '连接失败');
            }
          });
        } catch (streamErr) {
          setIsThinking(false);
          setIsLoading(false);
          setError(streamErr instanceof Error ? streamErr.message : '流式请求失败');
        }
      }, typingDuration);

    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : '发送失败');
    }
  }, [currentRole, currentSessionId, saveSessionsToStorage]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        sessions,
        currentRole,
        currentSessionId,
        isLoading,
        isThinking,
        thinkingContent,
        error,
        showHistory,
        lightAnalysis,
        inputText,
        showRoleIntro,
        roles,
        deepThinkingContent,
        onSelectRole,
        onShowIntro,
        setShowRoleIntro,
        setShowHistory,
        setMessages,
        setInputText,
        setLightAnalysis,
        setCurrentRole,
        createNewChat,
        loadSession,
        deleteSession,
        clearError,
        sendMessage,
        currentSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => useContext(ChatContext);
