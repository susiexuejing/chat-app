// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4/V5 — Flow System + Change System 统一入口
// 独立模块，不接入百炼 / 不接入前端 / 不修改现有系统
// ═══════════════════════════════════════════════════════════════

import type { FlowPosition, FlowResult, FlowBufferData, ChangeSnapshot } from './flowTypes';
import { extractFlowSignals } from './flowSignals';
import {
  createFlowBuffer,
  restoreFlowBuffer,
  pushFlowPosition,
  getTrajectory,
  serializeBuffer,
} from './flowBuffer';
import { determineFlowStatus } from './flowState';
import { matchFlowPatterns } from './flowMatcher';
import { recordChange, getChangeBlock } from './changeSystem';

// ─── 内存缓存（当前不持久化，仅用于独立模块测试） ──────

const userFlowBuffers = new Map<string, FlowBufferData>();

function getBufferKey(userId: string, roleId: string): string {
  return `${userId}::${roleId}`;
}

// ─── 主入口 ────────────────────────────────────────────

/**
 * 分析用户消息，返回 FlowResult
 *
 * 当前阶段：仅输出结果，不接入 Deep Prompt
 * 下一阶段：讨论如何注入 Deep 提示词
 *
 * @param userId 用户标识
 * @param roleId 人格标识
 * @param message 当前用户消息
 * @returns FlowResult（含心理位置、流动状态、匹配的流向）
 */
export function analyzeFlow(
  userId: string,
  roleId: string,
  message: string
): FlowResult {
  // 1. 获取或创建用户 FlowBuffer
  const key = getBufferKey(userId, roleId);
  let buffer = userFlowBuffers.get(key);
  if (!buffer) {
    buffer = createFlowBuffer();
  }

  // 2. 提取当前消息的心理位置
  const position = extractFlowSignals(message);

  // 3. 加入轨迹
  buffer = pushFlowPosition(buffer, position);
  userFlowBuffers.set(key, buffer);

  // 4. 获取轨迹
  const trajectory = getTrajectory(buffer);

  // 5. 判断流动状态
  const status = determineFlowStatus(trajectory);

  // 6. 匹配 Flow Pattern
  const recentTexts = trajectory
    .slice(-2)
    .map(p => p.rawText)
    .filter(t => t.length > 0);

  const matches = matchFlowPatterns(trajectory, recentTexts);

  // 7. 组装结果
  const primaryFlow = matches.length > 0 ? matches[0] : null;
  const secondaryFlow = matches.length > 1 ? matches[1] : null;
  const isMixed = primaryFlow !== null && primaryFlow.confidence < 0.4;
  const isTransitioning = checkTransition(buffer);

  return {
    position,
    status,
    matches,
    primaryFlow,
    secondaryFlow,
    isMixed,
    isTransitioning,
    trajectoryLength: trajectory.length,
  };
}

/**
 * 检查是否发生流向突变
 * 最新一条消息的流向与之前的轨迹方向显著不同
 */
function checkTransition(buffer: FlowBufferData): boolean {
  const positions = buffer.positions;
  if (positions.length < 3) return false;

  const lastDelta = {
    cog: positions[positions.length - 1].cognition - positions[positions.length - 2].cognition,
    att: positions[positions.length - 1].attribution - positions[positions.length - 2].attribution,
    age: positions[positions.length - 1].agency - positions[positions.length - 2].agency,
  };

  // 检查是否存在显著的方向反转
  const significantChanges = [
    Math.abs(lastDelta.cog),
    Math.abs(lastDelta.att),
    Math.abs(lastDelta.age),
  ].filter(v => v > 0.2);

  return significantChanges.length >= 2;
}

/**
 * 获取当前用户的心理位置轨迹（用于外部查看）
 */
export function getFlowTrajectory(userId: string, roleId: string): FlowPosition[] {
  const key = getBufferKey(userId, roleId);
  const buffer = userFlowBuffers.get(key);
  if (!buffer) return [];
  return getTrajectory(buffer);
}

/**
 * 重置用户的心理位置缓存（用于测试）
 */
export function resetFlowBuffer(userId: string, roleId: string): void {
  const key = getBufferKey(userId, roleId);
  userFlowBuffers.set(key, createFlowBuffer());
}

/**
 * 清除所有缓存（用于测试）
 */
export function resetAllFlowBuffers(): void {
  userFlowBuffers.clear();
}

/**
 * 序列化所有缓冲区（为未来持久化预留接口）
 */
export function serializeAllBuffers(): Record<string, FlowBufferData> {
  const result: Record<string, FlowBufferData> = {};
  for (const [key, buffer] of userFlowBuffers.entries()) {
    result[key] = serializeBuffer(buffer);
  }
  return result;
}

/**
 * 格式化 FlowResult 为可读文本（用于测试和调试）
 */
export function formatFlowResult(result: FlowResult): string {
  const lines: string[] = [];
  lines.push('===== Flow System =====');
  lines.push('[Position]');
  lines.push(`  认知: ${result.position.cognition}`);
  lines.push(`  归因: ${result.position.attribution}`);
  lines.push(`  行动: ${result.position.agency}`);
  lines.push(`  抽象: ${result.position.abstraction}`);
  lines.push(`[State] ${result.status}`);
  lines.push('[Flow]');

  if (result.primaryFlow) {
    if (result.isMixed) {
      lines.push('  mixed（多流向冲突，交给人格判断）');
    } else {
      lines.push(`  当前流向: ${result.primaryFlow.flowType}`);
      lines.push(`  流向描述: ${result.primaryFlow.from} → ${result.primaryFlow.to}`);
      lines.push(`  流向强度: ${result.primaryFlow.strength}`);
      lines.push(`  置信度: ${result.primaryFlow.confidence}`);

      if (result.secondaryFlow && result.primaryFlow.confidence < 0.7) {
        lines.push(`  次流向: ${result.secondaryFlow.flowType} (${result.secondaryFlow.confidence})`);
      }
    }
  } else {
    lines.push('  (未匹配到显著流向)');
  }

  if (result.isTransitioning) {
    lines.push('  [⚠ 方向突变]');
  }

  lines.push(`  轨迹长度: ${result.trajectoryLength}`);
  lines.push('=======================');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Phase 5 — Change System 导出
// ═══════════════════════════════════════════════════════════════

export { recordChange, getChangeBlock, getChangeTrends, resetAllChangeHistory } from './changeSystem';
export type { ChangeSnapshot, ChangeHistory } from './flowTypes';