/**
 * EF-24: Flow Type Display Mapping Tests
 * 测试内部枚举值转换为用户可读文案
 */

// 模拟 index.tsx 中的 flowTypeMap 和 flowStageMap
const flowTypeMap: Record<string, string> = {
  body_tension: '身体紧绷',
  attachment_anxiety: '关系焦虑',
  anger: '愤怒',
  anger_to_hurt: '愤怒背后是受伤',
  helplessness: '无助感',
  self_blame: '自我责备',
  self_doubt: '自我怀疑',
  anxiety: '焦虑',
  sadness: '悲伤',
  numbness: '麻木',
  control_to_helplessness: '控制失败→无力',
  mixed_pattern: '混合情绪',
  general: '一般状态',
  general_flow: '一般状态',
};

const flowStageMap: Record<string, string> = {
  beginning: '刚开始',
  stuck: '卡住',
  loosening: '松动',
  deepening: '深入',
  cresting: '到顶',
};

// 模拟 buildChangeSystemData 中的转换逻辑
function getFlowTypeLabel(flowType: string | null): string {
  return flowTypeMap[flowType || ''] || '未识别状态';
}

function getFlowStageLabel(flowStage: string | null): string {
  return flowStageMap[flowStage || ''] || '观察中';
}

describe('EF-24: Flow Type Display Mapping', () => {
  describe('flowType 转换', () => {
    test('general_flow 转换为 "一般状态"', () => {
      expect(getFlowTypeLabel('general_flow')).toBe('一般状态');
    });

    test('general 转换为 "一般状态"', () => {
      expect(getFlowTypeLabel('general')).toBe('一般状态');
    });

    test('已知枚举值正确转换', () => {
      expect(getFlowTypeLabel('body_tension')).toBe('身体紧绷');
      expect(getFlowTypeLabel('anger')).toBe('愤怒');
      expect(getFlowTypeLabel('anxiety')).toBe('焦虑');
      expect(getFlowTypeLabel('helplessness')).toBe('无助感');
    });

    test('未知枚举值不回显原始值，显示 "未识别状态"', () => {
      expect(getFlowTypeLabel('unknown_type')).toBe('未识别状态');
      expect(getFlowTypeLabel('some_new_internal_value')).toBe('未识别状态');
      expect(getFlowTypeLabel('')).toBe('未识别状态');
    });

    test('null 值显示 "未识别状态"', () => {
      expect(getFlowTypeLabel(null)).toBe('未识别状态');
    });

    test('页面不包含 general_flow 原始值', () => {
      // 验证所有可能的输入都不会返回 'general_flow'
      const testValues = ['general_flow', 'unknown', '', null];
      testValues.forEach((val) => {
        const result = getFlowTypeLabel(val);
        expect(result).not.toBe('general_flow');
      });
    });
  });

  describe('flowStage 转换', () => {
    test('已知枚举值正确转换', () => {
      expect(getFlowStageLabel('beginning')).toBe('刚开始');
      expect(getFlowStageLabel('stuck')).toBe('卡住');
      expect(getFlowStageLabel('deepening')).toBe('深入');
    });

    test('未知枚举值不回显原始值，显示 "观察中"', () => {
      expect(getFlowStageLabel('unknown_stage')).toBe('观察中');
      expect(getFlowStageLabel('some_new_stage')).toBe('观察中');
    });

    test('null 值显示 "观察中"', () => {
      expect(getFlowStageLabel(null)).toBe('观察中');
    });
  });
});
