/**
 * EM-43: 前两轮 Reaction 和 Companion 模板
 * 
 * 前两轮用户可见回复必须遵守：
 * - 先回应用户刚刚表达的具体内容和情绪
 * - 让用户感到被听见，而不是被系统分析
 * - 不下心理诊断
 * - 不定义用户的人格、模式或神经状态
 * - 不展示内部分析、阶段、标签、记忆判断或技术字段
 * - 不急于给建议、训练任务或解决方案
 * - 不推动用户立即行动
 * - 不使用明显模板化的心理咨询语言
 * - 每次最多自然地提出一个问题
 * - 如果无需提问，可以只做承接
 * - 回复应像一个真实的人在认真听，而不是像分析工具
 */

import type { TimelineSegment } from './localReactionEngine';

// ─── 前两轮 Reaction 时间线（更克制、更自然）──────────────

const FIRST_TWO_ROUNDS_REACTION: TimelineSegment[] = [
  { displayAt: 0, text: '嗯，我在听。' },
  { displayAt: 2, text: '你说的我记住了。' },
  { displayAt: 4, text: '慢慢说，不着急。' },
];

// ─── 前两轮 Companion 时间线（更克制、更自然）──────────────

const FIRST_TWO_ROUNDS_COMPANION: TimelineSegment[] = [
  { displayAt: 10, text: '我在这儿。' },
  { displayAt: 20, text: '你想说多少都说。' },
  { displayAt: 32, text: '不用急着想清楚。' },
];

/**
 * 获取前两轮 Reaction 时间线
 */
export function getFirstTwoRoundsReactionTimeline(): TimelineSegment[] {
  return [...FIRST_TWO_ROUNDS_REACTION];
}

/**
 * 获取前两轮 Companion 时间线
 */
export function getFirstTwoRoundsCompanionTimeline(): TimelineSegment[] {
  return [...FIRST_TWO_ROUNDS_COMPANION];
}
