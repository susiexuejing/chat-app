export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
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
  requestId: string;
  userMessageId: string;
  userMessage: string;
  startedAt: number;
  roleId: string;
  conversationId?: string;
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
