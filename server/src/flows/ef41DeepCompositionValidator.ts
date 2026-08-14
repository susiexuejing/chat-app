import { isConfusedOverload } from './firstTwoRoundsReaction';

export type Ef41DeepOutputSource = 'cleaned' | 'last-resort' | 'reasoning';

export interface Ef41DeepCompositionInput {
  text: string;
  roleId: string;
  userTurn: number;
  userMessage: string;
  source: Ef41DeepOutputSource;
}

export const EF41_DEEP_FALLBACK = '等这一团稍微松开，事情的轻重也许会慢慢显出来。';

const QUESTION_PATTERN = /[？?]/;

const REPEATED_INVITATION_PATTERN = /(?:倒一倒|丢出来|说出来|随手丢|挑一件|选一件|拿一件|先说|先讲|慢慢说|随便说|想到哪|从哪(?:里)?开始|找个开头|开口(?:说|讲))/;

const REPEATED_HOLDING_PATTERN = /(?:我.{0,8}(?:在听|听着|陪着|接着|收着|记着)|我都在|我会跟着|陪着你|在你旁边|旁边陪着)/;

const UNSOLICITED_ACTION_PATTERN = /(?:你(?:可以|应该|需要|最好)|不妨|建议|试试|要不|不如|去.{0,10}(?:站|走|坐|躺|喝|洗|吹|看)|把.{0,16}(?:推开|放下|收拾|关掉|拿走|倒掉)|先.{0,10}(?:深呼吸|休息|喝水|睡|散步))/;

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
  return true;
}

export function shouldValidateEf41DeepOutput(input: Ef41DeepCompositionInput): boolean {
  return input.roleId === 'clever-fox'
    && input.userTurn >= 1
    && input.userTurn <= 2
    && isConfusedOverload(input.userMessage, true);
}

/**
 * EF-41-only post-cleaning composition validator.
 *
 * Non-target output is returned byte-for-byte. In the bounded target scenario,
 * it preserves at most the first useful declarative sentence and falls back to
 * a deterministic statement when the model supplied only disallowed content.
 */
export function validateEf41DeepOutput(input: Ef41DeepCompositionInput): string {
  if (!shouldValidateEf41DeepOutput(input)) return input.text;

  const sentence = splitSentences(input.text).find(isUsefulDeclarativeSentence);
  return sentence || EF41_DEEP_FALLBACK;
}
