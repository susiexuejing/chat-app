import { generateCompanionTimeline, generateReactionTimeline } from '../flows/localReactionEngine';
import { extractSignal } from '../flows/signalExtractor';
import { buildDeepSystemPrompt } from '../flows/deepSystemPromptBuilder';

const ROLE_ID = 'clever-fox';
const ROLE_NAME = '聪明狐狸';

const positiveInputs = [
  '今天发生了很多事，我脑子很乱，不知道该从哪里说起。',
  '事情一件接一件，我现在思绪全挤成一团，完全不知道先讲哪件。',
  '今天的信息太多了，脑子像塞满了一样，想说却找不到开头。',
];

const negativeInputs = [
  '桌面有点乱，我刚把书和杯子收拾好了。',
  '上午开会，下午买菜，晚上看了电影，今天安排得挺满。',
];

function frontLayers(message: string, roleId = ROLE_ID, userTurn = 1) {
  const signal = extractSignal(message);
  const reaction = generateReactionTimeline(roleId, message, signal, userTurn).map(segment => segment.text).join('');
  const companion = generateCompanionTimeline(roleId, message, signal, userTurn).map(segment => segment.text).join('');
  return { reaction, companion, combined: `${reaction}${companion}` };
}

function productionDeepPrompt(message: string, roleId = ROLE_ID, userTurn = 1) {
  return buildDeepSystemPrompt(
    roleId,
    roleId === ROLE_ID ? ROLE_NAME : '温暖小熊',
    '',
    undefined,
    null,
    '',
    null,
    '',
    userTurn,
    message,
  );
}

/**
 * Deterministic substitute for DashScope. It validates and follows the scoped
 * production prompt contract without pretending that a real model ran locally.
 */
function mockDeepFromPrompt(prompt: string): string {
  if (prompt.includes('===== EF-41 首两轮组合约束 =====')) {
    return '等这一团稍微松开后，事情的轻重也许会慢慢显出来。';
  }
  return '你愿意再说一点吗？';
}

describe('EF-41 QA attempt 1: complete response composition', () => {
  test.each(positiveInputs)('recognizes overload and confusion: %s', (message) => {
    const front = frontLayers(message);

    expect(front.reaction).toContain('很多事情一下子挤在一起');
    expect(front.reaction).toMatch(/脑子很乱|不知道从哪里开始/);
    expect(front.companion).toContain('不用一次理清全部');
    expect(front.companion).toMatch(/一件.{0,8}最让你卡住的事/);
    expect(front.combined).not.toMatch(/「.+」这件事，你提到了|你说的，我都在听/);
  });

  test.each(positiveInputs)('keeps one question across Reaction + Companion + mocked Deep: %s', (message) => {
    const front = frontLayers(message);
    const prompt = productionDeepPrompt(message);
    const deep = mockDeepFromPrompt(prompt);
    const combined = `${front.combined}${deep}`;

    expect(prompt).toContain('前置 Reaction 与 Companion 已经完成理解、减压，并提出了本轮唯一的问题');
    expect(prompt).toContain('Deep 续写不得提出任何问题，也不得使用问号');
    expect(prompt).toContain('不得重复“先挑一件 / 先说一件 / 随便说 / 从哪里开始”等邀请');
    expect((combined.match(/[？?]/g) || [])).toHaveLength(1);
    expect(deep).not.toMatch(/[？?]/);
    expect(deep).not.toMatch(/先挑一件|先说一件|随便说|从哪里开始|不用一次理清|慢慢来|我在听|我帮你收着/);
  });

  test.each(negativeInputs)('does not trigger the bounded behavior: %s', (message) => {
    const front = frontLayers(message);
    const prompt = productionDeepPrompt(message);

    expect(front.combined).not.toContain('很多事情一下子挤在一起');
    expect(front.combined).not.toContain('不用一次理清全部');
    expect(prompt).not.toContain('===== EF-41 首两轮组合约束 =====');
  });

  test('second turn keeps the bounded composition contract', () => {
    const message = positiveInputs[1];
    const front = frontLayers(message, ROLE_ID, 2);
    const prompt = productionDeepPrompt(message, ROLE_ID, 2);
    const deep = mockDeepFromPrompt(prompt);

    expect((`${front.combined}${deep}`.match(/[？?]/g) || [])).toHaveLength(1);
    expect(prompt).toContain('===== EF-41 首两轮组合约束 =====');
  });

  test('third turn does not receive EF-41 front-layer or Deep constraints', () => {
    const message = positiveInputs[1];
    const front = frontLayers(message, ROLE_ID, 3);
    const prompt = productionDeepPrompt(message, ROLE_ID, 3);

    expect(front.combined).not.toContain('很多事情一下子挤在一起');
    expect(prompt).not.toContain('===== EF-41 首两轮组合约束 =====');
  });

  test('expanded recognition does not alter another personality', () => {
    const message = positiveInputs[1];
    const front = frontLayers(message, 'warm-bear', 1);
    const prompt = productionDeepPrompt(message, 'warm-bear', 1);

    expect(front.combined).not.toContain('很多事情一下子挤在一起');
    expect(front.combined).not.toContain('不用一次理清全部');
    expect(prompt).not.toContain('===== EF-41 首两轮组合约束 =====');
  });
});
