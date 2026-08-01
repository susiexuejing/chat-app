/**
 * EM-43 自动化测试
 * 
 * 测试轮数计算、会话隔离、前两轮规则注入
 */

import {
  incrementConversationTurn,
  getConversationTurn,
  resetAllConversations,
} from '../flows/conversationTurns';
import { FIRST_TWO_ROUNDS_RULES } from '../flows/firstTwoRoundsRules';

describe('EM-43: Conversation Turns', () => {
  beforeEach(() => {
    resetAllConversations();
  });

  test('第 1 条用户消息返回 userTurn = 1', () => {
    const userTurn = incrementConversationTurn('conv-1');
    expect(userTurn).toBe(1);
  });

  test('第 2 条用户消息返回 userTurn = 2', () => {
    incrementConversationTurn('conv-1');
    const userTurn = incrementConversationTurn('conv-1');
    expect(userTurn).toBe(2);
  });

  test('第 3 条用户消息返回 userTurn = 3', () => {
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    const userTurn = incrementConversationTurn('conv-1');
    expect(userTurn).toBe(3);
  });

  test('新会话重新从第 1 轮开始', () => {
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    
    const userTurn = incrementConversationTurn('conv-2');
    expect(userTurn).toBe(1);
  });

  test('两个 conversationId 轮数互不影响', () => {
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    incrementConversationTurn('conv-1');
    
    incrementConversationTurn('conv-2');
    
    expect(getConversationTurn('conv-1')).toBe(3);
    expect(getConversationTurn('conv-2')).toBe(1);
  });

  test('getConversationTurn 返回当前轮数', () => {
    expect(getConversationTurn('conv-1')).toBe(0);
    
    incrementConversationTurn('conv-1');
    expect(getConversationTurn('conv-1')).toBe(1);
    
    incrementConversationTurn('conv-1');
    expect(getConversationTurn('conv-1')).toBe(2);
  });
});

describe('EM-43: First Two Rounds Rules', () => {
  test('前两轮规则内容存在', () => {
    expect(FIRST_TWO_ROUNDS_RULES).toBeDefined();
    expect(FIRST_TWO_ROUNDS_RULES.length).toBeGreaterThan(0);
  });

  test('前两轮规则包含关键约束', () => {
    expect(FIRST_TWO_ROUNDS_RULES).toContain('分析');
    expect(FIRST_TWO_ROUNDS_RULES).toContain('建议');
    expect(FIRST_TWO_ROUNDS_RULES).toContain('陪伴');
  });
});
