import { generateCompanionTimeline, generateReactionTimeline } from '../flows/localReactionEngine';
import { extractSignal } from '../flows/signalExtractor';
import {
  EF41_DEEP_FALLBACK,
  FIRST_TWO_ROUNDS_DEEP_FALLBACK,
  type Ef41DeepOutputSource,
  validateEf41DeepOutput,
} from '../flows/ef41DeepCompositionValidator';

const positiveMessages = [
  '今天发生了很多事，我脑子很乱，不知道该从哪里说起。',
  '事情一件接一件，我现在思绪全挤成一团，完全不知道先讲哪件。',
  '今天的信息太多了，脑子像塞满了一样，想说却找不到开头。',
];

const secondTurnMessage = '事情全挤在脑子里，我完全不知道该先说什么。';

const ctoRuntimeFailure = '我手边刚好有杯温咖啡，正对着笔记本理思路，你只管在这儿喘口气，等哪根线头自己松动了，我们再顺着往下摸。';

const devFailureFixtures: Array<{
  name: string;
  source: Ef41DeepOutputSource;
  message: string;
  before: string;
}> = [
  {
    name: 'Exact cleaned content repeats invitation and holding',
    source: 'cleaned',
    message: positiveMessages[0],
    before: '把脑子里的碎片倒一倒，把最硌人的那一件丢出来，我都在旁边陪着。',
  },
  {
    name: 'Positive 1 last-resort content repeats the front invitation',
    source: 'last-resort',
    message: positiveMessages[1],
    before: '你想到哪句就随手丢出来，我会跟着听。',
  },
  {
    name: 'Positive 2 reasoning fallback adds unsolicited action advice',
    source: 'reasoning',
    message: positiveMessages[2],
    before: '要不先把东西全推开，去窗边站一会儿，哪怕什么都不做。',
  },
];

function validateOutput(
  text: string,
  message: string,
  source: Ef41DeepOutputSource,
  roleId = 'clever-fox',
  userTurn = 1,
) {
  return validateEf41DeepOutput({
    text,
    roleId,
    userTurn,
    userMessage: message,
    source,
  });
}

function frontOutput(message: string): string {
  const signal = extractSignal(message);
  const reaction = generateReactionTimeline('clever-fox', message, signal, 1).map(segment => segment.text).join('');
  const companion = generateCompanionTimeline('clever-fox', message, signal, 1).map(segment => segment.text).join('');
  return `${reaction}${companion}`;
}

