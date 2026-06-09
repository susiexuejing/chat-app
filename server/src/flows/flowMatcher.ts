// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — FlowMatcher: Flow Pattern 匹配引擎
// 10个心理流向的序列模式识别
// ═══════════════════════════════════════════════════════════════

import type {
  FlowPosition,
  FlowMatch,
  FlowPatternType,
  FlowPatternDefinition,
} from './flowTypes';
import { getTotalDelta, getDirectionConsistency } from './flowBuffer';

// ─── 10个 Flow Pattern 定义 ────────────────────────────

const PATTERNS: FlowPatternDefinition[] = [
  {
    type: 'self_blame',
    fromLabel: 'external_event',
    toLabel: 'self_worth',
    expectedDirection: {
      attributionFrom: 0,      // 中性或外归
      attributionTo: -0.3,     // 向内归方向移动
      abstractionTrend: 'up',  // 抽象层上升（事件→模式）
    },
    abstractionPattern: [
      [0, 1, 2],
      [0, 2, 3],
      [0, 1, 2, 3],
    ],
    signals: [
      '是不是我', '我做错了', '我不好', '我不够',
      '我太差', '是我的错', '我能力不行',
    ],
    conflictsWith: ['attachment_anxiety', 'anger_to_hurt'],
  },
  {
    type: 'attachment_anxiety',
    fromLabel: 'relationship_uncertainty',
    toLabel: 'abandonment_fear',
    expectedDirection: {
      attributionFrom: 0.2,    // 倾向于外归（对方行为）
      attributionTo: -0.2,     // 向内移动（自我怀疑）
      abstractionTrend: 'up',
    },
    abstractionPattern: [
      [0, 1, 2],
      [0, 2, 2],
      [0, 1, 2, 2],
    ],
    signals: [
      '没回', '已读不回', '冷淡', '敷衍',
      '不喜欢我', '不在乎', '不重要', '烦我了',
    ],
    conflictsWith: ['self_blame'],
  },
  {
    type: 'anger_to_hurt',
    fromLabel: 'anger',
    toLabel: 'hurt',
    expectedDirection: {
      cognitionFrom: 0.2,      // 分析/指责
      cognitionTo: -0.2,       // 转向感受
      attributionFrom: 0.3,    // 外归
      attributionTo: 0,        // 归因趋于中性
      abstractionTrend: 'flat',
    },
    abstractionPattern: [
      [0, 1],
      [0, 1, 1],
      [1, 1, 2],
    ],
    signals: [
      '凭什么', '太过分', '凭什么要我', '凭什么这样',
      '不公平', '他凭什么', '他们凭什么',
    ],
    conflictsWith: ['self_blame', 'external_blame_to_self_contact'],
  },
  {
    type: 'control_to_helplessness',
    fromLabel: 'control_attempt',
    toLabel: 'helplessness',
    expectedDirection: {
      agencyFrom: 0.2,         // 曾有掌控感
      agencyTo: -0.3,          // 滑向无力
      abstractionTrend: 'flat',
    },
    abstractionPattern: [
      [0, 1],
      [1, 1],
      [0, 1, 1],
    ],
    signals: [
      '试了很多方法', '试了没用', '什么方法都试了',
      '改变不了', '没办法', '只能', '算了', '就这样吧',
      '尽力了', '能做的都做了',
    ],
    conflictsWith: ['avoidance_to_action'],
  },
  {
    type: 'analysis_to_feeling',
    fromLabel: 'intellectual_analysis',
    toLabel: 'embodied_feeling',
    expectedDirection: {
      cognitionFrom: 0.3,      // 分析侧
      cognitionTo: -0.2,       // 转向感受侧
      abstractionTrend: 'flat',
    },
    abstractionPattern: [
      [2, 1],
      [2, 1, 1],
      [2, 2, 1],
    ],
    signals: [
      '道理我都懂', '我知道应该', '按理说', '理性上',
      '道理明白', '知道该', '但心里', '但胸口',
      '但身体', '但还是难受',
    ],
    conflictsWith: [],
  },
  {
    type: 'chaos_to_structure',
    fromLabel: 'chaos',
    toLabel: 'structure',
    expectedDirection: {
      agencyFrom: -0.3,        // 开始无力
      agencyTo: 0,             // 逐渐恢复
      attributionFrom: 0,
      attributionTo: 0,
      abstractionTrend: 'down', // 从发散到聚焦（抽象层下降）
    },
    abstractionPattern: [
      [2, 0],
      [2, 1, 0],
      [1, 2, 0],
    ],
    signals: [
      '好乱', '太乱了', '不知道从哪说起', '太多事',
      '脑子很乱', '一团乱', '乱七八糟', '理不清',
      '帮我理理', '不知道该先想哪个',
    ],
    conflictsWith: ['control_to_helplessness'],
  },
  {
    type: 'avoidance_to_action',
    fromLabel: 'avoidance',
    toLabel: 'micro_action',
    expectedDirection: {
      agencyFrom: -0.4,        // 无力/停滞
      agencyTo: 0.1,           // 出现微行动
      cognitionFrom: 0,
      cognitionTo: 0,
      abstractionTrend: 'down', // 从抽象担忧回到具体行动
    },
    abstractionPattern: [
      [1, 0],
      [2, 0],
      [1, 1, 0],
    ],
    signals: [
      '什么都不想做', '提不起劲', '不想动', '躺了一天',
      '起不来', '动不了', '洗了个澡', '终于',
      '强迫自己', '逼自己', '试着做了',
    ],
    conflictsWith: ['control_to_helplessness'],
  },
  {
    type: 'external_blame_to_self_contact',
    fromLabel: 'external_blame',
    toLabel: 'self_need',
    expectedDirection: {
      attributionFrom: 0.3,    // 外归
      attributionTo: -0.1,     // 收回内在
      cognitionFrom: 0.2,      // 分析/评判
      cognitionTo: -0.2,       // 感受自己
      abstractionTrend: 'flat',
    },
    abstractionPattern: [
      [0, 2],
      [0, 1, 2],
      [0, 0, 2],
    ],
    signals: [
      '他们太过分', '他们不懂', '没人理解',
      '其实我只是', '说到底', '我只是想要',
      '我只希望', '我真正需要的是',
    ],
    conflictsWith: ['anger_to_hurt', 'self_blame'],
  },
  {
    type: 'surface_event_to_deep_pattern',
    fromLabel: 'surface_event',
    toLabel: 'deep_pattern',
    expectedDirection: {
      attributionFrom: 0,
      attributionTo: 0,
      abstractionTrend: 'up',  // 抽象层显著上升
    },
    abstractionPattern: [
      [0, 2, 3],
      [0, 1, 3],
      [0, 3],
      [0, 2, 3, 3],
    ],
    signals: [
      '又', '又一次', '每次都', '每次都是',
      '我发现我总', '我好像一直', '从小到大',
      '总是这样', '历史重演', '老毛病',
    ],
    conflictsWith: ['self_blame', 'emptiness_to_meaning'],
  },
  {
    type: 'emptiness_to_meaning',
    fromLabel: 'emptiness',
    toLabel: 'meaning_exploration',
    expectedDirection: {
      agencyFrom: -0.3,        // 无力
      agencyTo: 0.1,           // 重新探索
      cognitionFrom: 0.2,      // 分析反思
      cognitionTo: -0.2,       // 感受层面
      abstractionTrend: 'up',  // 走向存在层
    },
    abstractionPattern: [
      [3, 4],
      [2, 4],
      [1, 3, 4],
      [2, 3, 4],
    ],
    signals: [
      '没意思', '没意义', '活着干嘛', '为什么活着',
      '不知道为了什么', '虚无', '空', '空洞',
      '不知道自己要什么', '方向在哪', '意义在哪',
    ],
    conflictsWith: ['control_to_helplessness'],
  },
];

