// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — FlowSignals: 单条消息心理位置提取
// 纯规则，不依赖LLM，不依赖外部服务
// ═══════════════════════════════════════════════════════════════

import type { FlowPosition } from './flowTypes';

// ─── 信号词词典 ────────────────────────────────────────

// 认知轴：分析侧（+1方向）
const ANALYTICAL_WORDS = [
  '因为', '所以', '原因', '逻辑', '分析', '按理说',
  '从…角度', '客观', '理性', '道理', '应该', '必须',
  '为什么', '是不是因为', '本质上', '从理性上',
  '大概率', '大概率是', '可能性', '判断', '衡量',
  '对比', '标准', '结论', '推理', '论证',
];

// 认知轴：感受侧（-1方向）
const FEELING_WORDS = [
  '感觉', '觉得', '心里', '胸口', '胃', '堵', '闷', '沉',
  '难受', '喘不上气', '压', '痛', '酸', '紧',
  '不舒服', '不好受', '揪心', '窒息', '发麻',
  '身体', '呼吸', '心跳', '眼泪', '哭',
];

// 归因轴：内归/自责（-1方向）
const INTERNAL_ATTRIBUTION_WORDS = [
  '我错了', '我不好', '我不够', '我的问题', '我做错了',
  '我太差', '我不行', '是我的错', '我太敏感', '我想太多',
  '我能力不够', '我不够好', '我太弱', '我太笨',
  '都是我的错', '我活该', '我自作自受',
];

// 归因轴：外归/抱怨（+1方向）
const EXTERNAL_ATTRIBUTION_WORDS = [
  '他', '他们', '领导', '老板', '公司', '环境',
  '凭什么', '太过分', '不公平', '凭什么要我',
  '别人都', '人家', '他们不懂', '没人理解',
  '世界', '社会', '命运', '老天',
];

// 行动轴：掌控（+1方向）
const AGENCY_WORDS = [
  '我要', '我决定', '我选择', '我打算', '明天开始',
  '计划', '先…再', '第一步', '我想试试', '我准备',
  '我可以', '我能', '我能够', '我主动', '我改变',
  '我试着', '我尝试', '我迈出', '我行动',
];

// 行动轴：无力（-1方向）
const HELPLESSNESS_WORDS = [
  '没办法', '控制不了', '算了', '放弃', '只能',
  '就这样吧', '改变不了', '没得选', '别无选择',
  '无力', '无能为力', '只能接受', '被迫',
  '被逼', '由不得我', '听天由命', '随它吧',
];

// 抽象层信号（优先级从低到高）
const ABSTRACTION_SIGNALS: { level: number; words: string[] }[] = [
  {
    level: 0, // 事件层
    words: [
      '今天', '昨天', '明天', '领导', '同事', '老板',
      '他说', '她说', '他们', '公司', '工作', '家里',
      '早上', '下午', '晚上', '刚才', '那时候',
      '发消息', '打电话', '开会', '见面', '吃饭',
    ],
  },
  {
    level: 1, // 情绪层
    words: [
      '难受', '焦虑', '生气', '伤心', '委屈', '孤独',
      '害怕', '担心', '烦', '累', '疲惫', '愤怒',
      '失望', '无助', '痛苦', '压抑', '不安', '紧张',
      '慌', '开心', '高兴', '激动', '平静', '安宁',
      '恐惧', '恐慌', '羞耻', '愧疚', '嫉妒',
    ],
  },
  {
    level: 2, // 念头层（反刍/归因/解读）
    words: [
      '是不是', '为什么', '会不会', '该不该', '要不要',
      '能不能', '是不是我', '难道', '难道说',
      '是不是因为', '会不会是', '可能因为',
      '我在想', '我怀疑', '我觉得是',
    ],
  },
  {
    level: 3, // 模式层
    words: [
      '总是', '每次', '从来', '一直', '又一次',
      '又来了', '又这样', '老是这样', '总是这样',
      '从小到大', '一直以来', '我这人', '我这个人',
      '我就是', '我从来都', '又…又',
    ],
  },
  {
    level: 4, // 存在层
    words: [
      '意义', '活着', '人生', '价值', '死亡', '自由',
      '为什么活着', '为什么而活', '存在的意义',
      '生命', '活着的意义', '活下去', '死了',
      '自我', '我是谁', '我到底想要什么',
      '方向', '目标', '使命', '归宿',
    ],
  },
];

// ─── 工具函数 ──────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countWords(text: string, words: string[]): number {
  let count = 0;
  for (const w of words) {
    // 支持精确匹配和模式匹配（含通配符）
    if (w.includes('…')) {
      // 通配符模式：如 "先…再" 匹配 "先做这个再做那个"
      const [start, end] = w.split('…');
      const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedStart + '.+' + escapedEnd, 'g');
      const matches = text.match(regex);
      if (matches) count += matches.length;
    } else {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const matches = text.match(regex);
      if (matches) count += matches.length;
    }
  }
  return count;
}

function countAnyWord(text: string, wordList: string[]): number {
  let count = 0;
  for (const w of wordList) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const matches = text.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

// ─── 主函数 ────────────────────────────────────────────

/**
 * 从单条用户消息中提取心理位置（FlowPosition）
 * 纯规则匹配，不依赖LLM
 */
export function extractFlowSignals(message: string): FlowPosition {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      cognition: 0,
      attribution: 0,
      agency: 0,
      abstraction: 0,
      rawText: trimmed,
    };
  }

  // 1. 认知轴
  const analyticalCount = countAnyWord(trimmed, ANALYTICAL_WORDS);
  const feelingCount = countAnyWord(trimmed, FEELING_WORDS);
  const totalWords = trimmed.replace(/\s/g, '').length;
  const rawCognition = totalWords > 0
    ? (analyticalCount - feelingCount) / Math.max(totalWords, 1)
    : 0;
  const cognition = clamp(rawCognition * 10, -1, 1); // 放大系数10，使短消息仍能产生有意义的值

  // 2. 归因轴
  const internalCount = countAnyWord(trimmed, INTERNAL_ATTRIBUTION_WORDS);
  const externalCount = countAnyWord(trimmed, EXTERNAL_ATTRIBUTION_WORDS);
  const rawAttribution = totalWords > 0
    ? (externalCount - internalCount) / Math.max(totalWords, 1)
    : 0;
  const attribution = clamp(rawAttribution * 10, -1, 1);

  // 3. 行动轴
  const agencyCount = countAnyWord(trimmed, AGENCY_WORDS);
  const helplessCount = countAnyWord(trimmed, HELPLESSNESS_WORDS);
  const rawAgency = totalWords > 0
    ? (agencyCount - helplessCount) / Math.max(totalWords, 1)
    : 0;
  const agency = clamp(rawAgency * 10, -1, 1);

  // 4. 抽象层：从高到低匹配，取最高层级
  let abstraction = 0;
  for (let level = 4; level >= 0; level--) {
    const signals = ABSTRACTION_SIGNALS.find(s => s.level === level);
    if (signals && countAnyWord(trimmed, signals.words) > 0) {
      abstraction = level;
      break;
    }
  }

  return {
    cognition: Math.round(cognition * 100) / 100,
    attribution: Math.round(attribution * 100) / 100,
    agency: Math.round(agency * 100) / 100,
    abstraction,
    rawText: trimmed,
  };
}