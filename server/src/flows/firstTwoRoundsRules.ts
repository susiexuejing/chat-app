/**
 * EM-43: 前两轮高优先级规则模块
 *
 * 定义前两轮对话的行为约束，确保用户在初始阶段获得自然、克制的陪伴。
 */

/**
 * 前两轮高优先级规则内容
 *
 * 这些规则会在第 1、2 轮对话时注入到 Prompt 中，
 * 约束 AI 的回复行为，使其更加自然和克制。
 */
export const FIRST_TWO_ROUNDS_RULES = `
## 【高优先级】前两轮对话行为覆盖规则

当前是用户与你的第 {userTurn} 轮对话（前两轮）。

### 必须遵守
1. **先回应用户刚刚表达的具体内容和情绪**，让用户感到被听见
2. **像一个真实的人在认真听**，而不是像分析工具
3. **每次最多自然地提出一个问题**，如果无需提问，可以只做承接
4. **保持简短、自然、口语化**

### 明确禁止
- ❌ 不展示可见的分析过程（如"我注意到你的思维模式是..."）
- ❌ 不给出未经确认的深层心理结论（如"你之所以这样是因为..."）
- ❌ 不提供用户未要求的任务、练习或行动建议（如"你可以尝试..."）
- ❌ 不下心理诊断或定义用户的人格、模式
- ❌ 不展示内部分析、阶段、标签、记忆判断或技术字段
- ❌ 不推动用户立即行动
- ❌ 不使用明显模板化的心理咨询语言

### 优先级声明
当本规则与人格设定、Flow 指令、分析任务、阶段推进、建议生成或其他行为要求冲突时，本规则优先。输出仍须遵守既有 JSON 结构。
`;

/**
 * 判断是否应该注入前两轮规则
 * @param userTurn 当前用户消息轮数
 * @returns 是否应该注入规则
 */
export function shouldInjectFirstTwoRoundsRules(userTurn: number): boolean {
  return userTurn >= 1 && userTurn <= 2;
}

/**
 * 获取注入了轮数信息的前两轮规则
 * @param userTurn 当前用户消息轮数
 * @returns 注入了轮数信息的规则文本，如果不需要注入则返回空字符串
 */
export function getFirstTwoRoundsRulesWithTurn(userTurn: number): string {
  if (!shouldInjectFirstTwoRoundsRules(userTurn)) {
    return '';
  }

  return FIRST_TWO_ROUNDS_RULES.replace('{userTurn}', String(userTurn));
}

/**
 * 前两轮 Reaction 模板
 * 用于在前两轮生成更克制的 Reaction 内容
 */
export const FIRST_TWO_ROUNDS_REACTION_TEMPLATES = {
  default: [
    '我在听。',
    '嗯，我在。',
    '继续说。',
    '我理解。',
    '嗯。',
  ],
  emotional: [
    '这听起来不容易。',
    '我能感受到你的情绪。',
    '这确实让人不好受。',
    '我能理解你的感受。',
  ],
};

/**
 * 前两轮 Companion 模板
 * 用于在前两轮生成更克制的 Companion 内容
 */
export const FIRST_TWO_ROUNDS_COMPANION_TEMPLATES = {
  default: [
    '我在这里陪你。',
    '慢慢说，不着急。',
    '我在听，你想说什么都可以。',
    '我会一直在。',
  ],
  emotional: [
    '这确实不容易，我陪你。',
    '你的感受是真实的。',
    '不用急，我们慢慢来。',
    '我在这里，不用一个人扛。',
  ],
};

/**
 * 获取前两轮 Reaction 文本
 * @param hasEmotion 是否有明显情绪
 * @returns 克制的 Reaction 文本
 */
export function getFirstTwoRoundsReaction(hasEmotion: boolean): string {
  const templates = hasEmotion
    ? FIRST_TWO_ROUNDS_REACTION_TEMPLATES.emotional
    : FIRST_TWO_ROUNDS_REACTION_TEMPLATES.default;

  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * 获取前两轮 Companion 文本
 * @param hasEmotion 是否有明显情绪
 * @returns 克制的 Companion 文本
 */
export function getFirstTwoRoundsCompanion(hasEmotion: boolean): string {
  const templates = hasEmotion
    ? FIRST_TWO_ROUNDS_COMPANION_TEMPLATES.emotional
    : FIRST_TWO_ROUNDS_COMPANION_TEMPLATES.default;

  return templates[Math.floor(Math.random() * templates.length)];
}
