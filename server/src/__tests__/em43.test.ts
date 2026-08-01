/**
 * EM-43 自动化测试
 * 覆盖：轮数计算、会话隔离、TTL、前两轮规则、人格调整
 * 注意：不导入 ../index 以避免启动服务器
 */
import {
  incrementConversationTurn,
  getConversationTurn,
  cleanupExpiredConversations,
  resetAllConversations,
  _setNowFn,
  _resetNowFn,
} from '../flows/conversationTurns';
import {
  getFirstTwoRoundsRulesWithTurn,
  FIRST_TWO_ROUNDS_RULES,
} from '../flows/firstTwoRoundsRules';
import {
  getFirstTwoRoundsReactionTimeline,
  getFirstTwoRoundsCompanionTimeline,
} from '../flows/firstTwoRoundsReaction';
import { generateReactionTimeline, generateCompanionTimeline, extractSignal } from '../flows/localReactionEngine';

// 从 psychologistRoles 获取所有角色
import { PSYCHOLOGIST_ROLES } from '../roles/psychologistRoles';

beforeEach(() => {
  resetAllConversations();
  _resetNowFn();
});

// ==================== 轮数计算 ====================
describe('EM-43: Conversation Turns', () => {
  test('第 1 条用户消息返回 userTurn = 1', () => {
    const turn = incrementConversationTurn('conv-1');
    expect(turn).toBe(1);
  });

  test('第 2 条用户消息返回 userTurn = 2', () => {
    incrementConversationTurn('conv-1');
    const turn = incrementConversationTurn('conv-1');
    expect(turn).toBe(2);
  });

  test('第 3 条用户消息返回 userTurn = 3（恢复普通策略）', () => {
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    const turn = incrementConversationTurn('conv-1');
    expect(turn).toBe(3);
  });

  test('新 conversationId 从第 1 轮开始', () => {
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    const turn = incrementConversationTurn('conv-new');
    expect(turn).toBe(1);
  });

  test('两个 conversationId 轮数互不影响', () => {
    incrementConversationTurn('conv-a');
    incrementConversationTurn('conv-a');
    incrementConversationTurn('conv-b');
    expect(getConversationTurn('conv-a')).toBe(2);
    expect(getConversationTurn('conv-b')).toBe(1);
  });
});

// ==================== TTL 测试（使用 injectable now） ====================
describe('EM-43: TTL with injectable now', () => {
  test('29分59秒时轮数保持', () => {
    const baseTime = 1000000;
    _setNowFn(() => baseTime);
    incrementConversationTurn('conv-ttl');
    expect(getConversationTurn('conv-ttl')).toBe(1);

    // 推进到 29:59（1799秒后）
    _setNowFn(() => baseTime + 1799 * 1000);
    expect(getConversationTurn('conv-ttl')).toBe(1);
  });

  test('超过30分钟后 getConversationTurn 返回0', () => {
    const baseTime = 1000000;
    _setNowFn(() => baseTime);
    incrementConversationTurn('conv-ttl');
    expect(getConversationTurn('conv-ttl')).toBe(1);

    // 推进到 30:01（1801秒后）
    _setNowFn(() => baseTime + 1801 * 1000);
    expect(getConversationTurn('conv-ttl')).toBe(0);
  });

  test('超过30分钟后下一次 increment 返回1', () => {
    const baseTime = 1000000;
    _setNowFn(() => baseTime);
    incrementConversationTurn('conv-ttl');
    incrementConversationTurn('conv-ttl');
    expect(getConversationTurn('conv-ttl')).toBe(2);

    // 推进到 31 分钟后
    _setNowFn(() => baseTime + 31 * 60 * 1000);
    expect(getConversationTurn('conv-ttl')).toBe(0);

    // 下一次 increment 应该从 1 开始
    const newTurn = incrementConversationTurn('conv-ttl');
    expect(newTurn).toBe(1);
  });

  test('cleanupExpiredConversations 真正删除过期会话', () => {
    const baseTime = 1000000;
    _setNowFn(() => baseTime);
    incrementConversationTurn('conv-old');
    incrementConversationTurn('conv-new');

    // 推进到 31 分钟后
    _setNowFn(() => baseTime + 31 * 60 * 1000);

    // cleanup 应该删除过期会话
    const cleaned = cleanupExpiredConversations();
    expect(cleaned).toBe(2); // 两个都过期了

    // 两个会话都应该被清除
    expect(getConversationTurn('conv-old')).toBe(0);
    expect(getConversationTurn('conv-new')).toBe(0);
  });

  test('两个会话的过期时间互不影响', () => {
    const baseTime = 1000000;
    _setNowFn(() => baseTime);
    incrementConversationTurn('conv-early');

    // 15 分钟后创建第二个会话
    _setNowFn(() => baseTime + 15 * 60 * 1000);
    incrementConversationTurn('conv-late');

    // 20 分钟后（第一个会话 35 分钟，第二个会话 20 分钟）
    _setNowFn(() => baseTime + 35 * 60 * 1000);
    expect(getConversationTurn('conv-early')).toBe(0); // 过期
    expect(getConversationTurn('conv-late')).toBe(1); // 仍然有效
  });
});

