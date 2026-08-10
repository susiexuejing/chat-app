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
import { ChatSession, ChatMessage, TurnStatus, PendingTurn } from '../types';
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
  // EF-59 Fix: 水合状态守卫
  isHydrated: boolean;
  // EF-38: Turn lifecycle for interrupted generation recovery
  turnStatus: TurnStatus;
  isInterrupted: boolean;
  pendingTurn?: PendingTurn;
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
  // EF-59 PROVIDER INSTANCE TRACE: 追踪 Provider 实例
  const providerInstanceId = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  
  // EF-59: Authoritative refs for mutable conversation state
  // These refs always contain the latest state, avoiding stale closure issues
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionsRef = useRef<ChatSession[]>([]);
  
  // EF-59: Centralized helpers to update both ref and state atomically
  const replaceMessages = (updater: (previous: ChatMessage[]) => ChatMessage[]): ChatMessage[] => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
    return next;
  };
  
  const replaceSessions = (updater: (previous: ChatSession[]) => ChatSession[]): ChatSession[] => {
    const next = updater(sessionsRef.current);
    sessionsRef.current = next;
    setSessions(next);
    return next;
  };
  
  // Sync refs with state on initial mount and when state changes externally
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<(typeof roles)[0]>(roles[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lightAnalysis, setLightAnalysis] = useState('');
  const [chatPhase, setChatPhaseState] = useState<'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done'>('idle');
  const chatPhaseRef = useRef<'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done'>('idle');
  
  // Helper function to update both state and ref
  const setChatPhase = (phase: 'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done') => {
    chatPhaseRef.current = phase;
    setChatPhaseState(phase);
  };
  
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

  // EF-59 Fix: 水合状态守卫
  // 在从 AsyncStorage 恢复完成前，阻止依赖 currentSessionId 的逻辑执行
  const [isHydrated, setIsHydrated] = useState(false);

  // EF-59 CONTEXT LIFECYCLE TRACE
  useEffect(() => {
    console.log('[EF59_CONTEXT_TRACE] ChatProvider mounted ' + JSON.stringify({
      instanceId: providerInstanceId.current,
      timestamp: Date.now()
    }));
    return () => {
      console.log('[EF59_CONTEXT_TRACE] ChatProvider unmounted ' + JSON.stringify({
        instanceId: providerInstanceId.current,
        timestamp: Date.now()
      }));
    };
  }, []);

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

  // EF-59 STATE TRACE: sessions state 变化追踪
  useEffect(() => {
    console.log('[EF59_STATE_TRACE] sessions state changed', {
      count: sessions.length,
      sessions: sessions.map(s => ({
        id: s.id,
        conversationId: s.conversationId,
        messages: s.messages?.length
      }))
    });
  }, [sessions]);

  // EF-59 SESSION TRACE: currentSessionId 变化追踪（显式原始值）
  useEffect(() => {
    console.log('[EF59_SESSION_TRACE] currentSessionId changed ' + JSON.stringify({
      instanceId: providerInstanceId.current,
      value: String(currentSessionId),
      timestamp: Date.now()
    }));
    
    // EF-59 SESSION TRACE: overwrite detector
    if (!currentSessionId) {
      console.log('[EF59_SESSION_TRACE] currentSessionId became null ' + JSON.stringify({
        instanceId: providerInstanceId.current,
        timestamp: Date.now(),
        sessionsCount: sessions.length
      }));
    }
  }, [currentSessionId, sessions.length]);

  // EM-54: 初始化时从 AsyncStorage 加载会话和角色
  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        // 加载会话列表
        const persistedSessions = await getChatSessions();
        
        // EF-59 STATE TRACE: getChatSessions 返回后
        console.log('[EF59_STATE_TRACE] persisted sessions loaded', {
          count: persistedSessions.length,
          sessions: persistedSessions.map(s => ({
            id: s.id,
            conversationId: s.conversationId,
            messages: s.messages?.length
          }))
        });
        
        if (persistedSessions.length > 0) {
          // EF-59 STATE TRACE: setSessions 前
          console.log('[EF59_STATE_TRACE] before setSessions', {
            count: persistedSessions.length
          });
          
          setSessions(persistedSessions);
          
          // 加载当前会话 ID
          const persistedSessionId = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_SESSION_ID);
          
          // EF-59 SESSION TRACE: 恢复前详细状态（显式原始值）
          console.log('[EF59_SESSION_TRACE] restoring current session', {
            persistedSessionId: String(persistedSessionId),
            sessionsCount: persistedSessions.length,
            sessionIds: persistedSessions.map(s => String(s.id)),
            matchFound: persistedSessionId ? !!persistedSessions.find(s => s.id === persistedSessionId) : false
          });
          
          if (persistedSessionId && persistedSessions.find(s => s.id === persistedSessionId)) {
            // EF-59 STATE TRACE: currentSessionId 恢复
            console.log('[EF59_STATE_TRACE] currentSession restored', {
              currentSessionId: String(persistedSessionId)
            });
            
            // EF-59 SETTER TRACE
            console.trace('[EF59_SETTER_TRACE] setCurrentSessionId called', {
              value: String(persistedSessionId),
              source: 'loadPersistedState',
              timestamp: Date.now()
            });
            // EF-59 ACTIVE SESSION TRACE
            const restoredSession = persistedSessions.find(s => s.id === persistedSessionId);
            console.log('[EF59_ACTIVE_SESSION_TRACE] ' + JSON.stringify({
              persistedSessionId,
              persistedSessionExists: !!restoredSession,
              sessionsCount: persistedSessions.length,
              restoredSessionId: restoredSession?.id ?? null,
              currentSessionIdAfterRestore: persistedSessionId,
              source: 'loadPersistedState',
              timestamp: Date.now()
            }));
            
            setCurrentSessionId(persistedSessionId);
            // 恢复当前会话的消息（只恢复已完成的消息，不恢复 streaming 状态）
            if (restoredSession && restoredSession.messages.length > 0) {
              setMessages(restoredSession.messages);
            }
            // EF-59: 恢复 chatPhase（用于恢复 UI 状态，如 "轮到你了"）
            if (restoredSession?.chatPhase && restoredSession.chatPhase !== 'responding') {
              // 只恢复完成状态，不恢复中间状态（responding/companion/waiting_deep/deep_arriving）
              if (restoredSession.chatPhase === 'done' || restoredSession.chatPhase === 'idle') {
                setChatPhase(restoredSession.chatPhase);
                console.log('[EF-59] Restored chatPhase:', restoredSession.chatPhase);
              }
            }
            // EF-38: Hydration recovery for interrupted generation
            // If turnStatus is 'generating', the previous request was abandoned during refresh
            // Convert to 'interrupted' state and show recovery UI
            if (restoredSession?.turnStatus === 'generating') {
              console.warn('[EF-38] Detected interrupted generation, converting to interrupted state');
              // Remove any partial assistant message (incomplete bubble)
              const recoveredMessages = restoredSession.messages.filter(m => 
                m.role === 'user' || (m.role === 'assistant' && m.content && m.content.length > 0 && !m.isThinking)
              );
              // Update session with interrupted state
              const updatedSession = {
                ...restoredSession,
                messages: recoveredMessages,
                turnStatus: 'interrupted' as TurnStatus,
                chatPhase: 'idle' as const,
                updatedAt: Date.now(),
              };
              // Update ref and state
              const updatedSessions = persistedSessions.map(s => s.id === restoredSession.id ? updatedSession : s);
              sessionsRef.current = updatedSessions;
              setSessions(updatedSessions);
              setMessages(recoveredMessages);
              setChatPhase('idle');
              // Persist the interrupted state
              await saveChatSessions(updatedSessions);
              console.log('[EF-38] Interrupted state persisted:', {
                sessionId: restoredSession.id,
                recoveredMessagesCount: recoveredMessages.length,
                pendingTurn: restoredSession.pendingTurn
              });
            }
            // EF-59 Fix: 恢复 conversationIdRef（后端对话 ID）
            if (restoredSession?.conversationId) {
              conversationIdRef.current = restoredSession.conversationId;
              console.log('[EF-59] Restored conversationIdRef:', restoredSession.conversationId);
            }
          } else if (persistedSessions.length > 0) {
            // EF-59: 无效活动指针回退 - 选择最近更新的会话
            console.warn('[EF-59] Consistency warning: persisted currentSessionId is invalid, falling back to most recent session');
            const mostRecentSession = persistedSessions.reduce((latest, session) => 
              session.updatedAt > latest.updatedAt ? session : latest
            );
            setCurrentSessionId(mostRecentSession.id);
            // 立即修正 AsyncStorage 中的 current_session_id
            AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, mostRecentSession.id).catch(err => {
              console.error('[EF-59] Failed to correct current_session_id:', err);
            });
            // 恢复最近会话的消息
            if (mostRecentSession.messages.length > 0) {
              setMessages(mostRecentSession.messages);
            }
            // EF-59: 恢复角色（从会话的 roleId，而不是全局 current_role_id）
            if (mostRecentSession.roleId) {
              const role = roles.find(r => r.id === mostRecentSession.roleId);
              if (role) {
                setCurrentRole(role);
                AsyncStorage.setItem(STORAGE_KEY_CURRENT_ROLE_ID, mostRecentSession.roleId).catch(err => {
                  console.error('[EF-59] Failed to restore roleId:', err);
                });
              }
            }
            // 恢复 chatPhase
            if (mostRecentSession.chatPhase === 'done' || mostRecentSession.chatPhase === 'idle') {
              setChatPhase(mostRecentSession.chatPhase);
            }
            // EF-38: Hydration recovery for interrupted generation (fallback case)
            if (mostRecentSession.turnStatus === 'generating') {
              console.warn('[EF-38] Detected interrupted generation in fallback, converting to interrupted state');
              const recoveredMessages = mostRecentSession.messages.filter(m => 
                m.role === 'user' || (m.role === 'assistant' && m.content && m.content.length > 0 && !m.isThinking)
              );
              const updatedSession = {
                ...mostRecentSession,
                messages: recoveredMessages,
                turnStatus: 'interrupted' as TurnStatus,
                chatPhase: 'idle' as const,
                updatedAt: Date.now(),
              };
              const updatedSessions = persistedSessions.map(s => s.id === mostRecentSession.id ? updatedSession : s);
              sessionsRef.current = updatedSessions;
              setSessions(updatedSessions);
              setMessages(recoveredMessages);
              setChatPhase('idle');
              await saveChatSessions(updatedSessions);
            }
            // 恢复 conversationIdRef
            if (mostRecentSession.conversationId) {
              conversationIdRef.current = mostRecentSession.conversationId;
            }
            console.log('[EF-59] Fallback to most recent session:', {
              sessionId: mostRecentSession.id,
              roleId: mostRecentSession.roleId,
              updatedAt: mostRecentSession.updatedAt,
              messagesCount: mostRecentSession.messages.length
            });
          }
        }
        
        // EF-59 TRACE: loadPersistedState 完成后的状态（移到外层作用域）
        const traceSessionId = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_SESSION_ID);
        const traceSessions = await getChatSessions();
        const traceSession = traceSessionId ? traceSessions.find(s => s.id === traceSessionId) : null;
        console.log('[EF59_TRACE] loadPersistedState completed', {
          currentSessionId: traceSessionId,
          sessionsCount: traceSessions.length,
          messagesCount: traceSession?.messages?.length ?? 0,
          conversationId: traceSession?.conversationId ?? null,
          roleId: (await AsyncStorage.getItem(STORAGE_KEY_CURRENT_ROLE_ID)) ?? null
        });
        
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
        
        // EF-59 Fix: 水合完成，允许依赖 currentSessionId 的逻辑执行
        setIsHydrated(true);
        console.log('[EF59_HYDRATION] Hydration completed', {
          sessionsCount: persistedSessions?.length ?? 0,
        });
      } catch (error) {
        console.error('EM-54: 加载持久化状态失败:', error);
        // EF-59 Fix: 即使失败也要解除阻塞，避免永久卡住
        setIsHydrated(true);
      }
    };
    
    loadPersistedState();
  }, []);

  // EF-59 Phase 5: 刷新恢复 - 初始化后从后端同步对话和消息
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    // EF-59 Fix: 等待水合完成后再执行同步
    if (!isHydrated) {
      console.log('[EF59_HYDRATION] syncFromBackend waiting for hydration...');
      return;
    }

    // EF-59 TRACE: syncFromBackend 开始
    console.log('[EF59_TRACE] syncFromBackend start', {
      currentSessionId,
      sessionsCount: sessions.length,
      hasSynced: hasSyncedRef.current
    });

    // 只在有 sessionId 且未同步过时执行
    if (!currentSessionId || hasSyncedRef.current) return;

    // EF-59 Fix: 先找到 session，确认存在后再锁定同步状态
    // 防止 sessions 还未加载完成就锁定 hasSyncedRef
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session) {
      // EF-59 TRACE: session 未找到
      console.log('[EF59_TRACE] session not found, will retry');
      // sessions 还未加载完成，不锁定，等待下次 useEffect 触发
      return;
    }

    // EF-59 TRACE: session 找到
    console.log('[EF59_TRACE] session found', {
      sessionId: session.id,
      conversationId: session.conversationId,
      messageCount: session.messages?.length ?? 0
    });

    // 确认 session 存在后才锁定，防止重复同步
    hasSyncedRef.current = true;

    const syncFromBackend = async () => {
      try {
        // EF-59 Fix: 使用会话的 conversationId（后端 ID）而不是 sessionId（前端 ID）
        const backendConversationId = session.conversationId;
        
        if (!backendConversationId) {
          console.log('[EF-59] No backend conversationId for session:', currentSessionId);
          return;
        }

        // EF-59 TRACE: 调用 fetchConversation
        console.log('[EF59_TRACE] fetchConversation called', {
          conversationId: backendConversationId
        });

        const result = await fetchConversation(backendConversationId);
        
        // EF-59 TRACE: backend response
        console.log('[EF59_TRACE] backend response', {
          conversationId: (result?.conversation as { id?: string } | undefined)?.id ?? null,
          messagesCount: result?.messages?.length ?? 0
        });

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

          // EF-59 TRACE: merge result
          console.log('[EF59_TRACE] merge result', {
            finalMessagesCount: mappedMessages.length,
            conversationId: conv.id,
            roleId: conv.roleId
          });

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
  }, [currentSessionId, sessions, isHydrated]);

  // EM-54: 会话列表变化时保存到 AsyncStorage
  useEffect(() => {
    if (sessions.length > 0) {
      // EF-59 WRITE TRACE: 写入前状态
      const currentSession = sessions.find(s => s.id === currentSessionId);
      console.log('[EF59_WRITE_TRACE] Before AsyncStorage write', {
        sessionsCount: sessions.length,
        sessionId: currentSessionId,
        conversationId: currentSession?.conversationId ?? null,
        messagesCount: currentSession?.messages?.length ?? 0,
      });
      
      saveChatSessions(sessions).then(() => {
        // EF-59 WRITE TRACE: 写入成功
        console.log('[EF59_WRITE_SUCCESS] AsyncStorage write completed', {
          key: 'chat_sessions',
          sessionsCount: sessions.length,
        });
      }).catch(err => {
        console.error('[EF59_WRITE_ERROR] AsyncStorage write failed', err);
      });
    }
  }, [sessions, currentSessionId]);

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
    // EF-59 OVERWRITE TRACE: 追踪谁调用了 createNewChat
    console.trace('[EF59_SESSION_TRACE] createNewChat called - setting currentSessionId null');
    // EF-59 SETTER TRACE
    console.trace('[EF59_SETTER_TRACE] setCurrentSessionId called', {
      value: 'null',
      source: 'createNewChat',
      timestamp: Date.now()
    });
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
        // EF-59 SETTER TRACE
        console.trace('[EF59_SETTER_TRACE] setCurrentSessionId called', {
          value: String(session.id),
          source: 'selectSession',
          timestamp: Date.now()
        });
        setCurrentSessionId(session.id);
        // EF-59: 立即持久化 current_session_id（不依赖 useEffect）
        AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, session.id).catch(err => {
          console.error('[EF-59] Failed to persist current_session_id on select:', err);
        });
        const role = getRoleById(session.roleId);
        if (role) setCurrentRole(role);
        // EM-43: 恢复会话的 conversationId
        if (session.conversationId) {
          setConversationId(session.conversationId);
          conversationIdRef.current = session.conversationId;
        }
        // EF-59: 恢复 chatPhase
        if (session.chatPhase === 'done' || session.chatPhase === 'idle') {
          setChatPhase(session.chatPhase);
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

  // EF-59: 更新会话的完成状态（消息 + chatPhase）
  // 当助手回复完成时调用，确保 sessions[].messages 与 UI messages 同步
  // EF-59 CTO Fix: 使用 sessionsRef 而非 state updater，确保持久化真正被 await
  const updateSessionWithCompletedResponse = useCallback(
    async (sessionId: string, finalMessages: ChatMessage[], finalChatPhase: 'done' | 'idle') => {
      // EF-59 CTO Fix: 使用 ref 计算最终 sessions，不依赖 state updater
      const updatedSessions = sessionsRef.current.map(session =>
        session.id === sessionId
          ? {
              ...session,
              messages: finalMessages,
              chatPhase: finalChatPhase,
              updatedAt: Date.now(),
            }
          : session
      );
      
      // 更新 ref 和 state
      sessionsRef.current = updatedSessions;
      setSessions(updatedSessions);
      
      // EF-59 CTO Fix: 真正 await 持久化，不在 state updater 中调用
      try {
        await saveChatSessions(updatedSessions);
        await AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, sessionId);
      } catch (err) {
        console.error('[EF-59] Failed to persist session after completion:', err);
        throw err;
      }
    },
    []
  );

  // EF-38: Centralized turn transition functions
  // These functions atomically update session state and persist to storage

  // EF-38: Mark turn as generating (before chatStart)
  // EF-38 CTO Fix: One authoritative transition that creates/updates session + user message + generating state
  const markTurnGenerating = useCallback(
    async (
      sessionId: string,
      userMessage: ChatMessage,
      pendingTurn: PendingTurn,
      title: string,
      roleId: string,
      conversationId?: string
    ) => {
      const currentSessions = sessionsRef.current;
      const existingIdx = currentSessions.findIndex(s => s.id === sessionId);
      const existingSession = currentSessions[existingIdx];
      
      // Build updated messages: include user message
      const updatedMessages = existingIdx >= 0
        ? [...existingSession.messages, userMessage]
        : [userMessage];
      
      // Create or update session with generating state
      const sessionData = {
        id: sessionId,
        roleId,
        title,
        messages: updatedMessages,
        createdAt: existingIdx >= 0 ? existingSession.createdAt : Date.now(),
        updatedAt: Date.now(),
        conversationId,
        turnStatus: 'generating' as TurnStatus,
        pendingTurn,
        chatPhase: 'responding' as const,
      };
      
      let updatedSessions: ChatSession[];
      if (existingIdx >= 0) {
        updatedSessions = [...currentSessions];
        updatedSessions[existingIdx] = sessionData;
      } else {
        updatedSessions = [...currentSessions, sessionData];
      }
      
      // Synchronously update ref and state
      sessionsRef.current = updatedSessions;
      setSessions(updatedSessions);
      
      // Await persistence
      await saveChatSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, sessionId);
    },
    []
  );

  // EF-38: Mark turn as interrupted (during hydration recovery)
  const markTurnInterrupted = useCallback(
    async (sessionId: string) => {
      const updatedSessions = sessionsRef.current.map(session =>
        session.id === sessionId
          ? {
              ...session,
              turnStatus: 'interrupted' as TurnStatus,
              chatPhase: 'idle' as const,
              updatedAt: Date.now(),
            }
          : session
      );
      sessionsRef.current = updatedSessions;
      setSessions(updatedSessions);
      await saveChatSessions(updatedSessions);
    },
    []
  );

  // EF-38: Finalize turn as completed (after UI completion)
  const finalizeTurnCompleted = useCallback(
    async (sessionId: string, finalMessages: ChatMessage[]) => {
      const updatedSessions = sessionsRef.current.map(session =>
        session.id === sessionId
          ? {
              ...session,
              messages: finalMessages,
              turnStatus: 'completed' as TurnStatus,
              pendingTurn: undefined,
              chatPhase: 'done' as const,
              updatedAt: Date.now(),
            }
          : session
      );
      sessionsRef.current = updatedSessions;
      setSessions(updatedSessions);
      await saveChatSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, sessionId);
    },
    []
  );

  // EF-38: Mark turn as failed (on error)
  const markTurnFailed = useCallback(
    async (sessionId: string, keepMessages?: ChatMessage[]) => {
      const updatedSessions = sessionsRef.current.map(session => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          messages: keepMessages || session.messages,
          turnStatus: 'failed' as TurnStatus,
          chatPhase: 'idle' as const,
          updatedAt: Date.now(),
        };
      });
      sessionsRef.current = updatedSessions;
      setSessions(updatedSessions);
      await saveChatSessions(updatedSessions);
    },
    []
  );

  // EM-43: 发送核心函数（内部使用，不直接暴露）
  const sendMessageCore = useCallback(
    async (
      userMessage: string,
      snapshot: SendSnapshot,
      isRetry: boolean = false
    ): Promise<'success' | 'chatstart_failed' | 'sse_failed' | 'interrupted' | 'failed'> => {
      // 确保当前角色与快照一致
      const roleToUse = roles.find(r => r.id === snapshot.roleId) || currentRole;

      // 设置 abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 同步更新持久状态
      conversationIdRef.current = snapshot.conversationId;
      setConversationId(snapshot.conversationId);
      // EF-59 SETTER TRACE
      console.trace('[EF59_SETTER_TRACE] setCurrentSessionId called', {
        value: String(snapshot.sessionId),
        source: 'sendMessageCore',
        timestamp: Date.now()
      });
      setCurrentSessionId(snapshot.sessionId);
      // EF-59: 立即持久化 current_session_id（不依赖 useEffect）
      AsyncStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, snapshot.sessionId).catch(err => {
        console.error('[EF-59] Failed to persist current_session_id on send:', err);
      });
      setCurrentRole(roleToUse);

      // EF-38 CTO Fix: Create ONE user message with consistent ID
      // This ID will be used for: visible messages, session.messages, pendingTurn.userMessageId
      // For retry, we use the existing pendingTurn.userMessageId to maintain identity
      const userMsgId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      };

      // EF-59 CTO Fix: 使用 replaceMessages 更新 ref 和 state (仅首次，retry 不重复创建)
      if (!isRetry) {
        replaceMessages(prev => [...prev, userMsg]);
      }

      setChatPhase('responding');
      setIsThinking(true);
      setIsLoading(true);
      setError(null);
      setLightAnalysis('');

      // EF-38 CTO Fix: One authoritative transition
      // Creates/updates session + user message + generating state in one operation
      // This replaces the separate setSessions call to avoid race condition
      const pendingTurn: PendingTurn = {
        requestId: snapshot.requestId,
        userMessageId: userMsgId,  // EF-38: Use same ID as userMsg
        userMessage,
        startedAt: Date.now(),
        roleId: snapshot.roleId,
        conversationId: snapshot.conversationId,
      };
      
      // EF-38: Mark turn as generating BEFORE chatStart
      // This creates/updates session with user message and generating state
      await markTurnGenerating(
        snapshot.sessionId,
        userMsg,
        pendingTurn,
        userMessage.slice(0, 30),  // title
        snapshot.roleId,
        snapshot.conversationId
      );

      // EF-59: 确保有后端对话 ID 后再持久化
      let backendConvId = conversationIdRef.current;
      if (!backendConvId && !isRetry) {
        // 首次发送消息，创建后端对话
        const newConv = await createConversation('default-user', roleToUse.id);
        if (newConv) {
          backendConvId = newConv.id;
          conversationIdRef.current = backendConvId;
        }
      }
      if (backendConvId && !isRetry) {
        persistMessage(backendConvId, {
          role: 'user',
          content: userMessage,
          status: 'sent',
          requestId: snapshot.requestId,
        }).catch(err => console.error('[EF-59] User message persist failed:', err));
      }

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

        // EF-59 Fix: 明确区分 backendSessionId（后端 UUID）和 clientSessionId（前端 session_xxx）
        // backendSessionId 用于 SSE streaming，clientSessionId 用于 UI 状态管理
        const { sessionId: backendSessionId, reactionLayer, companionLayer, frontFlowText, reactionTimeline, companionTimeline, flowContext: fc } = sessionInfo;
        setFlowContext(fc);

        // ====== 第二阶段：EmotionFlow V3 动态缓冲引擎 ======
        // Reaction（8s→18s→30s）→ Companion（动态填充，Deep就绪时立即切断接管）
        const bubbleMsgId = `bubble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 初始内容：Reaction第一段 或 fallback
        const firstReaction = reactionTimeline?.[0]?.text || reactionLayer || frontFlowText || '';
        let displayedContent = firstReaction;
        const chatStartTime = Date.now();
        const assistantTimestamp = Date.now();

        // EF-59 CTO Fix: 使用 replaceMessages 更新 ref 和 state
        replaceMessages(prev => [...prev, {
          id: bubbleMsgId,
          role: 'assistant',
          content: firstReaction,
          timestamp: assistantTimestamp,
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
        
        // EF-38: Stream outcome tracking for error handling
        const streamState = { outcome: 'completed' as 'completed' | 'error' | 'empty' };

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
            // EF-59 CTO Fix: 使用 replaceMessages 更新 ref 和 state
            replaceMessages(prev =>
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
            // EF-59 CTO Fix: 使用 replaceMessages 更新 ref 和 state
            replaceMessages(prev =>
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
            await chatStream(backendSessionId, {
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
                streamState.outcome = 'error';
                scheduleNext();
              },
            });
          } catch { /* ignore */ }
        })();

        // ── 启动打字机 ──
        scheduleNext();

        // EF-59 Fix: 不再用 backendSessionId 覆盖 currentSessionId
        // currentSessionId 已在 sendMessageCore 开头设置为 snapshot.sessionId（前端 ID）
        // backendSessionId 仅用于 SSE streaming，不用于 UI 状态管理
        console.log('[EF59_FIX] Skipping setCurrentSessionId(backendSessionId)', {
          backendSessionId,
          currentSessionId: snapshot.sessionId,
          source: 'SSE_processing',
          timestamp: Date.now()
        });
        setIsLoading(false);

        // EF-59 Fix: 等待 UI 渲染完全完成，而不仅仅是 SSE 完成
        // 必须等待：SSE 完成 + 队列清空 + typing 完成 + chatPhase = done
        // EF-38 Fix: 添加超时机制，防止无限等待
        let uiCompletionTimedOut = false;
        await new Promise<void>((resolve) => {
          const startTime = Date.now();
          const MAX_WAIT_TIME = 30000; // 30 seconds max wait
          
          const checkUiComplete = () => {
            if (!mountedRef.current) {
              resolve();
              return;
            }
            
            // EF-38: 超时检查 - 防止无限等待
            if (Date.now() - startTime > MAX_WAIT_TIME) {
              console.warn('[EF-38] UI completion timeout, marking as interrupted', {
                isDeepDone,
                textQueueLength: textQueue.length,
                typingTimerActive: typingTimer !== null,
                companionChainLength: remainingCompanionChain.length,
                chatPhase: chatPhaseRef.current,
              });
              uiCompletionTimedOut = true;
              resolve();
              return;
            }
            
            // 条件 1: SSE 必须完成
            if (!isDeepDone) {
              const timer = setTimeout(checkUiComplete, 100);
              timersRef.current.push(timer);
              return;
            }
            
            // 条件 2: 队列必须为空
            if (textQueue.length > 0) {
              const timer = setTimeout(checkUiComplete, 50);
              timersRef.current.push(timer);
              return;
            }
            
            // 条件 3: typing 定时器必须为空
            if (typingTimer !== null) {
              const timer = setTimeout(checkUiComplete, 50);
              timersRef.current.push(timer);
              return;
            }
            
            // 条件 4: companion 链必须为空
            if (remainingCompanionChain.length > 0) {
              const timer = setTimeout(checkUiComplete, 100);
              timersRef.current.push(timer);
              return;
            }
            
            // 条件 5: chatPhase 必须为 'done'
            // 使用 ref 来获取最新的 chatPhase 值
            if (chatPhaseRef.current !== 'done') {
              const timer = setTimeout(checkUiComplete, 100);
              timersRef.current.push(timer);
              return;
            }
            
            // 所有条件满足，UI 渲染完成
            console.log('[EF-59] UI completion confirmed', {
              isDeepDone,
              textQueueLength: textQueue.length,
              typingTimerActive: typingTimer !== null,
              companionChainLength: remainingCompanionChain.length,
              chatPhase: chatPhaseRef.current,
              timestamp: Date.now()
            });
            resolve();
          };
          checkUiComplete();
        });

        // EF-38: 如果超时，标记为 interrupted 而不是 completed
        if (uiCompletionTimedOut) {
          console.warn('[EF-38] Finalizing as interrupted due to timeout');
          await markTurnInterrupted(snapshot.sessionId);
          retrySnapshotRef.current = null;
          regenerateSnapshotRef.current = null;
          return 'interrupted';
        }

        // EF-38: 如果流式传输出错，标记为 failed
        if (streamState.outcome === 'error') {
          console.warn('[EF-38] Finalizing as failed due to stream error');
          await markTurnFailed(snapshot.sessionId);
          retrySnapshotRef.current = null;
          regenerateSnapshotRef.current = null;
          return 'failed';
        }

        // EF-59: UI 完全完成后，构建最终消息数组并原子性持久化
        // EF-59 CTO Fix: 使用 messagesRef.current 而非捕获的 messages，避免 stale state
        const finalAssistantMessage: ChatMessage = {
          id: bubbleMsgId,
          role: 'assistant',
          content: displayedContent,
          timestamp: assistantTimestamp,
        };
        
        // EF-59 CTO Fix: 从 ref 构建最终消息数组，确保使用最新状态
        const currentMessages = messagesRef.current;
        const hasAssistantBubble = currentMessages.some(m => m.id === bubbleMsgId);
        
        let finalMessages: ChatMessage[];
        if (hasAssistantBubble) {
          // 替换占位助手消息为完成的消息
          finalMessages = currentMessages.map(m => 
            m.id === bubbleMsgId ? finalAssistantMessage : m
          );
        } else {
          // EF-59 CTO Fix: 如果 bubble 不存在，追加而非静默返回空列表
          console.warn('[EF-59] Assistant bubble not found in messages, appending');
          finalMessages = [...currentMessages, finalAssistantMessage];
        }
        
        // 原子性更新 UI 状态和持久化
        messagesRef.current = finalMessages;
        setMessages(finalMessages);
        setChatPhase('done');
        
        // EF-38: 持久化到 session（使用显式构建的最终消息数组）
        // finalizeTurnCompleted 会设置 turnStatus='completed', 移除 pendingTurn, chatPhase='done'
        await finalizeTurnCompleted(snapshot.sessionId, finalMessages);

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

        // EF-38: Persist failed/interrupted state
        await markTurnFailed(snapshot.sessionId);

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
    async (fn: () => Promise<'success' | 'chatstart_failed' | 'sse_failed' | 'interrupted' | 'failed'>): Promise<'success' | 'chatstart_failed' | 'sse_failed' | 'interrupted' | 'failed'> => {
      // 关键修复：如果被阻止，立即返回，不进入 try-finally
      if (sendingRef.current) {
        console.log('[sendMessage] Blocked by sendingRef guard');
        // 直接返回，不执行 finally 块
        return 'chatstart_failed';
      }
      
      sendingRef.current = true;
      setIsLoading(true);
      
      let result: 'success' | 'chatstart_failed' | 'sse_failed' | 'interrupted' | 'failed';
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
  // EF-38: Also support retry from persisted pendingTurn after refresh
  const retryLastMessage = useCallback(async () => {
    // First try in-memory snapshot (normal case)
    let snapshot = retrySnapshotRef.current;
    
    // EF-38: If no in-memory snapshot, try to reconstruct from persisted pendingTurn
    if (!snapshot && currentSessionId) {
      const session = sessionsRef.current.find(s => s.id === currentSessionId);
      if (session?.turnStatus === 'interrupted' && session?.pendingTurn) {
        console.log('[EF-38] Reconstructing retry from persisted pendingTurn');
        const pendingTurn = session.pendingTurn;
        snapshot = {
          requestId: pendingTurn.requestId,
          conversationId: pendingTurn.conversationId || '',
          sessionId: currentSessionId,
          roleId: pendingTurn.roleId,
          message: pendingTurn.userMessage,
        };
      }
    }
    
    if (!snapshot) {
      console.log('[retry] No retry snapshot available');
      return;
    }

    await withSendGuard(() => sendMessageCore(snapshot.message, snapshot, true));
  }, [withSendGuard, sendMessageCore, currentSessionId]);

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
  // EF-38: Also check for persisted pendingTurn for retry after refresh
  const currentSessionForRetry = sessions.find(s => s.id === currentSessionId);
  const canRetry = retrySnapshotRef.current !== null || 
    (currentSessionForRetry?.turnStatus === 'interrupted' && !!currentSessionForRetry?.pendingTurn);
  const canRegenerate = regenerateSnapshotRef.current !== null;

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const loadSessionFn = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const role = roles.find(r => r.id === session.roleId);
    setCurrentRole(role || roles[0]);
    // EF-59 SETTER TRACE
    console.trace('[EF59_SETTER_TRACE] setCurrentSessionId called', {
      value: String(session.id),
      source: 'loadSession',
      timestamp: Date.now()
    });
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
        // EF-59 Fix: 水合状态
        isHydrated,
        // EF-38: Turn lifecycle for interrupted generation recovery
        turnStatus: currentSession?.turnStatus || 'idle',
        isInterrupted: currentSession?.turnStatus === 'interrupted' ? true : false,
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