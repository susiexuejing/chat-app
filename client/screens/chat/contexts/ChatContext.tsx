import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { getRoleById, roles, PsychologistRole } from '../constants/roles';
import { chatStart, chatStream } from '../api/cozeApi';


interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  roleId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatContextValue {
  messages: ChatMessage[];
  sessions: ChatSession[];
  currentRole: (typeof roles)[0];
  currentSessionId: string | null;
  isLoading: boolean;
  isThinking: boolean;
  thinkingContent: string;
  error: string | null;
  showHistory: boolean;
  lightAnalysis: string;
  inputText: string;
  showRoleIntro: boolean;
  roles: typeof roles;
  setInputText: (text: string) => void;
  setCurrentRole: (role: (typeof roles)[0]) => void;
  setShowRoleIntro: (show: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
  setShowHistory: (show: boolean) => void;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  createNewChat: (role?: PsychologistRole) => void;
  currentSession: ChatSession | undefined;
  loadSession: (sessionId: string) => void;
  deepThinkingContent: string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<(typeof roles)[0]>(roles[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lightAnalysis, setLightAnalysis] = useState('');
  const [inputText, setInputText] = useState('');
  const [showRoleIntro, setShowRoleIntro] = useState(true);



  // 保存会话
  /* sessions persistence skipped */

  const createNewChat = useCallback((role?: PsychologistRole) => {
    setMessages([]);
    setCurrentSessionId(null);
    setError(null);
    setIsLoading(false);
    setIsThinking(false);
    setThinkingContent('');
    setLightAnalysis('');
  }, []);

  const selectSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        setMessages(session.messages);
        setCurrentSessionId(session.id);
        const role = getRoleById(session.roleId);
        if (role) setCurrentRole(role);
        setShowHistory(false);
      }
    },
    [sessions]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const updated = sessions.filter((s) => s.id !== sessionId);
      setSessions(updated);
      if (currentSessionId === sessionId) {
        createNewChat();
      }
    },
    [sessions, currentSessionId, createNewChat]
  );

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim() || !currentRole) return;

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg]);
      setIsThinking(true);
      setIsLoading(true);
      setError(null);
      setLightAnalysis('');

      try {
        // ====== 第一阶段：调用 /chat/start 获取前端流 ======
        const sessionInfo = await chatStart(
          currentRole.id,
          userMessage
        );

        const { sessionId, frontFlowText } = sessionInfo;

        // ====== 第二阶段：统一打字机引擎 ======
        const bubbleMsgId = `bubble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        setMessages(prev => [...prev, {
          id: bubbleMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        }]);

        setIsThinking(false);

        // ── 打字机引擎状态（闭包变量）──
        const textQueue: string[] = [];
        let displayedContent = '';
        let typingTimer: ReturnType<typeof setTimeout> | null = null;

        // 状态标记
        let isFlowQueued = false;       // 前端流已进入队列
        let isFlowDone = false;         // 前端流全部打完
        let isDeepStarted = false;      // 收到过百炼chunk
        let isDeepDone = false;         // 百炼全部完成
        let isWaiting = false;          // 等待文案正在显示
        let waitingPos = -1;            // 等待文案在displayedContent中的起始位置

        // ── 打字速度配置 ──
        function getTypingDelay(ch: string): number {
          if (ch === '\n') return 600;
          if (ch === '，' || ch === '、') return 180;
          if (ch === '。' || ch === '？' || ch === '！') return 350;
          if (/[a-z0-9]/i.test(ch)) return 25;
          return 45;
        }

        // ── 核心：把文本加入队列 ──
        function pushToQueue(text: string) {
          for (const ch of text) textQueue.push(ch);
          scheduleNext();
        }

        // ── 核心：从队列取出一个字渲染 ──
        function scheduleNext() {
          if (typingTimer) return; // 正在渲染中，新内容已入队

          const ch = textQueue.shift();

          if (ch !== undefined) {
            displayedContent += ch;
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            const delay = getTypingDelay(ch);
            typingTimer = setTimeout(() => {
              typingTimer = null;
              scheduleNext();
            }, delay);
            return;
          }

          // ====== 队列为空 — 决策下一步 ======
          if (!isFlowQueued) {
            isFlowQueued = true;
            pushToQueue(frontFlowText);
            return;
          }

          if (!isFlowDone) {
            isFlowDone = true;
            scheduleNext();
            return;
          }

          if (!isDeepStarted && !isDeepDone && !isWaiting) {
            // 前端流打完，百炼还没到 → 显示等待
            isWaiting = true;
            waitingPos = displayedContent.length;
            pushToQueue('\n\n我还在继续理解你刚才那句话……');
            return;
          }

          if (isWaiting && isDeepStarted) {
            // 百炼开始回来了，但等待文案还在队列里 → 移除等待
            isWaiting = false;
            displayedContent = displayedContent.substring(0, waitingPos);
            waitingPos = -1;
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            pushToQueue('我们继续往深一层看。\n\n');
            return;
          }

          // 队列空且没有新内容 → 安静等待
        }

        // ── 并行：启动百炼流式 ──
        (async () => {
          try {
            await chatStream(sessionId, {
              onChunk: (chunk: string) => {
                try {
                  const parsed = JSON.parse(chunk);
                  if (parsed.content) {
                    if (!isDeepStarted) {
                      isDeepStarted = true;
                    }
                    pushToQueue(parsed.content);
                  }
                  if (parsed.done) {
                    isDeepDone = true;
                    scheduleNext();
                  }
                } catch { /* ignore */ }
              },
              onDone: () => {
                isDeepDone = true;
                scheduleNext();
              },
              onError: () => {
                isDeepDone = true;
                scheduleNext();
              },
            });
          } catch { /* ignore */ }
        })();

        // ── 启动打字机 ──
        scheduleNext();

        setCurrentSessionId(sessionId);
        setIsLoading(false);
      } catch (err) {
        console.error('[sendMessage] Error:', err);
        setError(err instanceof Error ? err.message : '请求失败');
        setIsLoading(false);
        setIsThinking(false);
      }
    },
    [currentRole, currentSessionId]
  );

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const loadSessionFn = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const role = roles.find(r => r.id === session.roleId);
    setCurrentRole(role || roles[0]);
    setCurrentSessionId(session.id);
    setMessages(session.messages);
  }, [sessions]);

  const deepThinkingContent = '';

  return (
    <ChatContext.Provider
      value={{
        messages,
        sessions,
        currentRole,
        currentSessionId,
        currentSession,
        isLoading,
        isThinking,
        thinkingContent,
        deepThinkingContent,
        error,
        showHistory,
        lightAnalysis,
        inputText,
        showRoleIntro,
        roles,
        setInputText,
        setCurrentRole,
        setShowRoleIntro,
        sendMessage,
        clearError: () => setError(null),
        setShowHistory,
        selectSession,
        deleteSession,
        createNewChat,
        loadSession: loadSessionFn,
      }}
    >
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