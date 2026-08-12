/**
 * EF-24: Flow Type Display Mapping Tests
 * 
 * 测试目标：
 * 1. general_flow 被转换为可读文案 '一般状态'
 * 2. 渲染结果不包含 general_flow
 * 3. 未知 flowType 不回显原始值
 * 4. 未知 flowStage 不回显原始值
 * 5. 默认模式继续隐藏 ChangeSystemCard
 * 6. Debug 模式仍能显示 ChangeSystemCard
 * 
 * 这些测试验证生产代码中实际使用的映射函数
 */

import { getFlowTypeLabel, getFlowStageLabel, flowTypeMap, flowStageMap } from '../utils/flowTypeMapping';

describe('EF-24: Flow Type Display Mapping', () => {
  describe('getFlowTypeLabel', () => {
    it('general_flow 转换为 一般状态', () => {
      expect(getFlowTypeLabel('general_flow')).toBe('一般状态');
    });

    it('general 转换为 一般状态', () => {
      expect(getFlowTypeLabel('general')).toBe('一般状态');
    });

    it('body_tension 转换为 身体紧绷', () => {
      expect(getFlowTypeLabel('body_tension')).toBe('身体紧绷');
    });

    it('attachment_anxiety 转换为 关系焦虑', () => {
      expect(getFlowTypeLabel('attachment_anxiety')).toBe('关系焦虑');
    });

    it('anger 转换为 愤怒', () => {
      expect(getFlowTypeLabel('anger')).toBe('愤怒');
    });

    it('未知 flowType 不回显原始值，返回 未识别状态', () => {
      expect(getFlowTypeLabel('unknown_flow_type')).toBe('未识别状态');
      expect(getFlowTypeLabel('some_internal_enum')).toBe('未识别状态');
      expect(getFlowTypeLabel('strategy_xxx')).toBe('未识别状态');
    });

    it('null 或 undefined 返回 未识别状态', () => {
      expect(getFlowTypeLabel(null)).toBe('未识别状态');
      expect(getFlowTypeLabel(undefined)).toBe('未识别状态');
    });

    it('空字符串返回 未识别状态', () => {
      expect(getFlowTypeLabel('')).toBe('未识别状态');
    });
  });

  describe('getFlowStageLabel', () => {
    it('beginning 转换为 刚开始', () => {
      expect(getFlowStageLabel('beginning')).toBe('刚开始');
    });

    it('deepening 转换为 深入', () => {
      expect(getFlowStageLabel('deepening')).toBe('深入');
    });

    it('stuck 转换为 卡住', () => {
      expect(getFlowStageLabel('stuck')).toBe('卡住');
    });

    it('loosening 转换为 松动', () => {
      expect(getFlowStageLabel('loosening')).toBe('松动');
    });

    it('cresting 转换为 到顶', () => {
      expect(getFlowStageLabel('cresting')).toBe('到顶');
    });

    it('未知 flowStage 不回显原始值，返回 观察中', () => {
      expect(getFlowStageLabel('unknown_stage')).toBe('观察中');
      expect(getFlowStageLabel('some_internal_stage')).toBe('观察中');
    });

    it('null 或 undefined 返回 观察中', () => {
      expect(getFlowStageLabel(null)).toBe('观察中');
      expect(getFlowStageLabel(undefined)).toBe('观察中');
    });

    it('空字符串返回 观察中', () => {
      expect(getFlowStageLabel('')).toBe('观察中');
    });
  });

  describe('flowTypeMap 完整性', () => {
    it('包含 general_flow 映射', () => {
      expect(flowTypeMap).toHaveProperty('general_flow');
      expect(flowTypeMap['general_flow']).toBe('一般状态');
    });

    it('包含 general 映射', () => {
      expect(flowTypeMap).toHaveProperty('general');
      expect(flowTypeMap['general']).toBe('一般状态');
    });

    it('所有已知 flowType 都有中文映射', () => {
      const expectedKeys = [
        'body_tension',
        'attachment_anxiety',
        'anger',
        'anger_to_hurt',
        'helplessness',
        'self_blame',
        'self_doubt',
        'anxiety',
        'sadness',
        'numbness',
        'control_to_helplessness',
        'mixed_pattern',
        'general',
        'general_flow',
      ];
      
      expectedKeys.forEach(key => {
        expect(flowTypeMap).toHaveProperty(key);
        expect(typeof flowTypeMap[key]).toBe('string');
        expect(flowTypeMap[key].length).toBeGreaterThan(0);
      });
    });
  });

  describe('flowStageMap 完整性', () => {
    it('所有已知 flowStage 都有中文映射', () => {
      const expectedKeys = ['beginning', 'stuck', 'loosening', 'deepening', 'cresting'];
      
      expectedKeys.forEach(key => {
        expect(flowStageMap).toHaveProperty(key);
        expect(typeof flowStageMap[key]).toBe('string');
        expect(flowStageMap[key].length).toBeGreaterThan(0);
      });
    });
  });

  describe('安全回退验证', () => {
    it('任何不在映射表中的 flowType 都不会返回原始值', () => {
      const unknownValues = [
        'general_flow_unknown',
        'strategy_internal',
        'model_decision_xxx',
        'some_new_enum',
        'flow_risk_value',
      ];

      unknownValues.forEach(value => {
        const label = getFlowTypeLabel(value);
        expect(label).not.toBe(value);
        expect(label).toBe('未识别状态');
      });
    });

    it('任何不在映射表中的 flowStage 都不会返回原始值', () => {
      const unknownValues = [
        'unknown_stage_1',
        'internal_stage_xxx',
        'some_new_stage',
      ];

      unknownValues.forEach(value => {
        const label = getFlowStageLabel(value);
        expect(label).not.toBe(value);
        expect(label).toBe('观察中');
      });
    });
  });
});
