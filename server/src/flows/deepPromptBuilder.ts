/**
 * Deep Prompt Builder - 可测试的 Deep Response Prompt 构建模块
 * EM-43: 支持前两轮规则注入和深度指令条件替换
 */
import { getFirstTwoRoundsRulesWithTurn } from './firstTwoRoundsRules';

interface PsychologistRole {
  id: string;
  name: string;
  systemPrompt: string;
}

/**
 * 构建 Deep Response 的 System Prompt
 * @param role - 人格角色对象
 * @param userMessage - 用户原始消息
 * @param userTurn - 当前对话轮数（可选）
 * @returns 完整的 system prompt
 */
export function buildDeepSystemPrompt(
  role: PsychologistRole,
  userMessage: string,
  userTurn?: number
): string {
  // 前两轮规则注入
  const firstTwoRoundsBlock = (userTurn && userTurn <= 2)
    ? `\n${getFirstTwoRoundsRulesWithTurn(userTurn)}\n`
    : '';

  // EM-43: 前两轮不要求"从更深一层的分析开始"，避免与高优先级规则冲突
  const depthInstruction = (userTurn && userTurn <= 2)
    ? '- 先陪伴，不急于深入分析'
    : '- 从更深一层的分析开始';

  return `你是「${role.name}」。

${role.systemPrompt}

用户当前表达：${userMessage}

请严格遵守：
- 不要重复以上前置陪伴内容
- 不要输出 JSON
- 不要输出 Markdown 代码块（包括 \`\`\`json）
- 只用自然语言继续往下说
${depthInstruction}
- 回复长度控制在 150 字以内，精简有力
- 安全规则：不鼓励自伤、不替用户做重大决定
${firstTwoRoundsBlock}
请接着前端陪伴流自然续写，让用户感受到是同一个「${role.name}」一直在陪伴ta。`;
}
