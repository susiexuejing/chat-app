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
      [0, 2],
      [0, 1, 2],
      [0, 2, 3],
      [0, 1, 2, 3],
      [0, 0, 2],
      [0, 0, 2, 3],
      [0, 2, 2],       // 新增: [0,2,2]
      [0, 2, 2, 3],    // 新增: [0,2,2,3]
    ],
    signals: [
      '是不是我说错', '是不是我的问题', '是不是我做错了',
      '会不会是我', '可能是我不好', '一定是我不好', '都怪我',
      '是我的问题', '我做错了', '我不该', '都是我不好',
      '我不好', '我不够好', '我太差', '我能力不行',
      '是我的错', '我错了',
      // ─── 增强：自己开头的自责 ───
      '自己不好', '自己不行', '觉得自己不好',
      '觉得自己不行', '觉得自己能力不够',
      // ─── 增强：童年/模式类自责 ───
      '从小', '从小就', '从小就这样',
      '一遇到', '一有', '总觉得自己',
      '觉得自己就是', '我就是不行',
      '我就是不好', '我怎么都',
    ],
    shortMessageSignals: [     // ≤4字消息的信号词
      '怪我', '我错', '我的错', '我不好', '自己不好',
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
      '是不是讨厌我', '是不是不在意我',
      '是不是嫌弃我', '对我有意见',
    ],
    shortMessageSignals: [
      '没回', '不回', '冷淡', '敷衍',
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
      [0, 1, 0, 0],
      [1, 1, 2],
    ],
    signals: [
      '凭什么', '太过分', '凭什么要我', '凭什么这样',
      '不公平', '他凭什么', '他们凭什么',
      '凭什么我', '凭什么总是我', '为什么偏偏是我',
      '其实我只想', '我只想要', '其实我', '我只是想', '想被理解', '被理解', '想被看见',
    ],
    shortMessageSignals: [
      '凭什么', '太过分', '不公平', '其实我', '我只想', '被理解',
    ],
    conflictsWith: ['self_blame', 'external_blame_to_self_contact'],
  },
  {
    type: 'control_to_helplessness',
    fromLabel: 'control_attempt',
    toLabel: 'helplessness',
    expectedDirection: {
      agencyFrom: 0,            // 曾尝试过（不一定高掌控）
      agencyTo: -0.3,          // 滑向无力
      abstractionTrend: 'flat',
    },
    abstractionPattern: [
      [0, 1],
      [1, 1],
      [0, 1, 1],
      [0, 0, 1],
      [3, 0],       // 高抽象开始 → 回到事件层
      [3, 0, 0],    // 高抽象 → 连续事件层
      [3, 0, 0, 0],
    ],
    signals: [
      '试了很多方法', '试了没用', '什么方法都试了',
      '改变不了', '没办法', '只能', '算了', '就这样吧',
      '尽力了', '能做的都做了',
      // ─── 短消息增强 ───
      '没用', '没用了', '白费', '白费力气',
      '做什么都没用', '徒劳', '没一点用',
      '没任何用', '没意义', '有啥用', '有什么用',
      '改变不了什么', '控制不了', '无能为力',
      '不得不', '只好', '认了', '接受不了',
      // ─── 增强：更加细粒度 ───
      '试了好多', '试了很多', '试了各种',
      '都没用', '全没用', '一点用没有',
      '都改变不了', '什么都改变不了',
    ],
    shortMessageSignals: [
      '没用', '算了', '白费', '徒劳', '认了', '没救',
      '没戏', '完了', '不行了',
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
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0, 1],  // 分析→分析→中性→感受
    ],
    signals: [
      '道理我都懂', '我知道应该', '按理说', '理性上',
      '道理明白', '知道该', '但心里', '但胸口',
      '但身体', '但还是难受',
      // ─── 增强 ───
      '道理', '理性', '认知上', '理智上',
      '但胃', '但心', '但就是', '我知道',
      '我明白', '我懂', '理论上',
      // 身体感受信号
      '胸口堵', '心里堵', '心堵', '发紧',
      '身体紧', '胃里沉', '喘不上气', '堵得慌',
      // ─── 更精细的感受信号 ───
      '但我', '可是心里', '可是胸口',
      '胸口还是', '心里还是', '心口',
      '还是堵', '还是难受', '还是闷',
      '心里难受', '心里发紧', '胸口发闷',
      '喘不过气', '呼吸不过来', '堵在那里',
    ],
    shortMessageSignals: [
      '堵', '心堵', '胸口', '发紧', '憋',
    ],
    conflictsWith: ['avoidance_to_action'],
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
      [0, 2, 0],
      [0, 0, 2],
      [2, 2, 0],    // 持续混乱 → 结构化
      [2, 2, 2, 0], // 持续混乱 → 最终结构化
    ],
    signals: [
      '好乱', '太乱了', '不知道从哪说起', '不知道从哪说',
      '太多事', '脑子很乱', '一团乱', '乱七八糟', '理不清',
      '帮我理理', '不知道该先想哪个',
      // ─── 短消息增强 ───
      '乱', '脑子乱', '卡住了', '心里乱',
      '我好乱', '从何说起', '说不好',
      // ─── 进一步增强 ───
      '很乱', '特别乱', '先说什么', '先想哪个',
    ],
    shortMessageSignals: [
      '乱', '卡住', '很乱', '理不清',
    ],
    conflictsWith: ['control_to_helplessness', 'surface_event_to_deep_pattern'],
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
      [0, 0, 0],
    ],
    signals: [
      '什么都不想做', '提不起劲', '不想动', '躺了一天',
      '起不来', '动不了', '洗了个澡', '终于',
      '强迫自己', '逼自己', '试着做了',
      // ─── 增强 ───
      '躺在床上', '发呆', '躺着', '不想做',
      '应该做点什么', '应该动', '不能再躺',
      '挣扎着', '爬起来', '从床上', '下床',
    ],
    shortMessageSignals: [
      '不想', '不想动', '躺着', '发呆',
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
      [0, 0],      // 同层转移（外归→内省，归因变化但抽象不变）
      [0, 2],
      [0, 1, 2],
      [0, 0, 2],
      [0, 1, 1, 2],
    ],
    signals: [
      '他们太过分', '他们不懂', '没人理解',
      '其实我只是', '说到底', '我只是想要',
      '我只希望', '我真正需要的是',
      // ─── 增强 ───
      '其实我', '我其实', '说到底就是',
    ],
    shortMessageSignals: [
      '其实', '凭什么', '太过分',
    ],
    conflictsWith: ['anger_to_hurt', 'self_blame', 'surface_event_to_deep_pattern'],
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
      [0, 0, 3],
      [1, 3],
      [0, 0, 0, 3],
      [0, 0, 3, 3],
    ],
    signals: [
      '又', '又一次', '每次都', '每次都是',
      '我发现我总', '我好像一直', '从小到大',
      '总是这样', '历史重演', '老毛病',
      // ─── 增强 ───
      '从来都', '一直以来', '总是', '每次',
      '我意识到', '我发现了', '我才发现',
      '反复', '一次次', '一次又一次',
    ],
    shortMessageSignals: [
      '又', '总是', '每次', '从来',
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
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [1, 3, 4],
      [2, 3, 4],
      [0, 0, 4],
      [1, 1, 4],
    ],
    signals: [
      '没意思', '没意义', '活着干嘛', '为什么活着',
      '不知道为了什么', '虚无', '空', '空洞',
      '不知道自己要什么', '方向在哪', '意义在哪',
      // ─── 短消息增强 ───
      '没意思', '活着', '人生', '价值', '自由',
      '空心', '麻木', '图什么', '有啥意思',
      '毫无意义', '没有意义',
      // ─── 进一步增强 ───
      '重复', '每天都是', '天天这样',
      '到底想要什么', '真正想要',
      '什么对我重要', '什么才是',
    ],
    shortMessageSignals: [
      '没意思', '空', '麻木', '虚无', '没意义',
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
    // 方案A：从头匹配（起点是关键）
    let matches = 0;
    const minLen = Math.min(absSeq.length, template.length);
    for (let i = 0; i < minLen; i++) {
      if (absSeq[i] === template[i]) {
        matches++;
      }
    }
    let rate = matches / Math.max(template.length, 1);
    if (rate > bestMatch) bestMatch = rate;

    // 方案B：从尾匹配（终点是关键，适用于长序列后半段才出现显著位移）
    // 取 trajectory 的最后 template.length 个元素
    if (absSeq.length >= template.length) {
      matches = 0;
      const offset = absSeq.length - template.length;
      for (let i = 0; i < template.length; i++) {
        if (absSeq[offset + i] === template[i]) {
          matches++;
        }
      }
      rate = matches / Math.max(template.length, 1);
      if (rate > bestMatch) bestMatch = rate;
    }
  }

  return bestMatch;
}

