// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — FlowBuffer: 滑动窗口轨迹管理
// 窗口大小 5，只保存用户消息，不保存人格回复
// ═══════════════════════════════════════════════════════════════

import type { FlowPosition, FlowVector, FlowBufferData } from './flowTypes';

const BUFFER_MAX_SIZE = 5;

// ─── 创建新缓冲区 ──────────────────────────────────────

export function createFlowBuffer(): FlowBufferData {
  return {
    positions: [],
    updatedAt: Date.now(),
  };
}

// ─── 从持久化数据恢复 ──────────────────────────────────

export function restoreFlowBuffer(data: FlowBufferData | null): FlowBufferData {
  if (data && Array.isArray(data.positions)) {
    return {
      positions: data.positions.slice(-BUFFER_MAX_SIZE),
      updatedAt: data.updatedAt || Date.now(),
    };
  }
  return createFlowBuffer();
}

// ─── 追加新位置 ────────────────────────────────────────

export function pushFlowPosition(
  buffer: FlowBufferData,
  position: FlowPosition
): FlowBufferData {
  const newPositions = [...buffer.positions, position];

  // 超出窗口大小，移除最旧的
  if (newPositions.length > BUFFER_MAX_SIZE) {
    newPositions.shift();
  }

  return {
    positions: newPositions,
    updatedAt: Date.now(),
  };
}

// ─── 获取完整轨迹（正序） ───────────────────────────────

export function getTrajectory(buffer: FlowBufferData): FlowPosition[] {
  return [...buffer.positions];
}

// ─── 获取最近 N 条轨迹 ─────────────────────────────────

export function getRecent(buffer: FlowBufferData, window: number = 3): FlowPosition[] {
  const positions = buffer.positions;
  if (positions.length <= window) {
    return [...positions];
  }
  return positions.slice(-window);
}

// ─── 计算两点之间的位移向量 ─────────────────────────────

export function getDelta(
  from: FlowPosition,
  to: FlowPosition
): FlowVector {
  return {
    deltaCognition: to.cognition - from.cognition,
    deltaAttribution: to.attribution - from.attribution,
    deltaAgency: to.agency - from.agency,
    deltaAbstraction: to.abstraction - from.abstraction,
  };
}

// ─── 计算轨迹总位移（首尾差） ───────────────────────────

export function getTotalDelta(trajectory: FlowPosition[]): FlowVector | null {
  if (trajectory.length < 2) return null;
  return getDelta(trajectory[0], trajectory[trajectory.length - 1]);
}

// ─── 计算方向一致性 ────────────────────────────────────

/**
 * 计算轨迹方向一致性分数
 * 分数越高表示轨迹方向越稳定（持续朝一个方向移动）
 */
export function getDirectionConsistency(trajectory: FlowPosition[]): number {
  if (trajectory.length < 3) return 1.0; // 数据不足时默认一致性高

  const deltas: FlowVector[] = [];
  for (let i = 1; i < trajectory.length; i++) {
    deltas.push(getDelta(trajectory[i - 1], trajectory[i]));
  }

  // 对每个轴检查符号一致性
  const signChecks = [
    deltas.map(d => Math.sign(d.deltaCognition)),
    deltas.map(d => Math.sign(d.deltaAttribution)),
    deltas.map(d => Math.sign(d.deltaAgency)),
    deltas.map(d => Math.sign(d.deltaAbstraction)),
  ];

  let consistentAxes = 0;
  for (const signs of signChecks) {
    const nonZeroSigns = signs.filter(s => s !== 0);
    if (nonZeroSigns.length <= 1) {
      consistentAxes++;
      continue;
    }
    const firstSign = nonZeroSigns[0];
    const allSame = nonZeroSigns.every(s => s === firstSign);
    if (allSame) consistentAxes++;
  }

  return consistentAxes / signChecks.length;
}

// ─── 检查抽象层是否单调递增 ─────────────────────────────

export function isAbstractionIncreasing(trajectory: FlowPosition[]): boolean {
  if (trajectory.length < 3) return false;
  const recent = trajectory.slice(-3);
  return (
    recent[0].abstraction < recent[1].abstraction &&
    recent[1].abstraction < recent[2].abstraction
  );
}

// ─── 检查轴是否在振荡（符号交替） ────────────────────────

export function isOscillating(values: number[]): boolean {
  if (values.length < 4) return false;
  const recent = values.slice(-4);
  const signs = recent.map(v => Math.sign(v));
  // 检查是否为 [+, -, +, -] 或 [-, +, -, +] 模式
  return (
    (signs[0] > 0 && signs[1] < 0 && signs[2] > 0 && signs[3] < 0) ||
    (signs[0] < 0 && signs[1] > 0 && signs[2] < 0 && signs[3] > 0)
  );
}

// ─── 序列化（用于持久化） ──────────────────────────────

export function serializeBuffer(buffer: FlowBufferData): FlowBufferData {
  return {
    positions: buffer.positions.map(p => ({
      ...p,
      rawText: p.rawText, // 保留原文用于后续序列匹配
    })),
    updatedAt: buffer.updatedAt,
  };
}