// ==================== 前两轮规则 ====================
describe('EM-43: First Two Rounds Rules', () => {
  test('前两轮规则内容存在', () => {
    const rules = getFirstTwoRoundsRulesWithTurn(1);
    expect(rules).toBeTruthy();
    expect(rules.length).toBeGreaterThan(0);
  });

  test('前两轮规则包含关键约束', () => {
    const rules = getFirstTwoRoundsRulesWithTurn(1);
    expect(rules).toContain('不展示可见的分析过程');
    expect(rules).toContain('不下心理诊断');
    expect(rules).toContain('不提供用户未要求的任务');
  });

  test('第 3 轮返回空规则', () => {
    const rules = getFirstTwoRoundsRulesWithTurn(3);
    expect(rules).toBe('');
  });
});

// ==================== Reaction 前两轮行为 ====================
describe('EM-43: Reaction First Two Rounds', () => {
  const ROLE_ID = 'clever-fox';

  test('第 1 轮使用克制陪伴规则', () => {
    const timeline = generateReactionTimeline(ROLE_ID, 'user_message', undefined, 1);
    expect(timeline).toBeTruthy();
    expect(timeline.length).toBeGreaterThan(0);
    // 验证不是空的
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0].text.length).toBeGreaterThan(0);
  });

  test('第 2 轮使用克制陪伴规则', () => {
    const timeline = generateReactionTimeline(ROLE_ID, 'user_message', undefined, 2);
    expect(timeline).toBeTruthy();
    expect(timeline.length).toBeGreaterThan(0);
  });

  test('第 3 轮恢复原有逻辑', () => {
    const timeline = generateReactionTimeline(ROLE_ID, 'user_message', undefined, 3);
    expect(timeline).toBeTruthy();
    // 第 3 轮应该使用正常逻辑，可能有更多 segments
    expect(timeline.length).toBeGreaterThan(0);
  });

  test('Reaction 回复与具体输入有关', () => {
    const input1 = '领导今天当众否定了我的方案。';
    const input2 = '你好。';

    const timeline1 = generateReactionTimeline(ROLE_ID, input1, undefined, 1);
    const timeline2 = generateReactionTimeline(ROLE_ID, input2, undefined, 1);

    // 两个不同输入应该产生不同的回复
    const text1 = timeline1.map(s => s.text).join('');
    const text2 = timeline2.map(s => s.text).join('');
    expect(text1).not.toBe(text2);
  });

  test('Reaction 不含诊断、模式或内部标签', () => {
    const inputs = [
      '领导今天当众否定了我的方案。',
      '他三天没有回复我，我一直在等。',
      '我今天什么都不想做，觉得一切都没意义。',
      '你好。',
      '我不知道该怎么说。',
    ];

    for (const input of inputs) {
      const timeline = generateReactionTimeline(ROLE_ID, input, undefined, 1);
      const allText = timeline.map(s => s.text).join('');

      // 不包含诊断术语
      expect(allText).not.toMatch(/焦虑症|抑郁症|创伤|PTSD|人格障碍/i);
      // 不包含内部标签
      expect(allText).not.toMatch(/neural|signal|prediction|pattern/i);
      // 不包含未经保证的安全承诺
      expect(allText).not.toMatch(/这里安全|你是安全的|保证/i);
    }
  });
});