/**
 * 判断消息是否是短消息（≤4个字）
 */
function isShortMessage(text: string): boolean {
  const chineseChars = text.replace(/[^\u4e00-\u9fff]/g, '');
  return chineseChars.length <= 4 && chineseChars.length > 0;
}

/**
 * 判断上一轮消息是否偏向分析侧（用于 analysis_to_feeling 序列感知）
 */
function isLastMessageAnalytical(trajectory: FlowPosition[]): boolean {
  if (trajectory.length < 2) return false;
  const last = trajectory[trajectory.length - 2];
  return last.cognition > 0.15;
}

/**
 * 信号词匹配得分（权重 0.2）
 * 在最近两条消息中搜索 pattern 的典型信号词
 * 对短消息（≤4字）使用 shortMessageSignals 进行补充匹配
 */
function scoreSignals(
  recentTexts: string[],
  pattern: FlowPatternDefinition
): number {
  const combined = recentTexts.join(' ');
  let matchCount = 0;
  const isShort = recentTexts.some(t => isShortMessage(t));

  // 使用主信号词匹配
  for (const signal of pattern.signals) {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const found = combined.match(regex);
    if (found) matchCount += found.length;
  }

  // 如果是短消息且该 pattern 有 shortMessageSignals，额外匹配
  if (isShort && pattern.shortMessageSignals) {
    for (const signal of pattern.shortMessageSignals) {
      const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const found = combined.match(regex);
      if (found) matchCount += found.length * 1.5; // 短消息匹配权重更高
    }
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

  // ─── 短消息兜底检查 ───
  // 如果最近一条消息 ≤4 个字，且没有任何 pattern 的 strongSignalMatch > 0.3
  // 则返回 null flowType（不强行匹配）
  const lastText = recentTexts[recentTexts.length - 1] || '';
  const isShortMsg = isShortMessage(lastText);
  const lastPosition = trajectory[trajectory.length - 1];
  
  // 短消息且所有轴均为中性 → 信号不足，不匹配任何 pattern
  const isNeutralPosition = 
    Math.abs(lastPosition.cognition) < 0.05 &&
    Math.abs(lastPosition.attribution) < 0.05 &&
    Math.abs(lastPosition.agency) < 0.05;

  // 如果短消息且中性位置，提前检查是否有任何 pattern 的 strongSignalMatch
  let hasStrongSignal = false;
  if (isShortMsg) {
    for (const pattern of PATTERNS) {
      const sigScore = scoreSignals(recentTexts, pattern);
      if (sigScore > 0.3) {
        hasStrongSignal = true;
        break;
      }
    }
  }

  // 第一轮：计算所有 pattern 的分数
  const rawScores: { pattern: FlowPatternDefinition; score: number }[] = [];

  for (const pattern of PATTERNS) {
    let dirScore = scoreDirection(trajectory, pattern);
    const absScore = scoreAbstractionPattern(trajectory, pattern);
    let sigScore = scoreSignals(recentTexts, pattern);

    // ─── 序列感知：analysis_to_feeling ───
    // 如果上一轮消息偏向分析侧，且当前消息有感受信号 → 给予加分
    if (pattern.type === 'analysis_to_feeling' && isLastMessageAnalytical(trajectory)) {
      const currentText = recentTexts[recentTexts.length - 1] || '';
      const feelingSignals = ['难受', '堵', '胸口', '心里', '身体', '胃', '紧', '沉', '闷'];
      const hasFeelingSignal = feelingSignals.some(s => currentText.includes(s));
      if (hasFeelingSignal) {
        sigScore = Math.min(sigScore + 0.4, 1);
      }
    }

    // ─── external_blame_to_self_contact 降权 ───
    // 这个 pattern 太容易被误匹配，除非有明确的"其实我只是"类转折词，否则降权
    if (pattern.type === 'external_blame_to_self_contact') {
      // 检查是否有真正的转范畴信号（仅检查当前消息）
      const currentMsg = recentTexts[recentTexts.length - 1] || '';
      const hasTransition = /其实|说到底|我只是|我只是想要|我只希望|我意识到|我发现|原来|我真正/.test(currentMsg);
      if (!hasTransition) {
        sigScore *= 0.3; // 无转折词时大幅降低信号权重
        dirScore *= 0.5; // 同时降低方向得分，减少对自我责备/表层→深层流向的误抢
      }
    }

    // 加权求和
    let baseScore = dirScore * 0.4 + absScore * 0.3 + sigScore * 0.2;
    
    // ─── control_to_helplessness 无信号降权 ───
    // 如果当前消息没有任何控制/无力信号词，表明该模式仅靠方向+抽象层匹配获胜
    // 这种纯机械匹配往往是误判（如用户只是叙事而非表达无力）
    if (pattern.type === 'control_to_helplessness' && sigScore === 0) {
      baseScore *= 0.5;
    }

    // ─── surface_event_to_deep_pattern 长期模式信号升权 ───
    // 当消息包含"从小到大/总是这样/一直如此"等长期模式信号时，
    // 给予小幅加分，打破与 external_blame 的机械平局
    if (pattern.type === 'surface_event_to_deep_pattern' && sigScore > 0) {
      const currentMsg = recentTexts[recentTexts.length - 1] || '';
      if (/从小到大|总是这样|一直都是|从来|每次都是|历史重演/.test(currentMsg)) {
        baseScore = Math.min(baseScore + 0.04, 1);
      }
    }

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

  // ─── 第四轮：短消息兜底 ───
  // 如果短消息 + 中性位置 + 无强信号 → 将 top match 降级为 mixed
  if (isShortMsg && isNeutralPosition && !hasStrongSignal && results.length > 0) {
    // 降低置信度
    const top = results[0];
    top.matchScore = Math.round(top.matchScore * 0.3 * 100) / 100;
    top.confidence = 0;
    top.strength = 0;
    // 标记为低置信（调用方通过 confidence < 0.4 判断为 mixed）
  }

  return results;
}

/**
 * 获取所有 pattern 定义（用于外部读取和测试）
 */
export function getAllPatterns(): FlowPatternDefinition[] {
  return PATTERNS;
}