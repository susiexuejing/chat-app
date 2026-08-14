export type ResponseLayer = 'reaction' | 'companion' | 'deep';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // EF-104: Optional only for additive hydration of legacy stored messages.
  // Every newly accepted user/assistant entity is created with a turnId.
  turnId?: string;
  // EF-104: Required on newly created assistant entities. Legacy assistant
  // messages remain readable without inventing a historical layer.
  responseLayer?: ResponseLayer;
  isThinking?: boolean;
  // 深度分析结果（新版 analyze API 输出格式）
  deepAnalysis?: DeepAnalysisData;
}

// 新版深度分析数据结构
export interface DeepAnalysisData {
  fact?: string;
  interpretation?: string;
  possible_cognitive_pattern?: string | string[];
  reframe?: string;
}

// EF-38: Turn lifecycle status for interrupted generation recovery
export type TurnStatus = 'idle' | 'generating' | 'completed' | 'interrupted' | 'failed';

// EF-38: Pending turn information for recovery after refresh
export interface PendingTurn {
  // EF-104: Created once when input is accepted and reused by Retry.
  // Optional only so legacy pending records can be hydrated safely.
  turnId?: string;
  requestId: string;
  userMessageId: string;
  userMessage: string;
  startedAt: number;
  roleId: string;
  conversationId?: string;
  responseMessageIds?: Partial<Record<ResponseLayer, string>>;
}

export interface ChatSession {
  id: string;
  roleId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  // EF-59: 持久化聊天阶段，用于恢复 UI 状态
  chatPhase?: 'idle' | 'responding' | 'companion' | 'waiting_deep' | 'deep_arriving' | 'done';
  // EF-38: Turn lifecycle for interrupted generation recovery
  turnStatus?: TurnStatus;
  pendingTurn?: PendingTurn;
}

// AnalysisResult used by textAnalyzer.ts
export interface AnalysisResult {
  emotions: string[];
  keyEvent: string;
  keywords: string[];
  interactionOptions: Array<{ label: string; value: string }>;
}

// Alias for compatibility
export type LightAnalysisResult = AnalysisResult;
