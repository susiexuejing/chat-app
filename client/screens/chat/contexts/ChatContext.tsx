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
    if (role) setCurrentRole(role);
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
        // ====== 第一阶段：调用 /chat/start 获取 EmotionFlow 三层内容 ======
        const sessionInfo = await chatStart(
          currentRole.id,
          userMessage
        );

        const { sessionId, reactionLayer, companionLayer, frontFlowText, reactionTimeline, companionTimeline } = sessionInfo;

        // ====== 第二阶段：EmotionFlow V3 动态缓冲引擎 ======
        // Reaction（8s→18s→30s）→ Companion（动态填充，Deep就绪时立即切断接管）
        const bubbleMsgId = `bubble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 初始内容：Reaction第一段 或 fallback
        const firstReaction = reactionTimeline?.[0]?.text || reactionLayer || frontFlowText || '';
        let displayedContent = firstReaction;
        const chatStartTime = Date.now();

        setMessages(prev => [...prev, {
          id: bubbleMsgId,
          role: 'assistant',
          content: firstReaction,
          timestamp: Date.now(),
        }]);

        setIsThinking(false);

        // ── 打字机引擎状态（闭包变量）──
        const textQueue: string[] = [];
        let typingTimer: ReturnType<typeof setTimeout> | null = null;

        // 状态标记
        const timelineSchedules: ReturnType<typeof setTimeout>[] = []; // 所有时间线定时器
        let isDeepStarted = false;    // 收到过百炼chunk
        let isDeepDone = false;       // 百炼全部完成
        let isWaiting = false;        // 等待文案正在显示
        let waitingPos = -1;          // 等待文案在displayedContent中的起始位置
        let deepBuffer = '';          // 等待期间百炼chunk缓存
        const isNormalChat = !reactionTimeline && !companionTimeline; // 无时间线 = normal_chat

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

          // ═══ 队列为空 ═══

          // 刚打完一段Companion，deep已就绪且缓存在buffer中 → 刷出deep
          if (isDeepStarted && deepBuffer) {
            const content = deepBuffer;
            deepBuffer = '';
            displayedContent += '\n\n' + content;
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            console.log(`[Deep] typing结束后追加deep: ${Date.now() - chatStartTime}ms`);
            scheduleNext();
            return;
          }

          // ====== 队列为空 — 所有展示内容完成后 → 进入等待 ======
          if (!isDeepStarted && !isDeepDone && !isWaiting && !isNormalChat) {
            isWaiting = true;
            waitingPos = displayedContent.length;
            pushToQueue('\n\n我还在继续理解你刚才那句话……');
            return;
          }

          if (isWaiting && isDeepStarted) {
            // 百炼到达，结束等待 → 清除等待文案 + 追加过渡 + 释放缓存的百炼内容
            isWaiting = false;
            displayedContent = displayedContent.substring(0, waitingPos);
            waitingPos = -1;
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            const transition = '\n\n';
            const toPush = deepBuffer ? transition + deepBuffer : transition;
            deepBuffer = '';
            pushToQueue(toPush);
            return;
          }

          // 队列空且没有新内容 → 安静等待
        }

        // ── 调度时间线：根据 displayAt 定时推送 Reactions + Companions ──
        function scheduleTimeline() {
          const allSegments: { displayAt: number; text: string; type: 'reaction' | 'companion' }[] = [];

          if (reactionTimeline && Array.isArray(reactionTimeline)) {
            for (const seg of reactionTimeline) {
              if (seg.displayAt <= 0) continue; // 第1段已在初始内容中
              allSegments.push({ ...seg, type: 'reaction' });
            }
          }

          if (companionTimeline && Array.isArray(companionTimeline)) {
            for (const seg of companionTimeline) {
              allSegments.push({ ...seg, type: 'companion' });
            }
          }

          if (allSegments.length === 0 && companionLayer) {
            // 无时间线但有关键词版单句Companion → 2s后备
            timelineSchedules.push(setTimeout(() => {
              pushToQueue('\n' + companionLayer);
            }, 2000));
            return;
          }

          if (allSegments.length === 0) return; // 无内容可调度

          for (const seg of allSegments) {
            const elapsed = Date.now() - chatStartTime;
            const delayMs = Math.max(0, seg.displayAt * 1000 - elapsed);
            timelineSchedules.push(setTimeout(() => {
              pushToQueue('\n' + seg.text);
            }, delayMs));
          }
        }

        // 启动时间线调度
        scheduleTimeline();

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
                      const now = Date.now();
                      console.log(`[Deep] 首次chunk到达: ${now - chatStartTime}ms`);

                      // 1. 清空所有未触发的时间线定时器（取消未来companion段）
                      const timersCancelled = timelineSchedules.length;
                      timelineSchedules.forEach(t => clearTimeout(t));
                      timelineSchedules.length = 0;
                      console.log(`[Deep] 取消未触发的timers: ${timersCancelled}个`);

                      // 2. 清空待播队列中未展示的内容（不打断当前typing）
                      const queueCancelled = textQueue.length;
                      textQueue.length = 0;
                      console.log(`[Deep] 清空待播队列: ${queueCancelled}项`);

                      // 3. 如果当前正在打字（某段Companion还没打完）→ 缓存deep，等当前段打完再展示
                      if (typingTimer) {
                        deepBuffer = parsed.content;
                        console.log(`[Deep] 当前正在typing，缓存deep，等当前段打完`);
                        return;
                      }

                      // 4. 如果正在显示等待提示 → 替换等待提示为deep
                      if (isWaiting) {
                        isWaiting = false;
                        displayedContent = displayedContent.substring(0, waitingPos);
                        waitingPos = -1;
                        setMessages(prev =>
                          prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
                        );
                        const transition = '\n\n';
                        const toPush = deepBuffer ? transition + deepBuffer : transition + parsed.content;
                        deepBuffer = '';
                        pushToQueue(toPush);
                        console.log(`[Deep] 替换等待提示: ${now - chatStartTime}ms`);
                        return;
                      }

                      // 5. 不在打字，不在等待 → 直接追加deep
                      displayedContent += '\n\n' + parsed.content;
                      setMessages(prev =>
                        prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
                      );
                      console.log(`[Deep] 直接追加到气泡: ${now - chatStartTime}ms`);
                      return;
                    }
                    if (isWaiting) {
                      // ★ 等待期间：缓存到 deepBuffer，不入队（防止混入 displayedContent 被截断）
                      deepBuffer += parsed.content;
                    } else {
                      pushToQueue(parsed.content);
                    }
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