/**
 * EM-43: First Two Rounds Reaction and Companion
 *
 * The first two rounds must be restrained but NOT mechanical.
 * They must acknowledge the user's specific content and emotion,
 * while avoiding analysis, diagnosis, or unsolicited advice.
 *
 * Strategy:
 * - Use the user's actual message, eventHint, feelingHint, and keyword
 *   to generate a response that references what the user actually said
 * - Use deterministic selection (no Math.random)
 * - Never show analysis process or label the user
 * - Never give advice, guarantees, or define feelings the user hasn't expressed
 */

import type { TimelineSegment } from './localReactionEngine';
import type { Signal } from './signalExtractor';

const OVERLOAD_PATTERNS = [
  /(?:很多|好多|太多|一堆|一大堆|各种)(?:事|事情|东西|问题)/,
  /(?:事|事情|东西|问题).{0,6}(?:很多|太多|堆在一起|挤在一起|一下子全来了)/,
  /(?:一件接一件|接二连三|一股脑).{0,8}(?:发生|涌来|堆来|挤来|来了)/,
  /(?:一下子|同时).{0,8}(?:挤|涌|堆).{0,4}(?:一起|过来)/,
];

const SMART_FOX_OVERLOAD_PATTERNS = [
  /(?:事|事情).{0,4}一件接一件/,
  /(?:信息|消息|内容).{0,5}(?:太多|很多|过量)/,
  /(?:脑子|脑袋).{0,8}(?:塞满|装满)/,
  /(?:事|事情|东西|问题).{0,6}(?:全|都)?(?:挤|塞).{0,6}(?:脑子|脑袋|头脑)(?:里|中)?/,
];

const CONFUSION_PATTERNS = [
  /(?:脑子|脑袋|思绪|头绪).{0,8}(?:很乱|乱成一团|一团乱|理不清|捋不清|转不过来)/,
  /(?:不知|不知道|没想好|想不清).{0,8}(?:从哪|哪里|怎么).{0,8}(?:说|开始|讲|开口|理)/,
  /(?:说不清|理不清|捋不清|无从下手|找不到头绪)/,
];

const SMART_FOX_CONFUSION_PATTERNS = [
  /(?:思绪|想法).{0,8}(?:全挤|挤成一团|乱成一团|理不清|捋不清)/,
  /(?:不知|不知道).{0,8}(?:先|该先).{0,8}(?:讲|说|处理).{0,5}(?:哪|什么)/,
  /(?:想说.{0,4})?找不到.{0,4}(?:开头|入口|起点)/,
];

/**
 * EF-41: Match only when the raw message contains both accumulated overload
 * and difficulty sorting or starting. Neither category is sufficient alone.
 */
export function isConfusedOverload(message?: string, includeSmartFoxExpansion = false): boolean {
  if (!message) return false;
  const overloadPatterns = includeSmartFoxExpansion
    ? [...OVERLOAD_PATTERNS, ...SMART_FOX_OVERLOAD_PATTERNS]
    : OVERLOAD_PATTERNS;
  const confusionPatterns = includeSmartFoxExpansion
    ? [...CONFUSION_PATTERNS, ...SMART_FOX_CONFUSION_PATTERNS]
    : CONFUSION_PATTERNS;

  return overloadPatterns.some((pattern) => pattern.test(message))
    && confusionPatterns.some((pattern) => pattern.test(message));
}

interface ConfusedOverloadCopy {
  reaction: string;
  companion: string;
}

/**
 * EF-41: Keep the Smart Fox response deterministic while grounding it in the
 * overload and confusion language the user actually supplied.
 */
function getSmartFoxConfusedOverloadCopy(message: string): ConfusedOverloadCopy {
  if (/(?:信息|消息|内容).{0,5}(?:太多|很多|过量)|(?:脑子|脑袋).{0,8}(?:塞满|装满)/.test(message)) {
    return {
      reaction: '一下子装进来的信息太多，脑子像被塞满了，连开头也找不到。',
      companion: '不用一次理清；此刻最卡住你的，是哪一小块？',
    };
  }

  if (/(?:一件接一件|接二连三)|(?:思绪|想法).{0,8}(?:全挤|挤成一团)/.test(message)) {
    return {
      reaction: '事情一件接一件，思绪也全挤成一团，先讲哪件都难选。',
      companion: '不用一次理清；此刻最卡住你的，是哪一小块？',
    };
  }

  if (/(?:事|事情|东西|问题).{0,6}(?:全|都)?(?:挤|塞).{0,6}(?:脑子|脑袋|头脑)/.test(message)) {
    return {
      reaction: '事情全挤在脑子里，连先说什么都拿不准。',
      companion: '不用一次理清；此刻最卡住你的，是哪一小块？',
    };
  }

  return {
    reaction: '今天的事情一下子堆得太多，脑子乱着，也不知道该从哪里说起。',
    companion: '不用一次理清；此刻最卡住你的，是哪一小块？',
  };
}

/**
 * Extract a short phrase from the user's message that can be referenced.
 * Returns the most meaningful clause (up to ~20 chars).
 */
