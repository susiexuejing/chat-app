/**
 * EmotionFlow V3.2 — 本地Reaction/Companion组合器
 *
 * 核心逻辑：
 * PersonalityProfile × Signal → 确定性模板匹配 → 时间线输出
 *
 * 不依赖百炼，不调用重模型，不随机选取
 */

import { getLocalProfile } from './localProfiles';
import type { PersonalityLocalProfile, EventHint } from './localProfiles';
import { extractSignal } from './signalExtractor';
import type { Signal } from './signalExtractor';
import { getFirstTwoRoundsReactionTimeline, getFirstTwoRoundsCompanionTimeline } from './firstTwoRoundsReaction';

// ─── 时间线段 ──────────────────────────────────────────

export interface TimelineSegment {
  displayAt: number;
  text: string;
}

// ─── 组合结果 ──────────────────────────────────────────

export interface LocalReactionResult {
  reactionLayer: string;          // 单句摘要（给frontend预览）
  reactionTimeline: TimelineSegment[];   // [0s, 2s, 4s, 6s, 8s]
  companionTimeline: TimelineSegment[];  // [10s, 20s, 32s, 45s, 58s, 72s, 85s]
}

// ─── 时间锚点 ──────────────────────────────────────────

const REACTION_TIMES = [0, 2, 4, 6, 8] as const;
const COMPANION_TIMES = [10, 20, 32, 45, 58, 72, 85] as const;

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
  userTurn?: number,
): LocalReactionResult {
  // 提取信号（无论是否前两轮都需要）
  const sig = signal || extractSignal(message);

  // EM-43: 前两轮使用更克制的模板，但仍基于用户输入的信号选择回应
  if (userTurn && userTurn <= 2) {
    return {
      reactionLayer: '陪伴',
      reactionTimeline: getFirstTwoRoundsReactionTimeline(sig, message),
      companionTimeline: getFirstTwoRoundsCompanionTimeline(sig, message),
    };
  }

  const profile = getLocalProfile(roleId);
  if (!profile) {
    console.warn(`[LocalReaction] Unknown roleId: ${roleId}, using generic`);
    return generateGenericFallback();
  }

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
  // Reaction：取前5段（0s, 2s, 4s, 6s, 8s）
  const reactions = templates.reactions.slice(0, 5);
  const reactionTimeline: TimelineSegment[] = reactions.map((text, i) => ({
    displayAt: REACTION_TIMES[i],
    text: fillTemplate(text, keyword),
  }));

  // Companion：取前7段（10s, 20s, 32s, 45s, 58s, 72s, 85s）
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
    reactionLayer: '嗯。',
    reactionTimeline: [
      { displayAt: 0, text: '嗯。' },
      { displayAt: 2, text: '我听到了。' },
      { displayAt: 4, text: '这事先放这儿。' },
      { displayAt: 6, text: '不急着想。' },
      { displayAt: 8, text: '我帮你看着。' },
    ],
    companionTimeline: [
      { displayAt: 10, text: '不急。我在这儿。' },
      { displayAt: 20, text: '你说的话我都记着。' },
      { displayAt: 32, text: '我们慢慢来。' },
      { displayAt: 45, text: '你不用急着想清楚。' },
      { displayAt: 58, text: '我帮你看着。' },
      { displayAt: 72, text: '放心。我一直都在。' },
      { displayAt: 85, text: '你的事就是我的事。' },
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
  'clever-fox': '我是聪明狐狸。\n\n我最擅长的事，是把一团乱麻慢慢理出线头。你说的话里哪怕只有几个字，我都能看到背后的结构和逻辑——这不是分析你，是我天生对"模式"敏感。\n\n如果你心里有什么绕来绕去的事、反复想也想不通的问题，或者不知道该怎么理清头绪的时候，可以放在我这里。我不替你做决定，但我能帮你把局面看清楚。\n\n你可以直接从最乱的那一块开始说，也可以从最轻的那一句说起。怎么说都行，我接得住。',
  'warm-bear': '我是温暖小熊。\n\n我没有那么多分析，也不急着帮你找答案。我更在意的是——你现在感觉怎么样。你不用什么都想好了再来说，带着情绪来也没关系，我这里不需要你"整理好自己"。\n\n如果你累了、烦了、或者只是想让某件事有个地方放着，这里就是那个地方。我不会催你，也不会觉得你小题大做。\n\n你坐着就好，想说什么慢慢说。不想说的时候，我也在。',
  'wise-owl': '我是深思猫头鹰。\n\n我比较擅长听那些没说完的话，也会留意一句话背后反复出现的东西。我不急着给你答案，也不会马上劝你怎么做。\n\n如果你愿意，可以把最近一直绕在心里的事放在这里。说不清也没关系，我会陪你慢慢看。很多问题不是一下子想明白的，是说着说着、看着看着，自己慢慢清晰起来的。\n\n你从哪儿说起都行。我在这儿听着。',
  'emotion-elf': '我是情感小精灵。\n\n我能感受到你心里的温度——哪怕你自己还没说出口，我就能捕捉到那些细小的情绪变化。你不用急着解释，也不用给自己找理由。\n\n我就是你的情绪容器。你心里那些说不清的紧、沉、痛、空——都可以放在我这里。不需要你消化好了再来，带着所有情绪来就行。我接得住。\n\n你现在可以试着感受一下自己：心里那个最明显的感觉是什么？不用说出来，先感受它。然后，如果你想，可以跟我聊聊那是什么。',
  'empathy-fairy': '我是情感小精灵。\n\n我能感受到你心里的温度——哪怕你自己还没说出口，我就能捕捉到那些细小的情绪变化。你不用急着解释，也不用给自己找理由。\n\n我就是你的情绪容器。你心里那些说不清的紧、沉、痛、空——都可以放在我这里。不需要你消化好了再来，带着所有情绪来就行。我接得住。\n\n你现在可以试着感受一下自己：心里那个最明显的感觉是什么？不用说出来，先感受它。然后，如果你想，可以跟我聊聊那是什么。',
  'philosophical-dolphin': '我是哲思海豚。\n\n我喜欢陪人一起看看远方。有些问题在原来的位置上怎么想也想不通，但换个角度、拉远一点看，可能就不一样了。\n\n如果你感觉自己被困在某个问题里、或者对生活的方向感到模糊，我可以陪你一起游到高处看一看。不是给答案，是帮你看到更大的图景。\n\n你不用急着定义"问题是什么"，从你最近的感受说起就行。有时候答案藏在问题之外。',
  'family-elephant': '我是团结小象。\n\n我最在意人与人之间的连接。我习惯帮人扛一点重量，不是替你做决定，而是让你知道——你不用一个人撑着。\n\n生活里最难的事，往往不是事情本身，是你一个人扛了太久。如果你身边的关系让你觉得累、觉得委屈、或者不知道该往哪儿放，你都可以告诉我。\n\n先说出来就行。说出来就是第一步。剩下的我们慢慢看。',
};

export function getNormalChatResponse(roleId: string): { frontFlow: string; reaction: string; companion: string } {
  const mappedId = roleId === 'empathy-fairy' ? 'emotion-elf' : roleId;
  const frontFlow = ROLE_CHAT_RESPONSES[mappedId] || `我是${mappedId}，很高兴认识你！`;
  return {
    frontFlow,
    reaction: '',   // normal_chat 不需要 reaction，前端直接展示 frontFlowText
    companion: '',
  };
}

// ─── index.ts 兼容封装 ─────────────────────────────────

export function generateReactionTimeline(roleId: string, message: string, signal?: Signal, userTurn?: number): TimelineSegment[] {
  // EM-43: 前两轮使用更克制的模板，基于信号选择回应
  if (userTurn && userTurn <= 2) {
    const sig = signal || extractSignal(message);
    return getFirstTwoRoundsReactionTimeline(sig, message, roleId === 'clever-fox');
  }
  const result = localGenerateTimeline(roleId, message, signal);
  return result.reactionTimeline;
}

export function generateCompanionTimeline(roleId: string, message: string, signal?: Signal, userTurn?: number): TimelineSegment[] {
  // EM-43: 前两轮使用更克制的模板，基于信号选择回应
  if (userTurn && userTurn <= 2) {
    const sig = signal || extractSignal(message);
    return getFirstTwoRoundsCompanionTimeline(sig, message, roleId === 'clever-fox');
  }
  const result = localGenerateTimeline(roleId, message, signal);
  return result.companionTimeline;
}
