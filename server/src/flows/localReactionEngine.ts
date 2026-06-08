/**
 * EmotionFlow V3.2 — 本地Reaction/Companion组合器
 * 
 * 核心逻辑：
 * PersonalityProfile × Signal → 确定性模板匹配 → 时间线输出
 * 
 * 不依赖百炼，不调用重模型，不随机选取
 */

import { PersonalityLocalProfile, getLocalProfile, EventHint } from './localProfiles';
import { Signal, extractSignal } from './signalExtractor';

// ─── 时间线段 ──────────────────────────────────────────

export interface TimelineSegment {
  displayAt: number;
  text: string;
}

// ─── 组合结果 ──────────────────────────────────────────

export interface LocalReactionResult {
  reactionLayer: string;          // 单句摘要（给frontend预览）
  reactionTimeline: TimelineSegment[];   // [0s, 3s, 6s]
  companionTimeline: TimelineSegment[];  // [8s, 18s, 30s, 45s, 60s, 75s, 90s]
}

// ─── 时间锚点 ──────────────────────────────────────────

const REACTION_TIMES = [0, 3, 6] as const;
const COMPANION_TIMES = [8, 18, 30, 45, 60, 75, 90] as const;

// ─── 模板替换 ──────────────────────────────────────────

function fillTemplate(template: string, keyword: string): string {
  if (!keyword) return template;
  return template.replace(/\{\{keyword\}\}/g, keyword);
}

// ─── 核心组合函数 ──────────────────────────────────────

export function localGenerateTimeline(
  roleId: string,
  message: string,
  signal?: Signal,
): LocalReactionResult {
  const profile = getLocalProfile(roleId);
  if (!profile) {
    console.warn(`[LocalReaction] Unknown roleId: ${roleId}, using generic`);
    return generateGenericFallback();
  }

  // 提取信号（如未传入）
  const sig = signal || extractSignal(message);
  const { keyword, eventHint } = sig;

  // 尝试匹配事件模板
  const eventTpl = profile.eventTemplates[eventHint];
  if (eventTpl) {
    return buildTimeline(eventTpl, keyword, profile.name, eventHint);
  }

  // 无匹配 → 使用通用模板
  const genericTpl = {
    reactions: profile.genericReactions,
    companions: profile.genericCompanions,
  };
  return buildTimeline(genericTpl, keyword, profile.name, 'general');
}

// ─── 构建时间线 ──────────────────────────────────────

function buildTimeline(
  templates: { reactions: string[]; companions: string[] },
  keyword: string,
  profileName: string,
  eventHint: EventHint,
): LocalReactionResult {
  // Reaction：取前3段（0s, 3s, 6s）
  const reactions = templates.reactions.slice(0, 3);
  const reactionTimeline: TimelineSegment[] = reactions.map((text, i) => ({
    displayAt: REACTION_TIMES[i],
    text: fillTemplate(text, keyword),
  }));

  // Companion：取前7段（8s, 18s, 30s, 45s, 60s, 75s, 90s）
  const companions = templates.companions.slice(0, 7);
  const companionTimeline: TimelineSegment[] = companions.map((text, i) => ({
    displayAt: COMPANION_TIMES[i],
    text: fillTemplate(text, keyword),
  }));

  // Reaction layer 摘要 = 第一段Reaction
  const reactionLayer = reactionTimeline[0]?.text || profileName;

  return {
    reactionLayer,
    reactionTimeline,
    companionTimeline,
  };
}

// ─── 通用兜底 ──────────────────────────────────────────

function generateGenericFallback(): LocalReactionResult {
  return {
    reactionLayer: '嗯。我听到了。',
    reactionTimeline: [
      { displayAt: 0, text: '嗯。我听到了。' },
      { displayAt: 3, text: '我先把这件事放在心里。' },
      { displayAt: 6, text: '你继续说。' },
    ],
    companionTimeline: [
      { displayAt: 8, text: '不急。我在这儿。' },
      { displayAt: 18, text: '你说的话我都记着。' },
      { displayAt: 30, text: '我们慢慢来。' },
      { displayAt: 45, text: '你不用急着想清楚。' },
      { displayAt: 60, text: '我帮你看着。' },
      { displayAt: 75, text: '放心。我一直都在。' },
      { displayAt: 90, text: '你的事就是我的事。' },
    ],
  };
}

// ─── 简单问候检测 ─────────────────────────────────────

const NORMAL_CHAT_PATTERNS = [
  /^(你好|您好|嗨|hi|hello|hey|早上好|下午好|晚上好|晚安|早[啊呀]?)$/i,
  /你(是|叫|的名字)[什么谁]|你是谁|你叫什么/,
  /你(今天|最近|在).{0,5}(做|干|忙)什/,
];

export function isNormalChat(message: string): boolean {
  const trimmed = message.trim();
  return NORMAL_CHAT_PATTERNS.some(p => p.test(trimmed));
}

// ─── normal_chat 响应 ─────────────────────────────────

const ROLE_CHAT_RESPONSES: Record<string, string> = {
  'clever-fox': '我是聪明狐狸。喜欢琢磨那些绕来绕去的事，帮你把乱糟糟的东西理清楚。你愿意聊聊什么？',
  'warm-bear': '我是温暖小熊。我就待在这儿，不催你，不赶你。你想说的时候说就好。',
  'wise-owl': '我是深思猫头鹰。我习惯慢慢听，不急。你来找我，那我们就从你这句话开始。',
  'emotion-elf': '我是情感小精灵。我能感觉到你现在的状态。你不用急着说什么——先待着就行。',
  'empathy-fairy': '我是情感小精灵。我能感觉到你现在的状态。你愿意说，我就愿意听。',
  'philosophical-dolphin': '我是哲思海豚。我习惯往远的地方看。你今天怎么了？',
  'family-elephant': '我是团结小象。你不用一个人扛着，我在这儿。',
};

export function getNormalChatResponse(roleId: string): { frontFlow: string; reaction: string; companion: string } {
  const mappedId = roleId === 'empathy-fairy' ? 'emotion-elf' : roleId;
  const frontFlow = ROLE_CHAT_RESPONSES[mappedId] || `我是${mappedId}，很高兴认识你！`;
  return {
    frontFlow,
    reaction: '哎，有人来了。',
    companion: '',
  };
}

// ─── index.ts 兼容封装 ─────────────────────────────────

export function generateReactionTimeline(roleId: string, message: string, signal?: Signal): TimelineSegment[] {
  const result = localGenerateTimeline(roleId, message, signal);
  return result.reactionTimeline;
}

export function generateCompanionTimeline(roleId: string, message: string, signal?: Signal): TimelineSegment[] {
  const result = localGenerateTimeline(roleId, message, signal);
  return result.companionTimeline;
}