function extractUserPhrase(message: string): string {
  // Remove common filler words and get the core clause
  const cleaned = message
    .replace(/[，。！？、；：""''（）\s]+/g, ' ')
    .trim();

  // Split by common conjunctions and take the most meaningful part
  const clauses = cleaned.split(/[，。！？；\s]+/).filter((c) => c.length >= 2);

  if (clauses.length === 0) return cleaned.slice(0, 20);

  // Prefer clauses with emotional or concrete content
  const emotionalKeywords = ['不', '没', '好', '难', '怕', '累', '烦', '痛', '哭', '怒', '恨', '想', '要', '怕', '急'];
  for (const clause of clauses) {
    if (emotionalKeywords.some((k) => clause.includes(k))) {
      return clause.slice(0, 20);
    }
  }

  // Fallback: return the longest clause
  return clauses.sort((a, b) => b.length - a.length)[0].slice(0, 20);
}

/**
 * Generate a Reaction segment that references the user's specific content.
 * Deterministic: same input always produces same output.
 */
export function getFirstTwoRoundsReactionTimeline(
  signal?: Signal,
  userMessage?: string,
  enableSmartFoxConfusedOverload = false,
): TimelineSegment[] {
  if (enableSmartFoxConfusedOverload && isConfusedOverload(userMessage, true)) {
    return [{
      displayAt: 0,
      text: getSmartFoxConfusedOverloadCopy(userMessage || '').reaction,
    }];
  }

  const phrase = userMessage ? extractUserPhrase(userMessage) : '';
  const keyword = signal?.keyword || '';
  const eventHint = signal?.eventHint || '';

  let text: string;

  if (phrase && keyword) {
    // Reference both the user's phrase and the extracted keyword
    text = `「${keyword}」这件事，你提到了。`;
  } else if (phrase) {
    // Reference the user's specific words
    if (phrase.length > 8) {
      text = `你说的「${phrase.slice(0, 12)}」，我听到了。`;
    } else {
      text = `${phrase}——你说的我记住了。`;
    }
  } else if (keyword) {
    text = `关于「${keyword}」，我在听。`;
  } else if (eventHint) {
    // Map eventHint to a brief acknowledgment without being mechanical
    const eventAck: Record<string, string> = {
      criticism: '被说的那些，你记住了。',
      relationship_conflict: '你们之间的事，你在意。',
      sadness: '你提到的那些，我听到了。',
      anxiety: '让你着急的事，我在听。',
      anger: '让你不舒服的事，我听到了。',
      burnout: '累了很久了，你说的我记住了。',
      meaningless: '你觉得没意义的那些，我在听。',
      silence: '你在的。',
    };
    text = eventAck[eventHint] || '你说的，我在听。';
  } else {
    text = '你在的，慢慢说。';
  }

  return [{ displayAt: 0, text }];
}

/**
 * Generate a Companion segment that references the user's specific content.
 * Deterministic: same input always produces same output.
 */
export function getFirstTwoRoundsCompanionTimeline(
  signal?: Signal,
  userMessage?: string,
  enableSmartFoxConfusedOverload = false,
): TimelineSegment[] {
  if (enableSmartFoxConfusedOverload && isConfusedOverload(userMessage, true)) {
    return [{
      displayAt: 8,
      text: getSmartFoxConfusedOverloadCopy(userMessage || '').companion,
    }];
  }

  const phrase = userMessage ? extractUserPhrase(userMessage) : '';
  const keyword = signal?.keyword || '';
  const eventHint = signal?.eventHint || '';
  const feelingHint = signal?.feelingHint || '';

  let text: string;

  if (phrase && eventHint) {
    // Combine user's words with event context
    const shortPhrase = phrase.slice(0, 15);
    const eventContext: Record<string, string> = {
      criticism: `${shortPhrase}——被说的时候，不只是事情本身，那个场面可能也很刺人。`,
      relationship_conflict: `${shortPhrase}——关于在乎的人的事，确实不好处理。`,
      sadness: `${shortPhrase}——你说的这些，不用急着理清。`,
      anxiety: `${shortPhrase}——让你着急的那些，你在意。`,
      anger: `${shortPhrase}——让你不舒服的事，你记住了。`,
      burnout: `${shortPhrase}——累了的时候，不用逼自己。`,
      meaningless: `${shortPhrase}——你觉得没意义的那些，不用假装有力气。`,
      silence: `${shortPhrase}——不想说也没关系。`,
    };
    text = eventContext[eventHint] || `${shortPhrase}——你说的，我都在听。`;
  } else if (phrase && keyword) {
    text = `「${keyword}」这件事，你想怎么说就怎么说。`;
  } else if (phrase) {
    const shortPhrase = phrase.slice(0, 15);
    text = `${shortPhrase}——不用急着想清楚，慢慢来。`;
  } else if (keyword) {
    text = `关于「${keyword}」，你想怎么说都行。`;
  } else if (feelingHint) {
    const feelingContext: Record<string, string> = {
      sad: '你说的这些，不用急着理清。',
      anxious: '让你着急的那些，你在意。',
      angry: '让你不舒服的事，你记住了。',
      tired: '累了的时候，不用逼自己。',
      lost: '不知道怎么说的時候，不用假装说得清。',
    };
    text = feelingContext[feelingHint] || '你想说什么都可以。';
  } else {
    text = '你想说什么都可以，慢慢来。';
  }

  return [{ displayAt: 8, text }];
}
