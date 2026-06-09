// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — Flow System Type Definitions
// 独立模块，不依赖任何现有系统
// ═══════════════════════════════════════════════════════════════

// ─── 心理位置：单条消息的四维坐标 ──────────────────────

export interface FlowPosition {
  /** 认知轴 -1~+1（-1=感受侧, +1=分析侧） */
  cognition: number;
  /** 归因轴 -1~+1（-1=内归/自责, +1=外归/抱怨） */
  attribution: number;
  /** 行动轴 -1~+1（-1=无力, +1=掌控） */
  agency: number;
  /** 抽象层 0~4（0=事件, 1=情绪, 2=念头, 3=模式, 4=存在） */
  abstraction: number;
  /** 原始消息文本（用于序列模式匹配） */
  rawText: string;
}

// ─── 位移向量：两点之间的变化 ──────────────────────────

export interface FlowVector {
  deltaCognition: number;
  deltaAttribution: number;
  deltaAgency: number;
  deltaAbstraction: number;
}

// ─── 流动状态 ──────────────────────────────────────────

export type FlowStatus = 'stuck' | 'flowing' | 'oscillating' | 'deepening';

// ─── Flow Pattern 类型 ─────────────────────────────────

export type FlowPatternType =
  | 'self_blame'
  | 'attachment_anxiety'
  | 'anger_to_hurt'
  | 'control_to_helplessness'
  | 'analysis_to_feeling'
  | 'chaos_to_structure'
  | 'avoidance_to_action'
  | 'external_blame_to_self_contact'
  | 'surface_event_to_deep_pattern'
  | 'emptiness_to_meaning';

// ─── Pattern 定义：10个心理流向的静态描述 ──────────────

export interface FlowPatternDefinition {
  type: FlowPatternType;
  fromLabel: string;
  toLabel: string;
  /** 预期方向：Δ向量应该满足的方向约束 */
  expectedDirection: {
    attributionFrom?: number;   // -1~+1 起始归因
    attributionTo?: number;     // -1~+1 结束归因
    agencyFrom?: number;
    agencyTo?: number;
    cognitionFrom?: number;
    cognitionTo?: number;
    abstractionTrend?: 'up' | 'down' | 'flat' | 'any';
  };
  /** 预期的抽象层轨迹模式 */
  abstractionPattern: number[][];
  /** 核心信号词（用于文本匹配） */
  signals: string[];
  /** 冲突排除：不应同时匹配的 pattern */
  conflictsWith: FlowPatternType[];
}

// ─── 匹配结果 ──────────────────────────────────────────

export interface FlowMatch {
  flowType: FlowPatternType;
  from: string;
  to: string;
  matchScore: number;
  confidence: number;
  strength: number;
}

// ─── 最终输出 ──────────────────────────────────────────

export interface FlowResult {
  position: FlowPosition;
  status: FlowStatus;
  matches: FlowMatch[];
  primaryFlow: FlowMatch | null;
  secondaryFlow: FlowMatch | null;
  /** 是否多流向冲突（confidence < 0.4） */
  isMixed: boolean;
  /** 是否检测到方向突变 */
  isTransitioning: boolean;
  trajectoryLength: number;
}

// ─── 缓冲区持久化数据 ─────────────────────────────────

export interface FlowBufferData {
  positions: FlowPosition[];
  updatedAt: number;
}