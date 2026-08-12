/**
 * EF-24: Flow Type Display Mapping
 * 将内部枚举值转换为用户可读文案
 * 
 * 这些映射用于 ChangeSystemCard 显示，确保内部枚举值不会直接回显给用户
 */

/**
 * flowType 映射表：将内部 flowType 枚举转换为用户可读的中文状态描述
 */
export const flowTypeMap: Record<string, string> = {
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

/**
 * flowStage 映射表：将内部 flowStage 枚举转换为用户可读的中文方向描述
 */
export const flowStageMap: Record<string, string> = {
  beginning: '刚开始',
  stuck: '卡住',
  loosening: '松动',
  deepening: '深入',
  cresting: '到顶',
};

/**
 * 获取 flowType 的显示标签
 * @param flowType - 内部 flowType 枚举值
 * @returns 用户可读的中文标签，未知值返回 '未识别状态'
 */
export function getFlowTypeLabel(flowType: string | null | undefined): string {
  if (!flowType) return '未识别状态';
  return flowTypeMap[flowType] || '未识别状态';
}

/**
 * 获取 flowStage 的显示标签
 * @param flowStage - 内部 flowStage 枚举值
 * @returns 用户可读的中文标签，未知值返回 '观察中'
 */
export function getFlowStageLabel(flowStage: string | null | undefined): string {
  if (!flowStage) return '观察中';
  return flowStageMap[flowStage] || '观察中';
}
