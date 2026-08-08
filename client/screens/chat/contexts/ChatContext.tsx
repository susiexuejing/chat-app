import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRoleById, roles, PsychologistRole } from '../constants/roles';
import { chatStart, chatStream, FlowContext } from '../api/cozeApi';
import { ChatSession, ChatMessage } from '../types';
import { saveChatSessions, getChatSessions, persistMessage, createConversation, fetchConversation } from '../stores/sessionStore';


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
  // EF-58: 消息队列状态和 UI
  messageQueue: QueuedMessage[];
  queueCount: number;
  isProcessingQueue: boolean;
  queuePosition: number;
  // EF-58 Code Review Fix: 当前正在处理的消息 ID
  currentlyProcessingMessageId: string | null;
  setInputText: (text: string) => void;
  setCurrentRole: (role: (typeof roles)[0]) => void;
  setShowRoleIntro: (show: boolean) => void;
  sendMessage: (text: string, options?: { audioUri?: string; emotion?: string; conversationId?: string }) => Promise<boolean>;
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
  // EF-58: 队列管理函数
  clearQueue: () => void;
  removeQueuedMessage: (messageId: string) => void;
  retryQueuedMessage: (messageId: string) => Promise<void>;
}

// EM-43: 发送快照，用于 retry/regenerate
interface SendSnapshot {
  requestId: string;
  conversationId: string;
  sessionId: string;
  roleId: string;
  message: string;
}

// EF-58: 消息队列状态
export type QueuedMessageStatus = 'queued' | 'processing' | 'completed' | 'failed';

// EF-58: 增强消息队列项（替代 EM-53 的简单实现）
interface QueuedMessage {
  id: string;
  text: string;
  options?: { audioUri?: string; emotion?: string };
  timestamp: number;
  // EF-58: 增强字段
  status: QueuedMessageStatus;
  retryCount: number;
  lastError?: string;
  // EF-58 Code Review Fix: requestId is required for future backend idempotency
  // Pre-generated when message is queued, preserved across retries and persistence
  // Backend will use this to detect duplicate requests and return cached responses
  requestId?: string;
}

