/**
 * EmotionFlow V3.2 — 轻量信号提取器
 * 
 * 从用户原话中提取 eventHint / feelingHint / keyword
 * 不依赖百炼，不调用任何重模型，纯规则匹配
 */

import type { EventHint, FeelingHint } from './localProfiles';

export interface Signal {
  keyword: string;
  eventHint: EventHint;
  feelingHint: FeelingHint;
}

// ─── 事件模式（按优先级排序：更具体的在前） ──────────

interface EventPattern {
  patterns: RegExp[];
  hint: EventHint;
}

const EVENT_PATTERNS: EventPattern[] = [
  { patterns: [/没[有]?回复|已读不[回理]|发信息.*没回|不回信息/], hint: 'silence' },
  { patterns: [/吵[架闹]|冷战|闹矛盾|翻旧账|争[吵执]/], hint: 'relationship_conflict' },
  { patterns: [/批[评评]|被[训骂说你]|领[导老板].*[批评骂说]|挨[骂训批]|被说[了]?/], hint: 'criticism' },
  { patterns: [/压[力大]|加班|熬夜|kpi|绩[效考]|考[核试]|报表|项目.*[急赶催]|工作.*[多难累]/], hint: 'work_pressure' },
  { patterns: [/好?累[了]?|疲惫|提不起[劲精神]|没力[气]|耗[竭尽]|[倦厌]了/], hint: 'burnout' },
  { patterns: [/没.{0,2}意思|没意义|人生|活着.*[累累意]|不想活|为什么.*[活]|一切.*[没无]|空[虚]|迷失|方向.*[明失没]/], hint: 'meaningless' },
  { patterns: [/焦[虑]|紧[张]|担[心]|害怕|不[安]|慌|没[底]|恐[惧慌]|心[里].*[悬跳]/], hint: 'anxiety' },
  { patterns: [/难[过受]|委[屈]|伤[心心]|哭[了]|泪|孤[独单]|难过|伤悲/], hint: 'sadness' },
  { patterns: [/生[气气]|愤[怒]|火[大]|气[死疯了]|烦|恼火/], hint: 'anger' },
];

// ─── 感受线索 ──────────────────────────────────────────

const FEELING_PATTERNS: { patterns: RegExp[]; hint: FeelingHint }[] = [
  { patterns: [/悬|等?.?回|不确定|没底/], hint: '悬着' },
  { patterns: [/反复|一遍遍|转.*停|绕.*去/], hint: '反复想' },
  { patterns: [/委屈|不值|不公平/], hint: '委屈' },
  { patterns: [/累|疲|乏/], hint: '累' },
  { patterns: [/紧张|担心|慌|恐/], hint: '慌' },
  { patterns: [/堵|闷|压/], hint: '闷' },
  { patterns: [/空|虚|没.*意/], hint: '空' },
  { patterns: [/沉重|重/], hint: '沉重' },
];

// ─── 关键词提取 ────────────────────────────────────────

function extractKeyword(message: string): string {
  // 优先提取引号内的内容
  const quoteMatch = message.match(/[「『""]([^」』""]+)[」』""]/);
  if (quoteMatch) return quoteMatch[1].trim();

  // 提取核心名词短语（2-4字）
  const keyPhrases = [
    /没[有]?回复/, /领[导老板]/, /[他她]不回/, /不[回理睬答应]/,
    /老[公婆]/, /男[朋友]/, /女[朋友]/, /同[事学]/, /父[母亲]/, /家[人]/, 
    /吵[架闹]/, /批[评评]/, /工[作作]/, /失[眠睡]/, 
    /没.{0,2}意思/, /焦[虑]/, /担[心]/, /生[气气]/,
    /累/, /难[过受]/, /委[屈]/, /孤[独单]/,
  ];
  for (const pattern of keyPhrases) {
    const match = message.match(pattern);
    if (match) return match[0];
  }

  return message.slice(0, 8);
}

// ─── 主函数 ─────────────────────────────────────────────

export function extractSignal(message: string): Signal {
  const trimmed = message.trim();
  const keyword = extractKeyword(trimmed);

  // 事件匹配
  let eventHint: EventHint = 'general';
  for (const ep of EVENT_PATTERNS) {
    if (ep.patterns.some(p => p.test(trimmed))) {
      eventHint = ep.hint;
      break;
    }
  }

  // 感受匹配
  let feelingHint: FeelingHint = '';
  for (const fp of FEELING_PATTERNS) {
    if (fp.patterns.some(p => p.test(trimmed))) {
      feelingHint = fp.hint;
      break;
    }
  }

  return { keyword, eventHint, feelingHint };
}