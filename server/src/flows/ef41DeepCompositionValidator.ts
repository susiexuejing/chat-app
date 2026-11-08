import { isConfusedOverload } from './firstTwoRoundsReaction';

export type Ef41DeepValidationCategory =
  | 'passthrough_later_turn'
  | 'accepted_plain'
  | 'accepted_ef41_sentence'
  | 'accepted_ef41_default'
  | 'raw_fact_fallback'
  | 'empty_candidate_fallback'
  | 'budget_fallback'
  | 'post_selection_fact_fallback'
  | 'question_fallback';

export type Ef41DeepOutputSource = 'cleaned' | 'last-resort' | 'reasoning';

export interface Ef41DeepCompositionInput {
  text: string;
  roleId: string;
  userTurn: number;
  userMessage: string;
  source: Ef41DeepOutputSource;
  /** Reaction + Companion already visible before Deep is appended. */
  visiblePrefix?: string;
  /** DEV only: bounded user-authored raw messages, never assistant assertions. */
  sameSessionUserMessages?: readonly string[];
}

export const EF41_DEEP_FALLBACK = '等这一团稍微松开，事情的轻重也许会慢慢显出来。';
export const FIRST_TWO_ROUNDS_DEEP_FALLBACK = '我听到了。';
export const FIRST_TWO_ROUNDS_MAX_CHARS = 120;

const QUESTION_PATTERN = /[？?]/;

const REPEATED_INVITATION_PATTERN = /(?:倒一倒|丢出来|说出来|随手丢|挑一件|选一件|拿一件|先说|先讲|慢慢说|随便说|想到哪|从哪(?:里)?开始|找个开头|开口(?:说|讲))/;

const REPEATED_HOLDING_PATTERN = /(?:我.{0,8}(?:在听|听着|陪着|接着|收着|记着)|我都在|我会跟着|陪着你|在你旁边|旁边陪着)/;

const UNSOLICITED_ACTION_PATTERN = /(?:你(?:可以|应该|需要|最好)|不妨|建议|试试|要不|不如|去.{0,10}(?:站|走|坐|躺|喝|洗|吹|看)|把.{0,16}(?:推开|放下|收拾|关掉|拿走|倒掉)|先.{0,10}(?:深呼吸|休息|喝水|睡|散步))/;

const USER_DIRECTED_ACTION_PATTERN = /(?:^|[，,；;。]\s*)你(?:只管|先(?!前|后)|去|来(?!自|到))/;

const JOINT_PROGRESSION_PATTERN = /(?:^|[，,；;。]\s*)(?:我们|咱们)(?:再|一起)/;

const ASSISTANT_LIFE_PATTERN = /(?:我(?:正|正在|在|刚|会).{0,12}(?:喝咖啡|咖啡|窗边|笔记本|散步|看书|旅行|坐在)|我(?:手边|身边).{0,12}(?:咖啡|笔记本)|我的.{0,8}(?:咖啡|窗边|笔记本)|(?:窗边|咖啡|笔记本).{0,12}(?:我|狐狸))/;

const HISTORY_CLAIM_PATTERN = /(?:你|用户).{0,12}(?:之前|以前|总是|每次|又|一直|还记得)|(?:之前|以前|总是|每次|又|一直|还记得).{0,12}(?:说|提到|觉得|感到|经历)/;

const OPTIONAL_INVITATION_PATTERN = /(?:如果你愿意|要是你愿意|想的话|若你愿意|愿意的话|可以不回答)/;

const INFERRED_FACT_TERMS = [
  '心里沉', '沉重', '胸口', '胃里', '疲惫', '委屈', '难过', '伤心',
  '孤独', '焦虑', '害怕', '不安', '压抑', '耗竭', '撑不住',
] as const;

function splitSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .match(/[^。！？!?；;\n]+[。！？!?；;]?/g)
    ?.map(sentence => sentence.replace(/^[\s>*#\-–—]+/, '').trim())
    .filter(Boolean) ?? [];
}

function isUsefulDeclarativeSentence(sentence: string): boolean {
  const plainText = sentence.replace(/[\s，。！？!?；;、]/g, '');
  if (plainText.length < 8) return false;
  if (QUESTION_PATTERN.test(sentence)) return false;
  if (REPEATED_INVITATION_PATTERN.test(sentence)) return false;
  if (REPEATED_HOLDING_PATTERN.test(sentence)) return false;
  if (UNSOLICITED_ACTION_PATTERN.test(sentence)) return false;
  if (USER_DIRECTED_ACTION_PATTERN.test(sentence)) return false;
  if (JOINT_PROGRESSION_PATTERN.test(sentence)) return false;
  return true;
}

export function shouldValidateEf41DeepOutput(input: Ef41DeepCompositionInput): boolean {
  return input.roleId === 'clever-fox'
    && input.userTurn >= 1
    && input.userTurn <= 2
    && isConfusedOverload(input.userMessage, true);
}

function isFirstTwoRounds(input: Ef41DeepCompositionInput): boolean {
  return input.userTurn >= 1 && input.userTurn <= 2;
}

function hasUnsupportedInferredFact(text: string, userMessage: string): boolean {
  return INFERRED_FACT_TERMS.some(term => text.includes(term) && !userMessage.includes(term));
}

function hasFirstTwoRoundsFactViolation(text: string, userMessage: string): boolean {
  return ASSISTANT_LIFE_PATTERN.test(text)
    || HISTORY_CLAIM_PATTERN.test(text)
    || hasUnsupportedInferredFact(text, userMessage);
}

function firstTwoRoundsOutputFailure(
  text: string, userMessage: string, visiblePrefix = '',
): Ef41DeepValidationCategory | undefined {
  const trimmed = text.trim();
  const remainingVisibleBudget = FIRST_TWO_ROUNDS_MAX_CHARS - Array.from(visiblePrefix).length;
  if (!trimmed) return 'empty_candidate_fallback';
  if (Array.from(trimmed).length > remainingVisibleBudget) return 'budget_fallback';
  // Sentence cleanup may join text that did not match the raw factual gate.
  if (hasFirstTwoRoundsFactViolation(trimmed, userMessage)) return 'post_selection_fact_fallback';

  const questionCount = (trimmed.match(/[？?]/g) || []).length;
  if (questionCount > 1) return 'question_fallback';
  if (questionCount === 1 && !OPTIONAL_INVITATION_PATTERN.test(trimmed)) return 'question_fallback';
  return undefined;
}

function firstTwoRoundsFallback(visiblePrefix = ''): string {
  return Array.from(`${visiblePrefix}${FIRST_TWO_ROUNDS_DEEP_FALLBACK}`).length <= FIRST_TWO_ROUNDS_MAX_CHARS
    ? FIRST_TWO_ROUNDS_DEEP_FALLBACK
    : '';
}

/**
 * First-two-rounds post-cleaning composition validator.
 *
 * Every first/second-turn Deep output gets a small factual and length gate.
 * The EF-41 confused-overload variant keeps its stricter one-sentence rule.
 * Later turns are returned byte-for-byte.
 */
export function validateEf41DeepOutput(
  input: Ef41DeepCompositionInput,
  observe?: (category: Ef41DeepValidationCategory) => void,
): string {
  const finish = (category: Ef41DeepValidationCategory, output: string): string => {
    try { observe?.(category); } catch { /* Diagnostics must not change chat output. */ }
    return output;
  };
  if (!isFirstTwoRounds(input)) return finish('passthrough_later_turn', input.text);

  const userFacts = [...(input.sameSessionUserMessages ?? []), input.userMessage].join('\n');

  // Preserve factual violations before sentence selection can discard or replace them.
  if (hasFirstTwoRoundsFactViolation(input.text, userFacts)) {
    return finish('raw_fact_fallback', firstTwoRoundsFallback(input.visiblePrefix));
  }

  let accepted: Ef41DeepValidationCategory = 'accepted_plain';
  let candidate: string;
  if (shouldValidateEf41DeepOutput(input)) {
    const sentence = splitSentences(input.text).find(isUsefulDeclarativeSentence);
    candidate = sentence || EF41_DEEP_FALLBACK;
    accepted = sentence ? 'accepted_ef41_sentence' : 'accepted_ef41_default';
  } else {
    candidate = input.text.trim();
  }

  const failure = firstTwoRoundsOutputFailure(candidate, userFacts, input.visiblePrefix);
  return failure
    ? finish(failure, firstTwoRoundsFallback(input.visiblePrefix))
    : finish(accepted, candidate);
}

// EF57