describe('EF-41 Deep output composition validator', () => {
  test.each(devFailureFixtures)('$name', ({ source, message, before }) => {
    const after = validateOutput(before, message, source);
    const combined = `${frontOutput(message)}${after}`;

    expect(after).toBe(EF41_DEEP_FALLBACK);
    expect(after).not.toMatch(/[？?]/);
    expect(after).not.toMatch(/倒一倒|丢出来|随手丢|想到哪|我都在|陪着|要不|推开|去窗边|站一会儿/);
    expect((combined.match(/[？?]/g) || [])).toHaveLength(1);
  });

  test('preserves at most the first useful declarative sentence', () => {
    const input = '你想到哪句就随手丢出来。等这一团稍微松开，事情的轻重也许会慢慢显出来。之后的层次可能会更清楚。';
    const output = validateOutput(input, positiveMessages[0], 'cleaned');

    expect(output).toBe('等这一团稍微松开，事情的轻重也许会慢慢显出来。');
  });

  test('rejects a model question and keeps a later useful statement', () => {
    const input = '你愿意先挑一件说吗？现在的混乱不代表每件事同样重要。';
    const output = validateOutput(input, positiveMessages[0], 'cleaned');

    expect(output).toBe('现在的混乱不代表每件事同样重要。');
    expect(output).not.toMatch(/[？?]/);
  });

  test('returns third-turn output byte-for-byte', () => {
    const original = '你想到哪句就随手丢出来？我都在旁边陪着。';
    const output = validateOutput(original, positiveMessages[0], 'cleaned', 'clever-fox', 3);

    expect(output).toBe(original);
  });

  test.each([
    ['negative physical mess', '桌面有点乱，我刚把书和杯子收拾好了。', 'clever-fox'],
    ['negative busy day', '上午开会，下午买菜，晚上看了电影，今天安排得挺满。', 'clever-fox'],
    ['another personality', positiveMessages[0], 'warm-bear'],
  ])('applies the entry-turn contract to every first-turn reply: %s', (_name, message, roleId) => {
    const original = '你想到哪句就随手丢出来？我都在旁边陪着。';
    const output = validateOutput(original, String(message), 'cleaned', String(roleId), 1);

    expect(output).toBe(FIRST_TWO_ROUNDS_DEEP_FALLBACK);
  });

  test.each(['cleaned', 'last-resort', 'reasoning'] as const)('uses deterministic fallback on the %s path when every sentence is rejected', (source) => {
    const output = validateOutput('你想从哪里开始？我都在旁边陪着。', positiveMessages[0], source);
    expect(output).toBe(EF41_DEEP_FALLBACK);
  });

  test.each(['cleaned', 'last-resort', 'reasoning'] as const)('activates for the P3 second-turn %s path', (source) => {
    const output = validateOutput(
      '你想到哪句就随手丢出来。要不先去窗边站一会儿。',
      secondTurnMessage,
      source,
      'clever-fox',
      2,
    );

    expect(output).toBe(EF41_DEEP_FALLBACK);
    expect(output).not.toMatch(/想到哪|随手丢|要不|窗边|[？?]/);
  });

  test.each(['cleaned', 'last-resort', 'reasoning'] as const)('rejects the exact CTO runtime output on the %s path', (source) => {
    const output = validateOutput(ctoRuntimeFailure, positiveMessages[1], source);

    expect(output).toBe(FIRST_TWO_ROUNDS_DEEP_FALLBACK);
    expect(output).not.toMatch(/你只管|喘口气|我们再|往下摸/);
  });

  test('preserves an objective non-directive declarative sentence', () => {
    const objective = '脑子里塞满东西的时候，确实会像一团理不清的毛线。';
    const output = validateOutput(objective, positiveMessages[1], 'cleaned');

    expect(output).toBe(objective);
  });

  test('rejects an unseen user-directed and joint-progression paraphrase', () => {
    const output = validateOutput(
      '这会儿确实很挤，你先缓一缓，咱们再一起看看哪条线更清楚。',
      positiveMessages[1],
      'cleaned',
    );

    expect(output).toBe(EF41_DEEP_FALLBACK);
  });

  test.each([
    ['assistant life material', '我正坐在窗边喝咖啡，翻着笔记本。', '今天只想安静一下。'],
    ['unsupported historical claim', '你之前总说自己累。', '今天有点忙。'],
    ['unsupported emotional inference', '你又觉得心里沉了。', '今天开会很多。'],
    ['overlong reply', '我听到了。'.repeat(31), '今天有点忙。'],
  ])('uses the neutral fallback for reported entry-turn failure: %s', (_name, text, message) => {
    expect(validateOutput(text, message, 'cleaned', 'warm-bear', 1))
      .toBe(FIRST_TWO_ROUNDS_DEEP_FALLBACK);
  });

  test('allows one explicitly optional invitation grounded in the current turn', () => {
    const output = validateOutput('如果你愿意，可以说说今天最忙的是哪一段？', '今天开会很多。', 'cleaned', 'warm-bear', 1);

    expect(output).toBe('如果你愿意，可以说说今天最忙的是哪一段？');
  });

  test('keeps the complete visible entry turn within 120 characters', () => {
    const visiblePrefix = '你说的这些，我听到了。慢慢来，不急着一次说清。';
    const allowedDeep = '如果你愿意，可以从今天最忙的一段说起？';
    const output = validateEf41DeepOutput({
      text: allowedDeep,
      roleId: 'warm-bear',
      userTurn: 1,
      userMessage: '今天开会很多。',
      source: 'cleaned',
      visiblePrefix,
    });

    expect(Array.from(`${visiblePrefix}${output}`).length).toBeLessThanOrEqual(120);
    expect(output).toBe(allowedDeep);
  });

  test('falls back when Deep would exceed the remaining visible entry-turn budget', () => {
    const visiblePrefix = '前置内容'.repeat(29);
    const output = validateEf41DeepOutput({
      text: '我听到了。',
      roleId: 'warm-bear',
      userTurn: 1,
      userMessage: '今天开会很多。',
      source: 'cleaned',
      visiblePrefix,
    });

    expect(output).toBe('');
  });
});
