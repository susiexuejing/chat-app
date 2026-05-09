export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isThinking?: boolean;
  // 深度分析结果（6个角色视角）
  deepAnalysis?: {
    [roleName: string]: {
      analysis: string;
      insight: string;
    };
  };
}

export interface ChatSession {
  id: string;
  roleId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
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