// ─── 工具函数 ──────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 方向匹配得分（权重 0.4）
 * 检查轨迹的首尾位移是否与 pattern 的预期方向一致
 */
function scoreDirection(
  trajectory: FlowPosition[],
  pattern: FlowPatternDefinition
): number {
  if (trajectory.length < 2) return 0;

  const delta = getTotalDelta(trajectory);
  if (!delta) return 0;

  let score = 0;

  // 检查 attribution 方向
  const dir = pattern.expectedDirection;
  if (dir.attributionFrom !== undefined && dir.attributionTo !== undefined) {
    const firstAtt = trajectory[0].attribution;
    const lastAtt = trajectory[trajectory.length - 1].attribution;
    // 判断是否从 from 方向向 to 方向移动
    const movingTowardTo = (lastAtt - firstAtt) * Math.sign(dir.attributionTo - dir.attributionFrom) > 0;
    if (movingTowardTo) score += 0.15;
  }

  // 检查 agency 方向
  if (dir.agencyFrom !== undefined && dir.agencyTo !== undefined) {
    const firstAge = trajectory[0].agency;
    const lastAge = trajectory[trajectory.length - 1].agency;
    const movingTowardTo = (lastAge - firstAge) * Math.sign(dir.agencyTo - dir.agencyFrom) > 0;
    if (movingTowardTo) score += 0.15;
  }

  // 检查 cognition 方向
  if (dir.cognitionFrom !== undefined && dir.cognitionTo !== undefined) {
    const firstCog = trajectory[0].cognition;
    const lastCog = trajectory[trajectory.length - 1].cognition;
    const movingTowardTo = (lastCog - firstCog) * Math.sign(dir.cognitionTo - dir.cognitionFrom) > 0;
    if (movingTowardTo) score += 0.1;
  }

  return score;
}