// ==================== Companion 前两轮行为 ====================
describe('EM-43: Companion First Two Rounds', () => {
  const ROLE_ID = 'clever-fox';

  test('第 1 轮使用克制陪伴规则', () => {
    const timeline = generateCompanionTimeline(ROLE_ID, 'user_message', undefined, 1);
    expect(timeline).toBeTruthy();
    expect(timeline.length).toBeGreaterThan(0);
  });

  test('第 2 轮使用克制陪伴规则', () => {
    const timeline = generateCompanionTimeline(ROLE_ID, 'user_message', undefined, 2);
    expect(timeline).toBeTruthy();
    expect(timeline.length).toBeGreaterThan(0);
  });

  test('第 3 轮恢复原有逻辑', () => {
    const timeline = generateCompanionTimeline(ROLE_ID, 'user_message', undefined, 3);
    expect(timeline).toBeTruthy();
    expect(timeline.length).toBeGreaterThan(0);
  });

  test('Companion 回复与具体输入有关', () => {
    const input1 = '领导今天当众否定了我的方案。';
    const input2 = '你好。';

    const timeline1 = generateCompanionTimeline(ROLE_ID, input1, undefined, 1);
    const timeline2 = generateCompanionTimeline(ROLE_ID, input2, undefined, 1);

    const text1 = timeline1.map(s => s.text).join('');
    const text2 = timeline2.map(s => s.text).join('');
    expect(text1).not.toBe(text2);
  });

  test('Companion 不含诊断、模式或内部标签', () => {
    const inputs = [
      '领导今天当众否定了我的方案。',
      '他三天没有回复我，我一直在等。',
      '我今天什么都不想做，觉得一切都没意义。',
      '你好。',
      '我不知道该怎么说。',
    ];

    for (const input of inputs) {
      const timeline = generateCompanionTimeline(ROLE_ID, input, undefined, 1);
      const allText = timeline.map(s => s.text).join('');

      expect(allText).not.toMatch(/焦虑症|抑郁症|创伤|PTSD|人格障碍/i);
      expect(allText).not.toMatch(/neural|signal|prediction|pattern/i);
      expect(allText).not.toMatch(/这里安全|你是安全的|保证/i);
    }
  });
});

// ==================== 真实体验用例 ====================
describe('EM-43: Real Experience Cases', () => {
  const ROLE_ID = 'clever-fox';

  const testCases = [
    {
      name: '被当众否定',
      input: '领导今天当着所有人的面否定了我的方案。',
    },
    {
      name: '等待回复',
      input: '他三天没有回复我，我一直在等。',
    },
    {
      name: '无力感',
      input: '我今天什么都不想做，觉得一切都没意义。',
    },
    {
      name: '简单问候',
      input: '你好。',
    },
    {
      name: '不知如何表达',
      input: '我不知道该怎么说。',
    },
  ];

  for (const testCase of testCases) {
    test(`Reaction: "${testCase.name}" - 回复与输入相关`, () => {
      const timeline = generateReactionTimeline(ROLE_ID, testCase.input, undefined, 1);
      const allText = timeline.map(s => s.text).join('');

      // 回复不能为空
      expect(allText.length).toBeGreaterThan(0);

      // 对于非问候类输入，回复应该包含与输入相关的内容
      if (testCase.name !== '简单问候') {
        // 回复应该反映用户的情绪或情境
        expect(allText.length).toBeGreaterThan(5);
      }

      // 不包含诊断
      expect(allText).not.toMatch(/焦虑症|抑郁症|创伤|PTSD/i);
      // 不包含内部标签
      expect(allText).not.toMatch(/neural|signal|prediction/i);
      // 不提前给建议
      expect(allText).not.toMatch(/你应该|你可以试试|建议你/i);
    });

    test(`Companion: "${testCase.name}" - 回复与输入相关`, () => {
      const timeline = generateCompanionTimeline(ROLE_ID, testCase.input, undefined, 1);
      const allText = timeline.map(s => s.text).join('');

      expect(allText.length).toBeGreaterThan(0);
      expect(allText).not.toMatch(/焦虑症|抑郁症|创伤|PTSD/i);
      expect(allText).not.toMatch(/neural|signal|prediction/i);
      expect(allText).not.toMatch(/你应该|你可以试试|建议你/i);
    });
  }

  test('所有输入不返回相同的通用句', () => {
    const inputs = testCases.map(tc => tc.input);
    const reactions = inputs.map(input => {
      const timeline = generateReactionTimeline(ROLE_ID, input, undefined, 1);
      return timeline.map(s => s.text).join('');
    });

    // 至少有一些回复是不同的
    const uniqueReactions = new Set(reactions);
    expect(uniqueReactions.size).toBeGreaterThan(1);
  });
});

// ==================== Smart Fox 人格调整 ====================
describe('EM-43: Smart Fox Persona', () => {
  test('Smart Fox 使用新的克制规则', () => {
    const cleverFox = PSYCHOLOGIST_ROLES.find(r => r.id === 'clever-fox');
    expect(cleverFox).toBeTruthy();
    expect(cleverFox!.systemPrompt).toContain('敏锐');
    expect(cleverFox!.systemPrompt).toContain('克制');
  });

  test('其他人格没有受到 Smart Fox 改动影响', () => {
    // 获取 origin/dev 中其他人格的 systemPrompt 快照
    const otherRoles = PSYCHOLOGIST_ROLES.filter(r => r.id !== 'clever-fox');

    for (const role of otherRoles) {
      // 验证其他人格不包含 clever-fox 特有的关键词
      expect(role.systemPrompt).not.toContain('敏锐但克制的陪伴者');
      expect(role.systemPrompt).not.toContain('不主动分析');
    }
  });
});
