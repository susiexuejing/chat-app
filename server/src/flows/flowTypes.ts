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
  /** ≤4字短消息专用信号词（用于短消息弱信号场景） */
  shortMessageSignals?: string[];
  /** 冲突排除：不应同时匹配的 pattern */
  conflictsWith: FlowPatternType[];
  /** 是否要求至少匹配1个信号词才生效（默认false） */
  requireSignalMatch?: boolean;
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

// ═══════════════════════════════════════════════════════════════
// Step 1 — Simplified FlowContext (for Deep prompt injection)
//  替代纯文本 frontFlowText 的结构化 JSON
// ═══════════════════════════════════════════════════════════════

export type FlowContextType =
  | 'self_blame'
  | 'anger_to_hurt'
  | 'attachment_anxiety'
  | 'analysis_to_feeling'
  | 'sadness_isolation'
  | 'anxiety_overwhelm'
  | 'body_tension'
  | 'relationship_conflict'
  | 'control_to_helplessness'
  | 'emptiness_numbness'
  | 'general_flow';

export type FlowContextStage = 'beginning' | 'deepening' | 'stuck' | 'loosening';
export type FlowContextRisk = 'none' | 'escalating' | 'rumination';

/**
 * 简化版 FlowContext
 * 用于注入 Deep prompt，替代纯文本 frontFlowText
 */
export interface FlowContext {
  /** 当前主导心理流向类型 */
  flowType: FlowContextType;
  /** 流向阶段 */
  flowStage: FlowContextStage;
  /** 流向强度 0~1 */
  flowStrength: number;
  /** 置信度 0~1 */
  flowConfidence: number;
  /** 潜在风险（可选） */
  flowRisk?: FlowContextRisk;
  /** 用户原始消息关键词（供人格参考） */
  keywords: string[];
}

// ═══════════════════════════════════════════════════════════════
// Phase 5 — Change System Type Definitions
// 用户变化感知系统：量化用户在长期对话中的心理演化
// ═══════════════════════════════════════════════════════════════

/** 单轮变化快照 */
export interface ChangeSnapshot {
  timestamp: number;
  /** 四维位置差值（与上一轮对比） */
  positionDelta: ChangeVector;
  /** 流动模式变化 */
  patternDelta: FlowPatternDelta;
  /** 当前匹配置信度 */
  confidence: number;
  /** 当前流动强度 */
  strength: number;
  /** 当前流动状态 */
  status: FlowStatus;
  /** 当前真实消息的 FlowPosition（用于后期回溯） */
  position: FlowPosition;
}

/** 四维变化向量 */
export interface ChangeVector {
  cognitionDelta: number;
  attributionDelta: number;
  agencyDelta: number;
  abstractionDelta: number;
}

/** 流动模式变化 */
export interface FlowPatternDelta {
  flowTypePrevious: string | null;
  flowTypeCurrent: string | null;
  directionChange: '保持' | '深化' | '转移' | '首次';
}

/** 变化历史档案 */
export interface ChangeHistory {
  userId: string;
  roleId: string;
  snapshots: ChangeSnapshot[];
  /** 最近20轮的趋势分析 */
  trendAnalysis?: {
    /** 归因变化趋势（正=外归↑/负=内归↑） */
    attributionTrend: number;
    /** 行动力趋势（正=掌控↑/负=无力↑） */
    agencyTrend: number;
    /** 抽象层趋势（正=模式觉察↑） */
    abstractionTrend: number;
    /** 认知轴趋势（正=分析化↑/负=感受化↑） */
    cognitionTrend: number;
    /** 流向深化度趋势 */
    flowDepthTrend: number;
    /** 自我责备变化（负=减少→正向变化） */
    selfBlameChange: number;
    /** 行动感变化（正=提升→正向变化） */
    agencyChange: number;
    /** 模式觉察变化（正=提升→正向变化） */
    reflectionChange: number;
  };
  updatedAt: number;
}