/**
 * 抽象层轨迹匹配得分（权重 0.3）
 * 检查抽象层序列是否与 pattern 的典型路径匹配
 */
function scoreAbstractionPattern(
  trajectory: FlowPosition[],
  pattern: FlowPatternDefinition
): number {
  if (trajectory.length < 2) return 0;

  const absSeq = trajectory.map(p => p.abstraction);

  let bestMatch = 0;
  for (const template of pattern.abstractionPattern) {
    // 使用最长公共子序列思想简化匹配
    let matches = 0;
    const minLen = Math.min(absSeq.length, template.length);
    for (let i = 0; i < minLen; i++) {
      if (absSeq[absSeq.length - minLen + i] === template[i]) {
        matches++;
      }
    }
    const rate = matches / Math.max(template.length, 1);
    if (rate > bestMatch) bestMatch = rate;
  }

  return bestMatch;
}

/**
 * 信号词匹配得分（权重 0.2）
 * 在最近两条消息中搜索 pattern 的典型信号词
 */
function scoreSignals(
  recentTexts: string[],
  pattern: FlowPatternDefinition
): number {
  const combined = recentTexts.join(' ');
  let matchCount = 0;

  for (const signal of pattern.signals) {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const found = combined.match(regex);
    if (found) matchCount += found.length;
  }

  // 归一化到 0~1
  return Math.min(matchCount / Math.max(pattern.signals.length, 1), 1);
}

/**
 * 冲突排除（权重 -0.3 ~ 0）
 * 检查当前 pattern 与已匹配的 pattern 是否存在冲突
 */
function scoreConflict(
  pattern: FlowPatternDefinition,
  alreadyMatched: FlowPatternType[]
): number {
  if (alreadyMatched.length === 0) return 0;

  let penalty = 0;
  for (const matchedType of alreadyMatched) {
    if (pattern.conflictsWith.includes(matchedType)) {
      penalty -= 0.3;
    }
  }

  return penalty;
}

// ─── 主匹配函数 ────────────────────────────────────────

/**
 * 匹配 Flow Pattern
 * @param trajectory 用户消息轨迹（最近 5 轮）
 * @param recentTexts 最近两条消息原文
 * @returns 按 matchScore 降序排列的匹配结果
 */
export function matchFlowPatterns(
  trajectory: FlowPosition[],
  recentTexts: string[]
): FlowMatch[] {
  if (trajectory.length < 1) return [];

  const results: FlowMatch[] = [];
  const matchedTypes: FlowPatternType[] = [];

  // 第一轮：计算所有 pattern 的分数
  const rawScores: { pattern: FlowPatternDefinition; score: number }[] = [];

  for (const pattern of PATTERNS) {
    const dirScore = scoreDirection(trajectory, pattern);
    const absScore = scoreAbstractionPattern(trajectory, pattern);
    const sigScore = scoreSignals(recentTexts, pattern);

    // 加权求和
    const baseScore = dirScore * 0.4 + absScore * 0.3 + sigScore * 0.2;

    rawScores.push({ pattern, score: baseScore });
  }

  // 按分数排序
  rawScores.sort((a, b) => b.score - a.score);

  // 第二轮：应用冲突排除
  for (const { pattern, score } of rawScores) {
    const conflictPenalty = scoreConflict(pattern, matchedTypes);
    const finalScore = clamp(score + conflictPenalty, 0, 1);

    if (finalScore > 0.05) {
      matchedTypes.push(pattern.type);

      results.push({
        flowType: pattern.type,
        from: pattern.fromLabel,
        to: pattern.toLabel,
        matchScore: Math.round(finalScore * 100) / 100,
        confidence: 0, // 暂填，后面计算
        strength: 0,   // 暂填，后面计算
      });
    }
  }

  // 第三轮：计算 confidence 和 strength
  if (results.length === 0) return results;

  const topScore = results[0].matchScore;
  const secondScore = results.length > 1 ? results[1].matchScore : 0;

  for (let i = 0; i < results.length; i++) {
    // confidence = maxScore / (maxScore + secondMaxScore + 0.1)
    results[i].confidence = Math.round(
      (topScore / (topScore + secondScore + 0.1)) * 100
    ) / 100;

    // strength = maxScore × trajectoryDirectionConsistency
    const consistency = getDirectionConsistency(trajectory);
    results[i].strength = Math.round(results[i].matchScore * consistency * 100) / 100;
  }

  return results;
}

/**
 * 获取所有 pattern 定义（用于外部读取和测试）
 */
export function getAllPatterns(): FlowPatternDefinition[] {
  return PATTERNS;
}