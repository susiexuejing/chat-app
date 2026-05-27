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

      // ====== 统一打字机引擎 ======
      const bubbleMsgId = `bubble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      setMessages(prev => [...prev, {
        id: bubbleMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }]);

      setIsThinking(false); // 取消"思考中"指示

      // 打字机状态（闭包变量）
      const textQueue: string[] = [];
      let displayedContent = '';
      let deepTextBuffer = '';
      let isFlowDone = false;
      let isDeepDone = false;
      let hasTransition = false;
      let typingTimer: ReturnType<typeof setTimeout> | null = null;

      // 标点停顿映射
      function getTypingDelay(ch: string): number {
        if (ch === '\n') return 600;
        if (ch === '，' || ch === '、') return 200;
        if (ch === '。' || ch === '？' || ch === '！') return 400;
        return 50;
      }

      // 统一打字机：把文本加入队列，逐字渲染
      function pushToQueue(text: string) {
        for (const ch of text) textQueue.push(ch);
        if (!typingTimer) scheduleNext();
      }

      function scheduleNext() {
        const next = textQueue.shift();

        if (next !== undefined) {
          displayedContent += next;
          setMessages(prev =>
            prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
          );
          const delay = getTypingDelay(next);
          typingTimer = setTimeout(() => { typingTimer = null; scheduleNext(); }, delay);
          return;
        }

        // 队列为空 - 决定下一个要打什么
        if (!isFlowDone) {
          // 首次：把前端流加入队列
          isFlowDone = true;
          pushToQueue(frontFlowText);
          typingTimer = setTimeout(() => { typingTimer = null; scheduleNext(); }, 10);
        } else if (!hasTransition) {
          // 前端流打完 - 检查百炼是否就绪
          hasTransition = true;
          if (deepTextBuffer.length > 0) {
            // 百炼已有内容 → 过渡语 + 深度分析
            pushToQueue('\n\n我们继续往深一层看。\n\n');
            pushToQueue(deepTextBuffer);
            deepTextBuffer = '';
          } else {
            // 百炼还没到 → 显示等待提示
            pushToQueue('\n\n我还在继续理解你刚才那句话……');
          }
          typingTimer = setTimeout(() => { typingTimer = null; scheduleNext(); }, 10);
        } else if (deepTextBuffer.length > 0) {
          // 百炼新内容到达
          const text = deepTextBuffer;
          deepTextBuffer = '';
          // 如果当前显示的是等待提示，替换掉
          if (displayedContent.includes('我还在继续理解')) {
            displayedContent = displayedContent.replace('\n\n我还在继续理解你刚才那句话……', '');
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            pushToQueue('\n\n我们继续往深一层看。\n\n' + text);
          } else {
            pushToQueue(text);
          }
          typingTimer = setTimeout(() => { typingTimer = null; scheduleNext(); }, 10);
        } else if (isDeepDone) {
          // 全部完成
          typingTimer = null;
        } else {
          // 等待百炼更多chunk
          typingTimer = setTimeout(() => { typingTimer = null; scheduleNext(); }, 200);
        }
      }

      // 立即启动百炼流式请求（跟打字机并行）
      (async () => {
        try {
          await chatStream(sessionId, {
            onChunk: (chunk: string) => {
              try {
                const parsed = JSON.parse(chunk);
                if (parsed.content) {
                  deepTextBuffer += parsed.content;
                  // 如果打字机在空闲状态，唤醒它把新内容打出来
                  if (!typingTimer && isFlowDone) {
                    if (!hasTransition) {
                      hasTransition = true;
                      if (displayedContent.includes('我还在继续理解')) {
                        displayedContent = displayedContent.replace('\n\n我还在继续理解你刚才那句话……', '');
                        setMessages(prev =>
                          prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
                        );
                        pushToQueue('\n\n我们继续往深一层看。\n\n' + deepTextBuffer);
                      } else {
                        pushToQueue('\n\n我们继续往深一层看。\n\n' + deepTextBuffer);
                      }
                      deepTextBuffer = '';
                    } else {
                      pushToQueue(deepTextBuffer);
                      deepTextBuffer = '';
                    }
                  }
                }
                if (parsed.done) isDeepDone = true;
              } catch { /* non-JSON chunk, ignore */ }
            },
            onDone: () => { isDeepDone = true; },
            onError: () => { isDeepDone = true; },
          });
        } catch { /* stream error, ignore */ }
      })();

      // 启动打字机
      scheduleNext();

      // 保存当前sessionId
      setCurrentSessionId(sessionId);
      setIsLoading(false);
    } catch (err) {
      console.error('[sendMessage] Error:', err);
      setError(err instanceof Error ? err.message : '请求失败');
      setIsLoading(false);
      setIsThinking(false);
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
