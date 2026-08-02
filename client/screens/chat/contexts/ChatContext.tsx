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
import { chatStart, chatStream, FlowContext } from '../api/cozeApi';


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
  conversationId: string;
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
  flowContext: FlowContext | null;
  canRetry: boolean;
  canRegenerate: boolean;
  setInputText: (text: string) => void;
  setCurrentRole: (role: (typeof roles)[0]) => void;
  setShowRoleIntro: (show: boolean) => void;
  sendMessage: (text: string, options?: { audioUri?: string; emotion?: string }) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  regenerateLastResponse: () => Promise<void>;
  clearError: () => void;
  setShowHistory: (show: boolean) => void;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  createNewChat: (role?: PsychologistRole) => string;
  currentSession: ChatSession | undefined;
  loadSession: (sessionId: string) => void;
  deepThinkingContent: string;
  chatPhase: 'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done';
}

// EM-43: 发送快照，用于 retry/regenerate
interface SendSnapshot {
  requestId: string;
  conversationId: string;
  sessionId: string;
  roleId: string;
  message: string;
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
  const [flowContext, setFlowContext] = useState<FlowContext | null>(null);
  const [conversationId, setConversationId] = useState<string>('');
  const conversationIdRef = useRef<string>('');

  // EM-43: 并发控制与资源管理
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const retrySnapshotRef = useRef<SendSnapshot | null>(null);
  const regenerateSnapshotRef = useRef<SendSnapshot | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // EM-43: 组件卸载时清理
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 取消正在进行的请求
      abortControllerRef.current?.abort();
      // 清理所有定时器
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  // EM-43: 资源清理（不调用 abort）
  const cleanupResources = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    abortControllerRef.current = null;
  }, []);

  // EM-43: 取消请求（abort + 清理资源）
  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    cleanupResources();
  }, [cleanupResources]);

  // EM-43: 生成请求ID
  const generateRequestId = useCallback((): string => {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  // EM-43: 跨平台安全的 conversationId 生成
  const generateConversationId = useCallback((): string => {
    return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  // 保存会话
  /* sessions persistence skipped */

  const createNewChat = useCallback((role?: PsychologistRole): string => {
    const newConversationId = generateConversationId();
    setMessages([]);
    setCurrentSessionId(null);
    setError(null);
    setIsLoading(false);
    setIsThinking(false);
    setThinkingContent('');
    setLightAnalysis('');
    setConversationId(newConversationId);
    conversationIdRef.current = newConversationId;
    if (role) setCurrentRole(role);
    return newConversationId;
  }, [generateConversationId]);

  const selectSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        setMessages(session.messages);
        setCurrentSessionId(session.id);
        const role = getRoleById(session.roleId);
        if (role) setCurrentRole(role);
        // EM-43: 恢复会话的 conversationId
        if (session.conversationId) {
          setConversationId(session.conversationId);
          conversationIdRef.current = session.conversationId;
        }
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

  // EM-43: 发送核心函数（内部使用，不直接暴露）
  const sendMessageCore = useCallback(
    async (
      userMessage: string,
      snapshot: SendSnapshot,
      isRetry: boolean = false
    ): Promise<'success' | 'chatstart_failed' | 'sse_failed'> => {
      // 确保当前角色与快照一致
      const roleToUse = roles.find(r => r.id === snapshot.roleId) || currentRole;

      // 设置 abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 同步更新持久状态
      conversationIdRef.current = snapshot.conversationId;
      setConversationId(snapshot.conversationId);
      setCurrentSessionId(snapshot.sessionId);
      setCurrentRole(roleToUse);

      // 创建用户消息（仅首次，retry 不重复创建）
      if (!isRetry) {
        const userMsg: ChatMessage = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          role: 'user',
          content: userMessage,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
      }

      setChatPhase('responding');
      setIsThinking(true);
      setIsLoading(true);
      setError(null);
      setLightAnalysis('');

      // 更新或创建会话记录
      setSessions(prev => {
        const existingIdx = prev.findIndex(s => s.id === snapshot.sessionId);
        const existingSession = prev[existingIdx];
        const updatedMessages = existingIdx >= 0 && isRetry
          ? existingSession.messages  // retry 不重复用户消息
          : existingIdx >= 0
            ? [...existingSession.messages, { id: `user_${Date.now()}`, role: 'user' as const, content: userMessage, timestamp: Date.now() }]
            : [{ id: `user_${Date.now()}`, role: 'user' as const, content: userMessage, timestamp: Date.now() }];
        const sessionData = {
          id: snapshot.sessionId,
          roleId: snapshot.roleId,
          title: userMessage.slice(0, 30),
          messages: updatedMessages,
          createdAt: existingIdx >= 0 ? existingSession.createdAt : Date.now(),
          updatedAt: Date.now(),
          conversationId: snapshot.conversationId,
        };
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = sessionData;
          return updated;
        }
        return [...prev, sessionData];
      });

      let chatStartSucceeded = false;

      try {
        // ====== 第一阶段：调用 /chat/start 获取 EmotionFlow 三层内容 ======
        const sessionInfo = await chatStart(
          snapshot.roleId,
          userMessage,
          snapshot.conversationId,
          snapshot.requestId
        );

        chatStartSucceeded = true;  // 标记 chatStart 成功

        const { sessionId, reactionLayer, companionLayer, frontFlowText, reactionTimeline, companionTimeline, flowContext: fc } = sessionInfo;
        setFlowContext(fc);

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

        // 等待 SSE 完成（简化处理：等待一段时间或 deep 完成）
        // 实际实现中，这里应该有更复杂的等待逻辑
        await new Promise<void>((resolve) => {
          const checkDone = () => {
            if (isDeepDone || !mountedRef.current) {
              resolve();
            } else {
              const timer = setTimeout(checkDone, 100);
              timersRef.current.push(timer);
            }
          };
          checkDone();
        });

        // 完整成功，清除 retry/regenerate 快照
        retrySnapshotRef.current = null;
        regenerateSnapshotRef.current = null;

        return 'success';
      } catch (err) {
        console.error('[sendMessage] Error:', err);
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : '请求失败');
          setIsLoading(false);
          setIsThinking(false);
        }

        // 根据失败阶段决定 retry 还是 regenerate
        if (chatStartSucceeded) {
          // chatStart 成功但 SSE 失败 → 保存 regenerate 快照
          regenerateSnapshotRef.current = snapshot;
          return 'sse_failed';
        } else {
          // chatStart 失败 → 保存 retry 快照
          retrySnapshotRef.current = snapshot;
          return 'chatstart_failed';
        }
      } finally {
        cleanupResources();
      }
    },
    [currentRole, roles, cleanupResources]
  );

  // EM-43: 发送守卫包装
  const withSendGuard = useCallback(
    async (fn: () => Promise<'success' | 'chatstart_failed' | 'sse_failed'>): Promise<'success' | 'chatstart_failed' | 'sse_failed'> => {
      // 关键修复：如果被阻止，立即返回，不进入 try-finally
      if (sendingRef.current) {
        console.log('[sendMessage] Blocked by sendingRef guard');
        // 直接返回，不执行 finally 块
        return 'chatstart_failed';
      }
      
      sendingRef.current = true;
      setIsLoading(true);
      
      let result: 'success' | 'chatstart_failed' | 'sse_failed';
      try {
        result = await fn();
      } finally {
        sendingRef.current = false;
        if (mountedRef.current) {
          setIsLoading(false);
          setIsThinking(false);
        }
        cleanupResources();
      }
      
      return result;
    },
    [cleanupResources]
  );

  // EM-43: 公开 sendMessage（带 guard）
  const sendMessage = useCallback(
    async (userMessage: string, _options?: { audioUri?: string; emotion?: string; conversationId?: string }) => {
      if (!userMessage.trim() || !currentRole) return;

      // EM-43: 优先使用显式传入的 conversationId
      const convIdToUse = _options?.conversationId || conversationIdRef.current || conversationId;
      const sessionIdToUse = currentSessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      const snapshot: SendSnapshot = {
        requestId: generateRequestId(),
        conversationId: convIdToUse,
        sessionId: sessionIdToUse,
        roleId: currentRole.id,
        message: userMessage,
      };

      await withSendGuard(() => sendMessageCore(userMessage, snapshot, false));
    },
    [currentRole, currentSessionId, conversationId, generateRequestId, withSendGuard, sendMessageCore]
  );

  // EM-43: Retry（chatStart 失败时使用，不增加 userTurn）
  const retryLastMessage = useCallback(async () => {
    const snapshot = retrySnapshotRef.current;
    if (!snapshot) {
      console.log('[retry] No retry snapshot available');
      return;
    }

    await withSendGuard(() => sendMessageCore(snapshot.message, snapshot, true));
  }, [withSendGuard, sendMessageCore]);

  // EM-43: Regenerate（chatStart 成功但 SSE 失败时使用，复用同一 requestId 不增加轮次）
  const regenerateLastResponse = useCallback(async () => {
    const snapshot = regenerateSnapshotRef.current;
    if (!snapshot) {
      console.log('[regenerate] No regenerate snapshot available');
      return;
    }

    // 复用同一 requestId，Server 会返回相同的 userTurn（幂等）
    await withSendGuard(() => sendMessageCore(snapshot.message, snapshot, true));
  }, [withSendGuard, sendMessageCore]);

  // EM-43: 计算 canRetry 和 canRegenerate
  const canRetry = retrySnapshotRef.current !== null;
  const canRegenerate = regenerateSnapshotRef.current !== null;

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const loadSessionFn = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const role = roles.find(r => r.id === session.roleId);
    setCurrentRole(role || roles[0]);
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    // EM-43: 恢复会话的 conversationId
    const sessionConvId = session.conversationId || generateConversationId();
    setConversationId(sessionConvId);
    conversationIdRef.current = sessionConvId;
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
        flowContext,
        error,
        showHistory,
        lightAnalysis,
        inputText,
        showRoleIntro,
        roles,
        canRetry,
        canRegenerate,
        setInputText,
        setCurrentRole,
        setShowRoleIntro,
        sendMessage,
        retryLastMessage,
        regenerateLastResponse,
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