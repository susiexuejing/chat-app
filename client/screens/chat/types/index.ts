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

export interface ChatSession {
  id: string;
  roleId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
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
