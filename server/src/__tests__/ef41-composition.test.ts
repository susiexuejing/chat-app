import { generateCompanionTimeline, generateReactionTimeline } from '../flows/localReactionEngine';
import { extractSignal } from '../flows/signalExtractor';
import { buildDeepSystemPrompt } from '../flows/deepSystemPromptBuilder';
import { incrementConversationTurnIdempotent, resetAllConversations } from '../flows/conversationTurns';
import { shouldValidateEf41DeepOutput, validateEf41DeepOutput } from '../flows/ef41DeepCompositionValidator';
import { isConfusedOverload } from '../flows/firstTwoRoundsReaction';

const ROLE_ID = 'clever-fox';
const ROLE_NAME = '聪明狐狸';

const positiveInputs = [
  '今天发生了很多事，我脑子很乱，不知道该从哪里说起。',
  '事情一件接一件，我现在思绪全挤成一团，完全不知道先讲哪件。',
  '今天的信息太多了，脑子像塞满了一样，想说却找不到开头。',
];

const secondTurnInput = '事情全挤在脑子里，我完全不知道该先说什么。';

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
  if (prompt.includes('===== 首两轮事实合同（最高优先级）=====')) {
    return '我听到了。';
  }
  return '你愿意再说一点吗？';
}

describe('EF-41 QA2: target detection, role scope, and response composition', () => {
  beforeEach(() => resetAllConversations());

  test.each(positiveInputs)('recognizes overload and confusion: %s', (message) => {
    const front = frontLayers(message);

    expect(front.reaction).toMatch(/太多|塞满|一件接一件|挤成一团|脑子乱|从哪里说起/);
    expect(front.companion).toContain('不用一次理清');
    expect(front.companion).toMatch(/最卡住你的.{0,4}哪一小块/);
    expect(front.combined).not.toMatch(/「.+」这件事，你提到了|你说的，我都在听/);
  });

  test('grounds the three positive fronts without one byte-identical canned pair', () => {
    const fronts = positiveInputs.map(message => frontLayers(message));

    expect(new Set(fronts.map(front => front.combined)).size).toBe(3);
    expect(fronts[0].reaction).toMatch(/事情|脑子乱|从哪里说起/);
    expect(fronts[1].reaction).toMatch(/一件接一件|思绪|挤成一团|先讲哪件/);
    expect(fronts[2].reaction).toMatch(/信息太多|塞满|开头/);
  });

  test.each(positiveInputs)('keeps one question across Reaction + Companion + mocked Deep: %s', (message) => {
    const front = frontLayers(message);
    const prompt = productionDeepPrompt(message);
    const deep = mockDeepFromPrompt(prompt);
    const combined = `${front.combined}${deep}`;

    expect(prompt).toContain('===== 首两轮事实合同（最高优先级）=====');
    expect(prompt).toContain('当前这条用户消息是关于用户的唯一事实来源');
    expect(prompt).toContain('完整输出不超过 120 个中文字符');
    expect((combined.match(/[？?]/g) || [])).toHaveLength(1);
    expect((combined.match(/我在听|我听到了|我都在|陪着|帮你收着|我记着/g) || []).length).toBeLessThanOrEqual(1);
    expect(combined).not.toMatch(/你应该|你可以试试|建议你|要不|不如|去窗边|先深呼吸/);
    expect(deep).not.toMatch(/[？?]/);
    expect(deep).not.toMatch(/先挑一件|先说一件|随便说|从哪里开始|不用一次理清|慢慢来|我在听|我帮你收着/);
  });

  test.each(negativeInputs)('keeps the universal entry-turn factual contract without changing the front: %s', (message) => {
    const front = frontLayers(message);
    const prompt = productionDeepPrompt(message);

    expect(isConfusedOverload(message, true)).toBe(false);
    expect(front.combined).not.toContain('此刻最卡住你的，是哪一小块');
    expect(prompt).toContain('===== 首两轮事实合同（最高优先级）=====');
  });

  test('entry-turn prompt excludes role life, front, change, and LTU context', () => {
    const prompt = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      'FRONT_CONTEXT_SHOULD_NOT_APPEAR',
      undefined,
      null,
      'CHANGE_CONTEXT_SHOULD_NOT_APPEAR',
      null,
      'LTU_CONTEXT_SHOULD_NOT_APPEAR',
      1,
      '今天有点忙。',
    );

    expect(prompt).toContain('===== 首两轮事实合同（最高优先级）=====');
    expect(prompt).not.toContain('FRONT_CONTEXT_SHOULD_NOT_APPEAR');
    expect(prompt).not.toContain('CHANGE_CONTEXT_SHOULD_NOT_APPEAR');
    expect(prompt).not.toContain('LTU_CONTEXT_SHOULD_NOT_APPEAR');
    expect(prompt).not.toContain('EmotionFlow 生命系统');
  });

  test('second turn keeps the bounded composition contract', () => {
    const conversationId = 'conv_ef41_qa2_p3';
    expect(incrementConversationTurnIdempotent(conversationId, 'req_ef41_qa2_1')).toBe(1);
    const userTurn = incrementConversationTurnIdempotent(conversationId, 'req_ef41_qa2_2');
    const front = frontLayers(secondTurnInput, ROLE_ID, userTurn);
    const prompt = productionDeepPrompt(secondTurnInput, ROLE_ID, userTurn);
    const deep = validateEf41DeepOutput({
      text: '你想到哪句就随手丢出来。要不先去窗边站一会儿。',
      roleId: ROLE_ID,
      userTurn,
      userMessage: secondTurnInput,
      source: 'cleaned',
    });

    expect(userTurn).toBe(2);
    expect(front.reaction).toBe('事情全挤在脑子里，连先说什么都拿不准。');
    expect((`${front.combined}${deep}`.match(/[？?]/g) || [])).toHaveLength(1);
    expect(prompt).toContain('===== 首两轮事实合同（最高优先级）=====');
    expect(shouldValidateEf41DeepOutput({
      text: '',
      roleId: ROLE_ID,
      userTurn,
      userMessage: secondTurnInput,
      source: 'cleaned',
    })).toBe(true);
    expect(deep).not.toMatch(/想到哪|随手丢|要不|窗边|[？?]/);
  });

  test('third turn does not receive entry-turn Deep constraints', () => {
    const message = positiveInputs[1];
    const front = frontLayers(message, ROLE_ID, 3);
    const prompt = productionDeepPrompt(message, ROLE_ID, 3);

    expect(front.combined).not.toContain('很多事情一下子挤在一起');
    expect(prompt).not.toContain('===== 首两轮事实合同（最高优先级）=====');
  });

  test('another personality receives the same entry-turn safety contract', () => {
    const message = positiveInputs[0];
    const front = frontLayers(message, 'warm-bear', 1);
    const prompt = productionDeepPrompt(message, 'warm-bear', 1);

    expect(front.combined).not.toContain('今天的事情一下子堆得太多');
    expect(front.combined).not.toContain('此刻最卡住你的，是哪一小块');
    expect(prompt).toContain('===== 首两轮事实合同（最高优先级）=====');
  });
});
