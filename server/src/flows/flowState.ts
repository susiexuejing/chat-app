// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — FlowState: 流动状态判定
// 基于轨迹特征判断 stuck / flowing / oscillating / deepening
// ═══════════════════════════════════════════════════════════════

import type { FlowPosition, FlowStatus } from './flowTypes';
import { getRecent, getDelta, isAbstractionIncreasing, isOscillating } from './flowBuffer';

/**
 * 判断当前轨迹的流动状态
 *
 * 判定优先级（从上到下）：
 * 1. stuck → 最近3条所有轴 delta < 0.15
 * 2. oscillating → cognition 或 attribution 出现正负交替
 * 3. deepening → abstraction 最近3条单调递增
 * 4. flowing → 默认状态
 */
export function determineFlowStatus(trajectory: FlowPosition[]): FlowStatus {
  if (trajectory.length < 2) {
    return 'flowing'; // 数据不足时默认流动
  }

  // ─── stuck 判定 ──────────────────────────────────────
  // 最近3条所有轴的变化幅度 < 0.15
  const recentThree = getRecent({ positions: trajectory, updatedAt: Date.now() }, 3);
  if (recentThree.length >= 3) {
    const allStuck = (() => {
      for (let i = 1; i < recentThree.length; i++) {
        const delta = getDelta(recentThree[i - 1], recentThree[i]);
        if (
          Math.abs(delta.deltaCognition) >= 0.15 ||
          Math.abs(delta.deltaAttribution) >= 0.15 ||
          Math.abs(delta.deltaAgency) >= 0.15 ||
          Math.abs(delta.deltaAbstraction) >= 0.15
        ) {
          return false;
        }
      }
      return true;
    })();

    if (allStuck) return 'stuck';
  }

  // ─── oscillating 判定 ────────────────────────────────
  // cognition 或 attribution 出现正负交替
  const cognitionValues = trajectory.map(p => p.cognition);
  const attributionValues = trajectory.map(p => p.attribution);

  if (isOscillating(cognitionValues) || isOscillating(attributionValues)) {
    return 'oscillating';
  }

  // ─── deepening 判定 ──────────────────────────────────
  // abstraction 最近3条单调递增
  if (isAbstractionIncreasing(trajectory)) {
    return 'deepening';
  }

  // ─── flowing 默认 ────────────────────────────────────
  return 'flowing';
}