// EM-54: 持久化存储键
const STORAGE_KEY_CURRENT_SESSION_ID = 'current_session_id';
const STORAGE_KEY_CURRENT_ROLE_ID = 'current_role_id';
// EF-58: 消息队列持久化存储键
const STORAGE_KEY_MESSAGE_QUEUE = 'message_queue';
// EF-58: 队列大小限制
const MAX_QUEUE_SIZE = 10;

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

  // EF-58: 消息队列（增强版）
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const processNextInQueueRef = useRef<(() => Promise<void>) | null>(null);
  
  // EF-58: 队列 UI 状态
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  // EF-58 Code Review Fix: 添加 currentlyProcessingMessageId 用于精确追踪
  const [currentlyProcessingMessageId, setCurrentlyProcessingMessageId] = useState<string | null>(null);
  const queueCount = messageQueue.length;
  // EF-58 Code Review Fix: queuePosition 根据 messageId 计算，不依赖 status
  const queuePosition = currentlyProcessingMessageId 
    ? messageQueue.findIndex(m => m.id === currentlyProcessingMessageId)
    : -1;

  // EF-58 Code Review Fix: 统一队列持久化 helper
  // 在 enqueue/update status 时调用，确保 state update + immediate AsyncStorage persistence
  const persistQueue = useCallback(async (queue: QueuedMessage[]) => {
    messageQueueRef.current = queue;
    setMessageQueue(queue);
    try {
      if (queue.length > 0) {
        await AsyncStorage.setItem(STORAGE_KEY_MESSAGE_QUEUE, JSON.stringify(queue));
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY_MESSAGE_QUEUE);
      }
    } catch (error) {
      console.error('[EF-58] Failed to persist queue:', error);
    }
  }, []);

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

  // EM-54: 初始化时从 AsyncStorage 加载会话和角色
  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        // 加载会话列表
        const persistedSessions = await getChatSessions();
        if (persistedSessions.length > 0) {
          setSessions(persistedSessions);
          
          // 加载当前会话 ID
          const persistedSessionId = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_SESSION_ID);
          if (persistedSessionId && persistedSessions.find(s => s.id === persistedSessionId)) {
            setCurrentSessionId(persistedSessionId);
            // 恢复当前会话的消息（只恢复已完成的消息，不恢复 streaming 状态）
            const session = persistedSessions.find(s => s.id === persistedSessionId);
            if (session && session.messages.length > 0) {
              setMessages(session.messages);
            }
            // EF-59 Fix: 恢复 conversationIdRef（后端对话 ID）
            if (session?.conversationId) {
              conversationIdRef.current = session.conversationId;
              console.log('[EF-59] Restored conversationIdRef:', session.conversationId);
            }
          }
        }
        
        // 加载当前角色
        const persistedRoleId = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_ROLE_ID);
        if (persistedRoleId) {
          const role = getRoleById(persistedRoleId);
          if (role) {
            setCurrentRole(role);
          }
        }
        
        // EF-58: 加载消息队列（只恢复 queued 状态的消息，processing 状态重置为 queued）
        const persistedQueue = await AsyncStorage.getItem(STORAGE_KEY_MESSAGE_QUEUE);
        if (persistedQueue) {
          try {
            const queue: QueuedMessage[] = JSON.parse(persistedQueue);
            // 将 processing 状态的消息重置为 queued（因为刷新后不再有进行中的处理）
            const recoveredQueue = queue.map(m => ({
              ...m,
              status: m.status === 'processing' ? 'queued' as QueuedMessageStatus : m.status,
            }));
            messageQueueRef.current = recoveredQueue;
            setMessageQueue(recoveredQueue);
            console.log(`[EF-58] Restored ${recoveredQueue.length} messages from queue`);
          } catch (parseError) {
            console.error('[EF-58] Failed to parse persisted queue:', parseError);
          }
        }
      } catch (error) {
        console.error('EM-54: 加载持久化状态失败:', error);
      }
    };
    
    loadPersistedState();
  }, []);

  // EF-59 Phase 5: 刷新恢复 - 初始化后从后端同步对话和消息
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    // 只在有 sessionId 且未同步过时执行
    if (!currentSessionId || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    const syncFromBackend = async () => {
      try {
        // EF-59 Fix: 使用会话的 conversationId（后端 ID）而不是 sessionId（前端 ID）
        const session = sessions.find(s => s.id === currentSessionId);
        const backendConversationId = session?.conversationId;
        
        if (!backendConversationId) {
          console.log('[EF-59] No backend conversationId for session:', currentSessionId);
          return;
        }

        const result = await fetchConversation(backendConversationId);
        if (!result) {
          console.log('[EF-59] No backend conversation found for id:', backendConversationId);
          return;
        }

        const { conversation: conv, messages: backendMessages } = result as {
          conversation: { id: string; roleId: string };
          messages: Array<{ id: string; role: string; content: string; timestamp: number; status?: string }>;
        };

        // 更新消息（后端数据为准）
        if (backendMessages && backendMessages.length > 0) {
          const mappedMessages: ChatMessage[] = backendMessages.map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
            isThinking: false,
          }));
          setMessages(mappedMessages);
          console.log(`[EF-59] Synced ${mappedMessages.length} messages from backend`);

          // 检查是否有失败的生成（status=failed 的最后一条助手消息）
          const lastAssistantMsg = backendMessages.filter(m => m.role === 'assistant').pop();
          if (lastAssistantMsg && lastAssistantMsg.status === 'failed') {
            setError('Generation was interrupted. Please try again.');
          }
        }
      } catch (error) {
        // 网络错误时保持缓存数据，不覆盖
        console.error('[EF-59] Failed to sync from backend:', error);
      }
    };

    syncFromBackend();
  }, [currentSessionId, sessions]);

  // EM-54: 会话列表变化时保存到 AsyncStorage
  useEffect(() => {
    if (sessions.length > 0) {
      saveChatSessions(sessions);
    }
  }, [sessions]);

  // EM-54: 当前会话 ID 变化时保存到 AsyncStorage
  useEffect(() => {
    if (currentSessionId) {
      AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, currentSessionId);
    }
  }, [currentSessionId]);

  // EM-54: 当前角色变化时保存到 AsyncStorage
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY_CURRENT_ROLE_ID, currentRole.id);
  }, [currentRole]);

  // EF-58 Code Review Fix: 移除 useEffect 持久化，改用 persistQueue helper 立即持久化

  // EF-58: 资源清理（不调用 abort）
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

        // EF-59: 确保有后端对话 ID 后再持久化
        let backendConvId = conversationIdRef.current;
        if (!backendConvId) {
          // 首次发送消息，创建后端对话
          // 使用固定 userId（单用户应用）
          const newConv = await createConversation('default-user', roleToUse.id);
          if (newConv) {
            backendConvId = newConv.id;
            conversationIdRef.current = backendConvId;
          }
        }
        if (backendConvId) {
          persistMessage(backendConvId, {
            role: 'user',
            content: userMessage,
            status: 'sent',
            requestId: snapshot.requestId,
          }).catch(err => console.error('[EF-59] User message persist failed:', err));
        }
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
          // EF-59: 优先使用后端对话 ID，否则使用 EM-43 幂等键
          conversationId: conversationIdRef.current || snapshot.conversationId,
        };
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = sessionData;
          return updated;
        }
        return [...prev, sessionData];
      });

      let chatStartSucceeded = false;
      let deepBuffer = '';  // EF-59 Phase 4: 用于错误恢复时持久化已接收内容

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
        // deepBuffer 已在 try 块外声明（EF-59 Phase 4: 用于错误恢复）
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

                // EF-59 Phase 4: 持久化助手消息到后端（deep 完成后）
                const finalDeepContent = deepBuffer || '';
                if (finalDeepContent) {
                  persistMessage(conversationIdRef.current, {
                    role: 'assistant',
                    content: finalDeepContent,
                    status: 'sent',
                  }).catch(err => console.error('[EF-59] Assistant message persist failed:', err));
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

        // EF-59 Phase 4: 持久化失败的助手消息
        if (chatStartSucceeded) {
          const failedContent = deepBuffer || '';
          persistMessage(conversationIdRef.current, {
            role: 'assistant',
            content: failedContent,
            status: 'failed',
          }).catch(persistErr => console.error('[EF-59] Failed message persist error:', persistErr));
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
        
        // EM-53: 当前回复完成后，处理队列中的下一条消息
        // 使用 setTimeout 确保状态更新完成后再处理
        setTimeout(() => {
          if (processNextInQueueRef.current) {
            processNextInQueueRef.current();
          }
        }, 100);
      }
      
      return result;
    },
    [cleanupResources]
  );

  // EF-58: 处理队列中的下一条消息（增强版）
  const processNextInQueue = useCallback(async () => {
    if (messageQueueRef.current.length === 0 || sendingRef.current) {
      setIsProcessingQueue(false);
      setCurrentlyProcessingMessageId(null);
      return;
    }

    setIsProcessingQueue(true);
    
    // 找到第一个 queued 状态的消息（FIFO 顺序）
    const nextIndex = messageQueueRef.current.findIndex(m => m.status === 'queued');
    if (nextIndex === -1) {
      setIsProcessingQueue(false);
      setCurrentlyProcessingMessageId(null);
      return;
    }

    const nextMessage = messageQueueRef.current[nextIndex];
    
    // EF-58 Code Review Fix: 设置 currentlyProcessingMessageId
    setCurrentlyProcessingMessageId(nextMessage.id);
    
    // EF-58 Code Review Fix: 保留 requestId（如果已有），否则生成新的
    // requestId is required for future backend idempotency
    const updatedQueue = messageQueueRef.current.map((m, i) => 
      i === nextIndex ? { ...m, status: 'processing' as QueuedMessageStatus, requestId: m.requestId || generateRequestId() } : m
    );
    
    // EF-58 Code Review Fix: 使用 persistQueue helper 立即持久化
    await persistQueue(updatedQueue);

    console.log(`[EF-58] Processing queued message: ${nextMessage.text.substring(0, 20)}... (retry: ${nextMessage.retryCount}, requestId: ${nextMessage.requestId})`);

    // EM-53: 如果输入框内容仍等于该排队原文（考虑 trim），则清空；如果用户已输入新草稿，不清空
    if (inputText.trim() === nextMessage.text) {
      setInputText('');
    }

    // 发送消息
    const convIdToUse = conversationIdRef.current || conversationId;
    const sessionIdToUse = currentSessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const snapshot: SendSnapshot = {
      requestId: nextMessage.requestId || generateRequestId(),
      conversationId: convIdToUse,
      sessionId: sessionIdToUse,
      roleId: currentRole.id,
      message: nextMessage.text,
    };

    try {
      const result = await withSendGuard(() => sendMessageCore(nextMessage.text, snapshot, false));
      
      // 更新消息状态
      const finalQueue = messageQueueRef.current.map(m => 
        m.id === nextMessage.id 
          ? { ...m, status: (result === 'success' ? 'completed' : 'failed') as QueuedMessageStatus, lastError: result !== 'success' ? 'Send failed' : undefined }
          : m
      );
      
      // 移除已完成的消息
      const cleanedQueue = finalQueue.filter(m => m.status !== 'completed');
      
      // EF-58 Code Review Fix: 使用 persistQueue helper 立即持久化
      await persistQueue(cleanedQueue);
      
    } catch (error) {
      // 处理失败
      const failedQueue = messageQueueRef.current.map(m => 
        m.id === nextMessage.id 
          ? { ...m, status: 'failed' as QueuedMessageStatus, lastError: error instanceof Error ? error.message : 'Unknown error', retryCount: m.retryCount + 1 }
          : m
      );
      // EF-58 Code Review Fix: 使用 persistQueue helper 立即持久化
      await persistQueue(failedQueue);
    }
    
    setIsProcessingQueue(false);
    setCurrentlyProcessingMessageId(null);
  }, [conversationId, currentSessionId, currentRole, generateRequestId, withSendGuard, sendMessageCore, inputText, persistQueue]);

  // EM-53: 将 processNextInQueue 赋值给 ref
  processNextInQueueRef.current = processNextInQueue;

  // EF-58: 公开 sendMessage（带 guard）- 返回 boolean 表示是否成功发送
  const sendMessage = useCallback(
    async (userMessage: string, _options?: { audioUri?: string; emotion?: string; conversationId?: string }): Promise<boolean> => {
      if (!userMessage.trim() || !currentRole) return false;

      // EF-58: 如果正在发送，将消息加入队列
      if (sendingRef.current) {
        // EF-58: 检查队列大小限制
        if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
          console.warn(`[EF-58] Queue is full (${MAX_QUEUE_SIZE}), rejecting message`);
          return false;
        }
        
        const queuedMsg: QueuedMessage = {
          id: `queued_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text: userMessage,
          options: _options,
          timestamp: Date.now(),
          status: 'queued',
          retryCount: 0,
          // EF-58 Code Review Fix: requestId is required for future backend idempotency
          // Pre-generated here to ensure consistency across retries and persistence
          requestId: generateRequestId(),
        };
        const newQueue = [...messageQueueRef.current, queuedMsg];
        // EF-58 Code Review Fix: 使用 persistQueue helper 立即持久化
        await persistQueue(newQueue);
        console.log(`[EF-58] Message queued: ${userMessage.substring(0, 20)}... (queue length: ${newQueue.length}, requestId: ${queuedMsg.requestId})`);
        return false; // 返回 false 表示消息被排队，未立即发送
      }

      // EM-43: 优先使用显式传入的 conversationId
      const convIdToUse = _options?.conversationId || conversationIdRef.current || conversationId;
      const sessionIdToUse = currentSessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      // EF-58 Code Review Fix: requestId is required for future backend idempotency
      const snapshot: SendSnapshot = {
        requestId: generateRequestId(),
        conversationId: convIdToUse,
        sessionId: sessionIdToUse,
        roleId: currentRole.id,
        message: userMessage,
      };

      await withSendGuard(() => sendMessageCore(userMessage, snapshot, false));
      return true; // 返回 true 表示消息已发送
    },
    [currentRole, currentSessionId, conversationId, generateRequestId, withSendGuard, sendMessageCore, persistQueue]
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

  // EF-58: 队列管理函数
  // EF-58 Code Review Fix: 使用 persistQueue helper 立即持久化
  const clearQueue = useCallback(async () => {
    await persistQueue([]);
    setCurrentlyProcessingMessageId(null);
    console.log('[EF-58] Queue cleared');
  }, [persistQueue]);

  const removeQueuedMessage = useCallback(async (messageId: string) => {
    const newQueue = messageQueueRef.current.filter(m => m.id !== messageId);
    await persistQueue(newQueue);
    if (currentlyProcessingMessageId === messageId) {
      setCurrentlyProcessingMessageId(null);
    }
    console.log(`[EF-58] Removed message ${messageId} from queue`);
  }, [persistQueue, currentlyProcessingMessageId]);

  const retryQueuedMessage = useCallback(async (messageId: string) => {
    const message = messageQueueRef.current.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') {
      console.warn(`[EF-58] Cannot retry message ${messageId}: not found or not failed`);
      return;
    }

    // EF-58 Code Review Fix: 保留 requestId 用于幂等性
    // requestId is required for future backend idempotency
    const updatedQueue = messageQueueRef.current.map(m =>
      m.id === messageId ? { ...m, status: 'queued' as QueuedMessageStatus, lastError: undefined } : m
    );
    await persistQueue(updatedQueue);

    // 如果当前没有正在发送的消息，立即处理
    if (!sendingRef.current) {
      await processNextInQueue();
    }
  }, [processNextInQueue, persistQueue]);

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
        // EF-58: 消息队列状态和 UI
        messageQueue,
        queueCount,
        isProcessingQueue,
        queuePosition,
        currentlyProcessingMessageId,
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
        // EF-58: 队列管理函数
        clearQueue,
        removeQueuedMessage,
        retryQueuedMessage,
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