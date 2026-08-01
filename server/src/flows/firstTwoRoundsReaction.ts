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
export function getFirstTwoRoundsReactionTimeline(signal?: Signal, userMessage?: string): TimelineSegment[] {
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
export function getFirstTwoRoundsCompanionTimeline(signal?: Signal, userMessage?: string): TimelineSegment[] {
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
      anxiety: `${shortPhrase}——等着急的事，一件一件来。`,
      anger: `${shortPhrase}——你有权利觉得不舒服。`,
      burnout: `${shortPhrase}——累了的时候，不用逼自己想清楚。`,
      meaningless: `${shortPhrase}——你觉得没意义的时候，不用假装有力气。`,
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
      anxious: '等着急的事，一件一件来。',
      angry: '你有权利觉得不舒服。',
      tired: '累了的时候，不用逼自己想清楚。',
      lost: '不知道怎么说的時候，不用假装说得清。',
    };
    text = feelingContext[feelingHint] || '你想说什么都可以。';
  } else {
    text = '你想说什么都可以，慢慢来。';
  }

  return [{ displayAt: 8, text }];
}
