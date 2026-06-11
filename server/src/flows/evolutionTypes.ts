/**
 * Step 4 — Personality Active Evolution Experiment
 *
 * 六人格回应策略权重演化实验系统。
 * 每轮 Deep 完成后，根据 FlowContext / LTU / ChangeBlock 调整权重。
 * 权重不注入 Deep Prompt，仅记录观测。
 * 仅在 NODE_ENV=development 时生效。
 */

// ─── 回应策略权重 ──────────────────────────────────────

export interface ResponseWeights {
  /** 通用维度（6人格共享，范围 0~1） */
  holding: number;        // 接住 — 确认感受、承接情绪
  naming: number;         // 命名 — 命名心理模式
  companion: number;      // 陪伴 — 提供安全感、温暖
  gentlePush: number;     // 轻微推进 — 引导前进、微小推动
  leaveSpace: number;     // 留下空间 — 留给用户表达空间

  /** 角色专属维度 */
  cognitiveReframe?: number;      // 狐狸 — 认知重构
  safetyRebuild?: number;         // 熊 — 安全感重建
  patternObservation?: number;    // 猫头鹰 — 模式觉察
  bodyAwareness?: number;         // 精灵 — 身体感受觉察
  meaningExploration?: number;    // 海豚 — 意义探索
  relationshipCheck?: number;     // 小象 — 关系结构审视

  /** 元数据 */
  version: number;
  updatedAt: number;
}

// ─── 权重快照（每轮记录） ───────────────────────────────

export type EvolutionFactor = 'flowStage' | 'ltuPattern' | 'trend' | 'startup';

export interface WeightSnapshot {
  timestamp: number;
  weights: ResponseWeights;
  trigger: {
    factor: EvolutionFactor;
    detail: string;
  };
  /** 本轮对话的 FlowContext（快照） */
  flowContext: {
    flowType: string;
    flowStage: string;
    flowStrength: number;
    flowConfidence: number;
  } | null;
  /** 趋势变化（来自 ChangeBlock） */
  trendData: {
    agencyChange: number;
    selfBlameChange: number;
    reflectionChange: number;
  } | null;
}

// ─── 默认配置 ───────────────────────────────────────────

export const DEFAULT_WEIGHTS: ResponseWeights = {
  holding: 0.5,
  naming: 0.5,
  companion: 0.5,
  gentlePush: 0.5,
  leaveSpace: 0.5,
  version: 1,
  updatedAt: 0,
};

export const ROLE_SPECIFIC_DIMENSIONS: Record<string, (keyof ResponseWeights)[]> = {
  'clever-fox': ['cognitiveReframe'],
  'warm-bear': ['safetyRebuild'],
  'wise-owl': ['patternObservation'],
  'emotion-elf': ['bodyAwareness'],
  'philosophical-dolphin': ['meaningExploration'],
  'family-elephant': ['relationshipCheck'],
};

/** 每轮最大调整幅度 */
export const MAX_DELTA_PER_ROUND = 0.15;

/** 角色偏差加权系数 */
export const ROLE_BIAS_MULTIPLIERS: Record<string, Record<string, number>> = {
  'clever-fox': { cognitiveReframe: 2.0 },
  'warm-bear': { companion: 2.0, safetyRebuild: 2.0 },
  'emotion-elf': { bodyAwareness: 2.0 },
};

/** 低数据量阈值：totalInteractions < 此值时严格控制调整 */
export const LOW_DATA_THRESHOLD = 3;
export const LOW_DATA_MAX_DELTA = 0.05;