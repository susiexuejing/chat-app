/**
 * Step 4 — Personality Active Evolution Experiment
 *
 * 人格回应策略权重演化引擎。
 * 纯函数：adjustWeights() 只计算不动存储，logWeightChange() 只写入实验日志。
 * 仅在 NODE_ENV=development 时被调用。
 *
 * 规则概要：
 * 1. FlowStage 驱动：stuck→holding↑, deepening+强度高→naming↑, loosening→gentlePush↑
 * 2. LTU 历史驱动：self_blame 重复→Fox cognitiveReframe↑, Bear companion↑
 * 3. ChangeBlock 趋势驱动：agency↑→leaveSpace↑/holding↓, selfBlame↑→Fox cognitiveReframe↑
 * 4. 人格偏差加权：Fox cognitiveReframe 2x, Bear companion/safetyRebuild 2x, Elf bodyAwareness 2x
 * 5. 低数据量（<3轮）时调整幅度 ≤0.05
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  ResponseWeights,
  WeightSnapshot,
  EvolutionFactor,
  DEFAULT_WEIGHTS,
  ROLE_SPECIFIC_DIMENSIONS,
  MAX_DELTA_PER_ROUND,
  ROLE_BIAS_MULTIPLIERS,
  LOW_DATA_THRESHOLD,
  LOW_DATA_MAX_DELTA,
} from './evolutionTypes';
import type { FlowContext } from './flowTypes';

// ═══════════════════════════════════════════════════════════════
// 默认权重
// ═══════════════════════════════════════════════════════════════

export function getDefaultWeights(roleId: string): ResponseWeights {
  const weights: ResponseWeights = { ...DEFAULT_WEIGHTS, updatedAt: Date.now() };
  const specificDims = ROLE_SPECIFIC_DIMENSIONS[roleId] || [];
  for (const dim of specificDims) {
    (weights as Record<string, unknown>)[dim as string] = 0.5;
  }
  return weights;
}

// ═══════════════════════════════════════════════════════════════
// 权重调整（核心函数 — 纯函数）
// ═══════════════════════════════════════════════════════════════

export function adjustWeights(
  userId: string,
  roleId: string,
  flowContext: FlowContext | null,
  ltuProfile: {
    totalInteractions?: number;
    recurringFlowPatterns?: string[];
    emotionalTriggers?: string[];
    roleSpecific?: { roleId: string; data: Record<string, string[]> };
  } | null,
  trendData: {
    agencyChange?: number;
    selfBlameChange?: number;
    reflectionChange?: number;
  } | null,
  currentWeights: ResponseWeights | null,
): { weights: ResponseWeights; trigger: { factor: EvolutionFactor; detail: string } } {
  // 初始化 / 兜底
  const weights: ResponseWeights = currentWeights
    ? { ...currentWeights, version: currentWeights.version + 1, updatedAt: Date.now() }
    : getDefaultWeights(roleId);

  const deltas: Record<string, number> = {};
  const reasons: string[] = [];

  // 判断是否低数据量
  const interactions = ltuProfile?.totalInteractions ?? 0;
  const maxDelta = interactions < LOW_DATA_THRESHOLD ? LOW_DATA_MAX_DELTA : MAX_DELTA_PER_ROUND;

  // ── Rule 1: FlowStage 驱动 ──
  if (flowContext) {
    const { flowStage, flowStrength, flowConfidence } = flowContext;

    if (flowStage === 'stuck' && flowConfidence >= 0.5) {
      deltas.holding = (deltas.holding ?? 0) + maxDelta * 0.7;
      deltas.gentlePush = (deltas.gentlePush ?? 0) - maxDelta * 0.5;
      reasons.push(`flowStage=stuck → holding↑, gentlePush↓`);
    }

    if (flowStage === 'deepening' && flowStrength >= 0.7) {
      deltas.naming = (deltas.naming ?? 0) + maxDelta * 0.7;
      reasons.push(`flowStage=deepening+strength${flowStrength} → naming↑`);
    }

    if (flowStage === 'deepening' && flowStrength < 0.3) {
      deltas.companion = (deltas.companion ?? 0) + maxDelta * 0.5;
      reasons.push(`flowStage=deepening+strength${flowStrength} → companion↑`);
    }

    if (flowStage === 'loosening' && flowConfidence >= 0.6) {
      deltas.gentlePush = (deltas.gentlePush ?? 0) + maxDelta * 0.7;
      deltas.leaveSpace = (deltas.leaveSpace ?? 0) + maxDelta * 0.3;
      reasons.push(`flowStage=loosening+confidence${flowConfidence} → gentlePush↑, leaveSpace↑`);
    }
  }

  // ── Rule 2: LTU 历史驱动 ──
  if (ltuProfile) {
    const patterns = ltuProfile.recurringFlowPatterns ?? [];
    const triggers = ltuProfile.emotionalTriggers ?? [];
    const rs = ltuProfile.roleSpecific;

    // self_blame 重复（totalInteractions>=3 且出现过self_blame）
    const hasSelfBlame = patterns.some(p => p.includes('self_blame') || p.includes('自责'));
    if (hasSelfBlame && ltuProfile.totalInteractions >= 3) {
      if (roleId === 'clever-fox') {
        deltas.cognitiveReframe = (deltas.cognitiveReframe ?? 0) + maxDelta * 0.7;
        reasons.push(`self_blame×${ltuProfile.totalInteractions} → cognitiveReframe↑`);
      }
      if (roleId === 'warm-bear') {
        deltas.companion = (deltas.companion ?? 0) + maxDelta * 0.7;
        reasons.push(`self_blame×${ltuProfile.totalInteractions} → companion↑`);
      }
    }

    // loneliness 触发 → holding↑
    if (triggers.some(t => t.includes('loneliness') || t.includes('孤独'))) {
      deltas.holding = (deltas.holding ?? 0) + maxDelta * 0.5;
      if (roleId === 'warm-bear') {
        deltas.safetyRebuild = (deltas.safetyRebuild ?? 0) + maxDelta * 0.7;
        reasons.push(`loneliness → safetyRebuild↑`);
      } else {
        reasons.push(`loneliness → holding↑`);
      }
    }

    // 角色专属：精灵 bodySignals → bodyAwareness↑
    if (rs && roleId === 'emotion-elf') {
      const bodyData = rs.data?.bodySignals ?? [];
      if (bodyData.length > 0) {
        deltas.bodyAwareness = (deltas.bodyAwareness ?? 0) + maxDelta * 0.5;
        reasons.push(`bodySignals detected → bodyAwareness↑`);
      }
    }

    // 角色专属：小象 relationshipPatterns → relationshipCheck↑
    if (rs && roleId === 'family-elephant') {
      const relData = rs.data?.relationshipPatterns ?? [];
      if (relData.length > 0) {
        deltas.relationshipCheck = (deltas.relationshipCheck ?? 0) + maxDelta * 0.5;
        reasons.push(`relationshipPatterns detected → relationshipCheck↑`);
      } else {
        // 默认小象会关注关系，微调
        deltas.relationshipCheck = (deltas.relationshipCheck ?? 0) + maxDelta * 0.15;
      }
    }

    // 角色专属：猫头鹰 patternObservation
    if (roleId === 'wise-owl') {
      const patterns = rs?.data?.recurringThemes ?? [];
      if (patterns.length > 0) {
        deltas.patternObservation = (deltas.patternObservation ?? 0) + maxDelta * 0.5;
        reasons.push(`recurringThemes detected → patternObservation↑`);
      }
    }

    // 角色专属：海豚 meaningExploration
    if (roleId === 'philosophical-dolphin') {
      const meaningData = rs?.data?.meaningQuestions ?? [];
      if (meaningData.length > 0) {
        deltas.meaningExploration = (deltas.meaningExploration ?? 0) + maxDelta * 0.5;
        reasons.push(`meaningQuestions detected → meaningExploration↑`);
      }
    }
  }

  // ── Rule 3: ChangeBlock 趋势驱动 ──
  if (trendData) {
    const { agencyChange = 0, selfBlameChange = 0 } = trendData;

    if (agencyChange > 0.2) {
      deltas.leaveSpace = (deltas.leaveSpace ?? 0) + maxDelta * 0.5;
      deltas.holding = (deltas.holding ?? 0) - maxDelta * 0.3;
      reasons.push(`agencyChange=${agencyChange.toFixed(2)} > 0.2 → leaveSpace↑, holding↓`);
    }

    if (selfBlameChange > 0.3) {
      deltas.leaveSpace = (deltas.leaveSpace ?? 0) + maxDelta * 0.3;
      if (roleId === 'clever-fox') {
        deltas.cognitiveReframe = (deltas.cognitiveReframe ?? 0) + maxDelta * 0.3;
        reasons.push(`selfBlameChange=${selfBlameChange.toFixed(2)} > 0.3 → cognitiveReframe↑`);
      }
    }

    if (agencyChange < -0.2) {
      deltas.companion = (deltas.companion ?? 0) + maxDelta * 0.5;
      deltas.gentlePush = (deltas.gentlePush ?? 0) - maxDelta * 0.3;
      reasons.push(`agencyChange=${agencyChange.toFixed(2)} < -0.2 → companion↑, gentlePush↓`);
    }
  }

  // ── 角色偏差加权 ──
  const biases = ROLE_BIAS_MULTIPLIERS[roleId] ?? {};
  for (const [dim, multiplier] of Object.entries(biases)) {
    if (deltas[dim] !== undefined) {
      deltas[dim] = (deltas[dim] ?? 0) * multiplier;
    }
  }

  // ── 应用 deltas，限制范围 ──
  const allDims: (keyof ResponseWeights)[] = [
    'holding', 'naming', 'companion', 'gentlePush', 'leaveSpace',
    'cognitiveReframe', 'safetyRebuild', 'patternObservation',
    'bodyAwareness', 'meaningExploration', 'relationshipCheck',
  ];

  for (const dim of allDims) {
    const delta = deltas[dim as string];
    if (delta !== undefined && dim in weights) {
      const currentVal = (weights[dim] as number) ?? 0.5;
      (weights[dim] as number) = clamp(currentVal + delta, 0.3, 0.8);
    }
  }

  // 无任何触发时的 startup 记录
  const factor: EvolutionFactor = reasons.length === 0 ? 'startup' : (
    reasons.some(r => r.includes('flowStage')) ? 'flowStage' :
    reasons.some(r => r.includes('blame') || r.includes('loneliness') || r.includes('Signals')) ? 'ltuPattern' :
    reasons.some(r => r.includes('Change') || r.includes('change')) ? 'trend' : 'startup'
  );

  return {
    weights,
    trigger: {
      factor,
      detail: reasons.length > 0 ? reasons.join('; ') : 'no adjustment triggered',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 日志记录（JSONL）
// ═══════════════════════════════════════════════════════════════

function getEvolutionDir(): string {
  return path.join(process.cwd(), 'data', 'evolution');
}

export function logWeightChange(
  userId: string,
  roleId: string,
  snapshot: WeightSnapshot,
): void {
  try {
    const dir = getEvolutionDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, `${userId}_${roleId}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(snapshot) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[Evolution] Log error:`, err instanceof Error ? err.message : err);
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}