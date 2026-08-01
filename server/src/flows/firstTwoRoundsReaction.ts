/**
 * EM-43: First Two Rounds Reaction and Companion
 *
 * The first two rounds should be restrained but NOT mechanical.
 * They must acknowledge the user's specific content and emotion,
 * while avoiding analysis, diagnosis, or unsolicited advice.
 *
 * Strategy:
 * - Use the extracted signal (eventHint, feelingHint, keyword) to select contextual templates
 * - Keep responses short, natural, and human-like
 * - Never show analysis process or label the user
 */

import type { TimelineSegment } from './localReactionEngine';
import type { Signal } from './signalExtractor';

// ─── Reaction templates by emotional category ──────────
// Each category has multiple options for natural variety.

const REACTION_BY_CATEGORY: Record<string, string[]> = {
  // Heavy emotions: sadness, burnout, meaningless
  heavy: [
    '嗯，我在听。',
    '这听起来不容易。',
    '你说的我记住了。',
    '慢慢说，不着急。',
  ],
  // Anxiety / fear
  anxious: [
    '嗯，我在。',
    '等着急的事确实不好受。',
    '我在听，你慢慢说。',
  ],
  // Anger / frustration
  angry: [
    '嗯，我听到了。',
    '这事搁谁都会不舒服。',
    '我在听。',
  ],
  // Relationship / interpersonal
  relational: [
    '嗯，关于ta的事确实让人在意。',
    '我在听，你继续说。',
    '这种感觉很真实。',
  ],
  // Default / general
  default: [
    '嗯，我在听。',
    '我在。你说。',
    '嗯，继续说。',
  ],
};

const COMPANION_BY_CATEGORY: Record<string, string[]> = {
  heavy: [
    '你不用一个人扛着。',
    '想怎么说就怎么说，我在这里。',
    '不用急着想清楚，慢慢来。',
  ],
  anxious: [
    '先深呼吸一下，我在这儿。',
    '一件一件来，不急。',
    '我在这里陪你。',
  ],
  angry: [
    '你有权利觉得不舒服。',
    '想怎么说就怎么说，这里安全。',
    '我陪你待一会儿。',
  ],
  relational: [
    '关于在乎的人的事，确实不好处理。',
    '我在这儿，你想怎么说都行。',
    '慢慢来，不着急做决定。',
  ],
  default: [
    '我在这里陪你。',
    '你想说什么都可以。',
    '慢慢说，不着急。',
  ],
};

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function categorizeSignal(signal?: Signal): string {
  if (!signal) return 'default';

  const { eventHint } = signal;

  switch (eventHint) {
    case 'sadness':
    case 'burnout':
    case 'meaningless':
      return 'heavy';
    case 'anxiety':
      return 'anxious';
    case 'anger':
      return 'angry';
    case 'silence':
    case 'relationship_conflict':
    case 'criticism':
      return 'relational';
    default:
      return 'default';
  }
}

/**
 * Generate first-two-rounds Reaction timeline.
 * Restrained but responsive to user's emotional signal.
 */
export function getFirstTwoRoundsReactionTimeline(signal?: Signal): TimelineSegment[] {
  const category = categorizeSignal(signal);
  const templates = REACTION_BY_CATEGORY[category] || REACTION_BY_CATEGORY.default;

  return [
    { displayAt: 0, text: pickRandom(templates) },
  ];
}

/**
 * Generate first-two-rounds Companion timeline.
 * Restrained but responsive to user's emotional signal.
 */
export function getFirstTwoRoundsCompanionTimeline(signal?: Signal): TimelineSegment[] {
  const category = categorizeSignal(signal);
  const templates = COMPANION_BY_CATEGORY[category] || COMPANION_BY_CATEGORY.default;

  return [
    { displayAt: 8, text: pickRandom(templates) },
  ];
}
