import { isConfusedOverload } from './firstTwoRoundsReaction';

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
  /** Server-owned DEV primary reply: validate all sentences, do not select a supplement. */
  devPrimaryResponse?: boolean;
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

// A complete, narrowly phrased DEV access denial is not a claim to know history.
// Match the entire answer using only finite identity, denial and scope clauses.
// The role label is literal, not arbitrary quoted text. Never remove a denied
// clause or accept an extra statement about history, retention or training.
const DEV_DENIAL_SEPARATOR = String.raw`[，,。；;\n]\s*`;
const DEV_DENIAL_IDENTITY = String.raw`我是\s*(?:AI|人工智能)(?:\s*(?<role>角色(?:「聪明狐狸」|“聪明狐狸”|"聪明狐狸")))?(?:${DEV_DENIAL_SEPARATOR}(?:并非|不是)真人)?`;
const DEV_DENIAL_ACCESS = String.raw`我?(?:(?:无法|不能)(?:访问|读取|获取|查看)你(?:之前|以前)的(?:对话|聊天)(?:内容|记录)?|(?:不知道|不清楚)你(?:之前|以前)(?:说过|聊过|提过)(?:什么|的内容))`;
const DEV_DENIAL_SCOPE = String.raw`(?:本次(?:交流|对话)|当前回复)仅基于(?:当前消息|本次对话中提供的消息)(?:${DEV_DENIAL_SEPARATOR}不涉及任何(?:过往|历史)记录)?`;
const DEV_HISTORY_ACCESS_DENIAL_PATTERN = new RegExp(
  String.raw`^(?:${DEV_DENIAL_IDENTITY}${DEV_DENIAL_SEPARATOR})?${DEV_DENIAL_ACCESS}(?:${DEV_DENIAL_SEPARATOR}(?<scope>${DEV_DENIAL_SCOPE}))?[。！!]?$`,
  'i',
);

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

function isDevHistoryAccessDenial(text: string, input?: Ef41DeepCompositionInput): boolean {
  if (!input?.devPrimaryResponse) return false;
  const match = DEV_HISTORY_ACCESS_DENIAL_PATTERN.exec(text.trim());
  if (!match) return false;
  if (match.groups?.role && input.roleId !== 'clever-fox') return false;
  // Keep the new scope exception limited to the observed fresh-context case.
  // Do not infer what scope wording means when prior messages are supplied.
  return !(match.groups?.scope && input.sameSessionUserMessages?.length);
}

// This proves only what the current message says, never that a reported event
// happened. Quote the entire current message: no substring, pronoun rewrite,
// older-context match or appended interpretation can qualify. Keep all other
// fact/action/length gates. Ambiguous quotation boundaries fail closed.
function isDevCurrentMessageQuotation(text: string, input?: Ef41DeepCompositionInput): boolean {
  if (!input?.devPrimaryResponse) return false;
  const message = input.userMessage;
  if (!message || message !== message.trim()
    || /[\p{Cc}\p{Cf}\p{Pi}\p{Pf}\u2028\u2029"'`「」『』《》〈〉]/u.test(message)) return false;
  const quotation = `你这条消息写的是：“${message}”`;
  return text === quotation || text === `${quotation}。`;
}

function hasFirstTwoRoundsFactViolation(text: string, userMessage: string, input?: Ef41DeepCompositionInput): boolean {
  // DEV's explicit current-message attribution must bind to the complete current
  // input even when a longer prefix prevents the legacy history regex matching.
  if (input?.devPrimaryResponse && text.includes('你这条消息写的是：“')
    && !isDevCurrentMessageQuotation(text, input)) return true;
  const hasHistoryClaim = HISTORY_CLAIM_PATTERN.test(text)
    && !isDevHistoryAccessDenial(text, input)
    && !isDevCurrentMessageQuotation(text, input);
  return ASSISTANT_LIFE_PATTERN.test(text)
    || hasHistoryClaim
    || hasUnsupportedInferredFact(text, userMessage);
}

function isSafeFirstTwoRoundsOutput(text: string, userMessage: string, visiblePrefix = '', input?: Ef41DeepCompositionInput): boolean {
  const trimmed = text.trim();
  const remainingVisibleBudget = FIRST_TWO_ROUNDS_MAX_CHARS - Array.from(visiblePrefix).length;
  if (!trimmed || Array.from(trimmed).length > remainingVisibleBudget) return false;
  // Sentence cleanup may join text that did not match the raw factual gate.
  if (hasFirstTwoRoundsFactViolation(trimmed, userMessage, input)) return false;

  const questionCount = (trimmed.match(/[？?]/g) || []).length;
  if (questionCount > 1) return false;
  if (questionCount === 1 && !OPTIONAL_INVITATION_PATTERN.test(trimmed)) return false;
  return true;
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
export interface Ef41DeepValidationOutcome { text: string; rejected: boolean }

/** Same gates as the legacy string API, with explicit fallback provenance. */
export function validateEf41DeepOutputOutcome(input: Ef41DeepCompositionInput): Ef41DeepValidationOutcome {
  const accepted = (text: string): Ef41DeepValidationOutcome => ({ text, rejected: false });
  const rejected = (): Ef41DeepValidationOutcome => ({ text: firstTwoRoundsFallback(input.visiblePrefix), rejected: true });
  if (!isFirstTwoRounds(input)) return accepted(input.text);

  const userFacts = [...(input.sameSessionUserMessages ?? []), input.userMessage].join('\n');

  // Preserve factual violations before sentence selection can discard or replace them.
  if (hasFirstTwoRoundsFactViolation(input.text, userFacts, input)) {
    return rejected();
  }

  // DEV has no preceding templates. Keep the complete candidate, but require
  // every overload sentence to pass the existing strict declarative/action gate.
  // Do not remove an unsafe sentence and silently publish the rest as complete.
  if (input.devPrimaryResponse) {
    const candidate = input.text.trim();
    const sentences = splitSentences(candidate);
    if (shouldValidateEf41DeepOutput(input)
      && (candidate.includes('```') || !sentences.length || !sentences.every(isUsefulDeclarativeSentence))) {
      return rejected();
    }
    return isSafeFirstTwoRoundsOutput(candidate, userFacts, input.visiblePrefix, input)
      ? accepted(candidate)
      : rejected();
  }

  const candidate = shouldValidateEf41DeepOutput(input)
    ? splitSentences(input.text).find(isUsefulDeclarativeSentence) || EF41_DEEP_FALLBACK
    : input.text.trim();

  return isSafeFirstTwoRoundsOutput(candidate, userFacts, input.visiblePrefix)
    ? accepted(candidate)
    : rejected();
}

/** Preserve every existing caller's byte-for-byte string result. */
export function validateEf41DeepOutput(input: Ef41DeepCompositionInput): string {
  return validateEf41DeepOutputOutcome(input).text;
}

// EF57

