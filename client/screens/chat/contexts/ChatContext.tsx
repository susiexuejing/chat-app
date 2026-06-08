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
  chatPhase: 'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done';
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
  const [chatPhase, setChatPhase] = useState<'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done'>('idle');
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
      setChatPhase('responding');
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
        let deepBuffer = '';          // 等待期间百炼chunk缓存
        let remainingCompanionChain: { text: string; delay: number }[] = []; // 链式待播companion段，delay是打字完成后的额外等待
        const isNormalChat = !reactionTimeline && !companionTimeline; // 无时间线 = normal_chat

        // ── 打字速度配置 ──
        function getTypingDelay(ch: string): number {
          if (ch === '\n') return 600;
          if (ch === '，' || ch === '、') return 180;
          if (ch === '。' || ch === '？' || ch === '！') return 350;
          if (/[a-z0-9]/i.test(ch)) return 25;
          return 45;
        }

        // ── Deep 段落化显示：按自然段分批出现，每段1.5s ──
        function showDeepByParagraphs(fullText: string) {
          const paragraphs = fullText.split('\n\n').filter(p => p.trim());
          if (paragraphs.length === 0) {
            setChatPhase('done');
            return;
          }

          let pIdx = 0;
          function showNextPara() {
            displayedContent += (pIdx === 0 ? '' : '\n\n') + paragraphs[pIdx];
            setMessages(prev =>
              prev.map(m => m.id === bubbleMsgId ? { ...m, content: displayedContent } : m)
            );
            pIdx++;
            if (pIdx < paragraphs.length) {
              setTimeout(showNextPara, 1500);
            } else {
              setChatPhase('done');
            }
          }
          setChatPhase('deep_arriving');
          showNextPara();
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

          // 刚打完一段，deep已就绪且缓存在buffer中 → 按自然段分批显现
          if (isDeepStarted && deepBuffer) {
            const content = deepBuffer;
            deepBuffer = '';
            console.log(`[Deep] typing结束后追加deep: ${Date.now() - chatStartTime}ms`);
            showDeepByParagraphs(content);
            return;
          }

          // 队列为空 → 检查是否有剩余的companion段（链式触发）
          if (!isDeepStarted && !isDeepDone && !isNormalChat) {
            if (remainingCompanionChain.length > 0) {
              const next = remainingCompanionChain.shift()!;
              setChatPhase('companion');
              // 当前段打字完成后，等 0.8s 再开始下一段（自然呼吸感）
              setTimeout(() => {
                pushToQueue('\n' + next.text);
              }, next.delay);
              return;
            }
            // 所有companion段都播完了，deep还未到达 → 进入等待deep阶段
            setChatPhase('waiting_deep');
            return;
          }

          // 队列空且没有新内容 → 安静等待
        }

        // ── 调度时间线：Reaction 固定定时 + Companion 链式触发 ──
        function scheduleTimeline() {
          const reactionSegs: { displayAt: number; text: string }[] = [];
          const companionSegs: { displayAt: number; text: string }[] = [];

          if (reactionTimeline && Array.isArray(reactionTimeline)) {
            for (const seg of reactionTimeline) {
              if (seg.displayAt <= 0) continue; // 第1段已在初始内容中
              reactionSegs.push(seg);
            }
          }

          if (companionTimeline && Array.isArray(companionTimeline)) {
            for (const seg of companionTimeline) {
              companionSegs.push(seg);
            }
          }

          // 无时间线但有关键词版单句Companion → 2s后备
          if (reactionSegs.length === 0 && companionSegs.length === 0 && companionLayer) {
            timelineSchedules.push(setTimeout(() => {
              pushToQueue('\n' + companionLayer);
            }, 2000));
            return;
          }

          // ── Reaction：按固定 displayAt 定时触发 ──
          for (const seg of reactionSegs) {
            const elapsed = Date.now() - chatStartTime;
            const delayMs = Math.max(0, seg.displayAt * 1000 - elapsed);
            timelineSchedules.push(setTimeout(() => {
              pushToQueue('\n' + seg.text);
            }, delayMs));
          }

          // ── Companion：链式排入待播队列（不设固定定时器） ──
          // 第一个companion在最后一个reaction的displayAt + 1s 后开始
          if (companionSegs.length > 0) {
            const lastReactionTime = reactionSegs.length > 0
              ? Math.max(...reactionSegs.map(s => s.displayAt))
              : 0;
            const chainStartDelay = Math.max(0, lastReactionTime * 1000 - (Date.now() - chatStartTime)) + 1000;
            
            // 首个companion通过定时器触发，后续由 scheduleNext 链式触发
            const firstComp = companionSegs.shift()!;
            timelineSchedules.push(setTimeout(() => {
              setChatPhase('companion');
              pushToQueue('\n' + firstComp.text);
            }, chainStartDelay));

            // 剩余的companion段存入链式队列（每个段之间0.8s间隙）
            remainingCompanionChain = companionSegs.map(s => ({ text: s.text, delay: 800 }));
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
                  if (!parsed.content) {
                    if (parsed.done) {
                      isDeepDone = true;
                      scheduleNext();
                    }
                    return;
                  }

                  // 安全网：丢弃包含模型推理过程的 chunk
                  const content = parsed.content;
                  const thinkingPatterns = [
                    "here's a thinking process",
                    "here is a thinking process",
                    "analyze user input",
                    "check constraints",
                    "draft construction",
                    "final polish",
                    "step-by-step analysis",
                    "let me think about this",
                    "let me analyze",
                    "1. analyze",
                    "2. check",
                    "3. draft",
                    "4. final",
                    "reason carefully",
                  ];
                  const lowerContent = content.toLowerCase();
                  const isThinkingChunk = thinkingPatterns.some(p => lowerContent.includes(p));
                  if (isThinkingChunk) {
                    console.log(`[Deep] 丢弃含推理过程的 chunk: ${content.substring(0, 120)}`);
                    return;
                  }

                  // ── 首次 Deep chunk 到达：触发接管 ──
                  if (!isDeepStarted) {
                    isDeepStarted = true;
                    const now = Date.now();
                    console.log(`[Deep] 首次chunk到达: ${now - chatStartTime}ms`);

                    // 1. 取消所有未触发的 Companion 定时器（停止后续段）
                    const timersCancelled = timelineSchedules.length;
                    timelineSchedules.forEach(t => clearTimeout(t));
                    timelineSchedules.length = 0;
                    remainingCompanionChain = []; // 清空companion链
                    console.log(`[Deep] 取消未触发的timers: ${timersCancelled}个`);

                    setChatPhase('deep_arriving');

                    // 2. 如果正在 typing（某段还在渲染中）→ 缓存 deep，等当前段打完再追加
                    if (typingTimer) {
                      deepBuffer = parsed.content;
                      console.log(`[Deep] 正在typing，缓存deep，不打断当前段`);
                      return;
                    }

                    // 3. 不在 typing → 按自然段分批显现 Deep
                    console.log(`[Deep] 直接追加到已显示内容后: ${now - chatStartTime}ms`);
                    showDeepByParagraphs(parsed.content);
                    return;
                  }

                  // ── 后续 Deep chunk ──
                  pushToQueue(parsed.content);
                } catch { /* ignore */ }
              },
              onDone: () => {
                isDeepDone = true;
                // 安全网：如果 deepBuffer 中累积的内容中文占比过低（<20%），丢弃
                if (deepBuffer && deepBuffer.length > 10) {
                  const chineseCount = (deepBuffer.match(/[\u4e00-\u9fff]/g) || []).length;
                  if (chineseCount / deepBuffer.length < 0.2) {
                    console.log(`[Deep] onDone: 丢弃中文占比过低的 deepBuffer (${chineseCount}/${deepBuffer.length})`);
                    deepBuffer = '';
                  }
                }
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
        chatPhase,
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