/**
 * Step 3 — Long-Term Understanding 持久化 V1
 *
 * 六人格分别保存自己对同一用户的长期理解。
 * 每轮 Deep 完成后更新，下一轮注入 Deep Prompt。
 * 基于文件系统 JSON 存储，每个 userId+roleId 一个文件。
 */

import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface FoxUnderstanding {
  cognitivePatterns: string[];
  recurringDistortions: string[];
  actionBlockers: string[];
  effectiveReframes: string[];
}

export interface BearUnderstanding {
  hurtPoints: string[];
  safetyNeeds: string[];
  exhaustionSignals: string[];
  soothingPatterns: string[];
}

export interface OwlUnderstanding {
  recurringThemes: string[];
  earlyExperienceHints: string[];
  defensePatterns: string[];
  unconsciousSignals: string[];
}

export interface ElfUnderstanding {
  emotionalPatterns: string[];
  bodySignals: string[];
  blockedFeelings: string[];
  expressionChannels: string[];
}

export interface DolphinUnderstanding {
  meaningQuestions: string[];
  valueConflicts: string[];
  freedomFears: string[];
  existentialThemes: string[];
}

export interface ElephantUnderstanding {
  relationshipPatterns: string[];
  familyRoles: string[];
  boundaryIssues: string[];
  connectionNeeds: string[];
}

export type RoleSpecificUnderstanding =
  | { roleId: 'clever-fox'; data: FoxUnderstanding }
  | { roleId: 'warm-bear'; data: BearUnderstanding }
  | { roleId: 'wise-owl'; data: OwlUnderstanding }
  | { roleId: 'emotion-elf'; data: ElfUnderstanding }
  | { roleId: 'philosophical-dolphin'; data: DolphinUnderstanding }
  | { roleId: 'family-elephant'; data: ElephantUnderstanding };

export interface PreferredResponseStyle {
  likes: string[];
  dislikes: string[];
}

export interface LTUProfile {
  userId: string;
  roleId: string;

  /** 跨会话积累的主题关键词 */
  dominantThemes: string[];
  /** 反复出现的心理流向类型 */
  recurringFlowPatterns: string[];
  /** 常见的情绪触发点 */
  emotionalTriggers: string[];

  /** 该人格独有的理解字段 */
  roleSpecific: RoleSpecificUnderstanding;

  /** 用户偏好（从行为中观察） */
  preferredResponseStyle: PreferredResponseStyle;

  /** 最近 3 次用户输入摘要（用于保持上下文连续性） */
  recentInputs: string[];

  lastUpdated: number;
  totalInteractions: number;
}

/**
 * 创建一个新的空白 LTU 档案
 */
function createEmptyProfile(userId: string, roleId: string): LTUProfile {
  const base = {
    userId,
    roleId,
    dominantThemes: [] as string[],
    recurringFlowPatterns: [] as string[],
    emotionalTriggers: [] as string[],
    preferredResponseStyle: { likes: [], dislikes: [] },
    recentInputs: [] as string[],
    lastUpdated: Date.now(),
    totalInteractions: 0,
  };

  switch (roleId) {
    case 'clever-fox':
      return { ...base, roleSpecific: { roleId: 'clever-fox', data: { cognitivePatterns: [], recurringDistortions: [], actionBlockers: [], effectiveReframes: [] } } };
    case 'warm-bear':
      return { ...base, roleSpecific: { roleId: 'warm-bear', data: { hurtPoints: [], safetyNeeds: [], exhaustionSignals: [], soothingPatterns: [] } } };
    case 'wise-owl':
      return { ...base, roleSpecific: { roleId: 'wise-owl', data: { recurringThemes: [], earlyExperienceHints: [], defensePatterns: [], unconsciousSignals: [] } } };
    case 'emotion-elf':
      return { ...base, roleSpecific: { roleId: 'emotion-elf', data: { emotionalPatterns: [], bodySignals: [], blockedFeelings: [], expressionChannels: [] } } };
    case 'philosophical-dolphin':
      return { ...base, roleSpecific: { roleId: 'philosophical-dolphin', data: { meaningQuestions: [], valueConflicts: [], freedomFears: [], existentialThemes: [] } } };
    case 'family-elephant':
      return { ...base, roleSpecific: { roleId: 'family-elephant', data: { relationshipPatterns: [], familyRoles: [], boundaryIssues: [], connectionNeeds: [] } } };
    default:
      return { ...base, roleSpecific: { roleId: 'clever-fox', data: { cognitivePatterns: [], recurringDistortions: [], actionBlockers: [], effectiveReframes: [] } } };
  }
}

// ═══════════════════════════════════════════════════════════════
// Storage: 文件系统 (server/data/ltu/)
// ═══════════════════════════════════════════════════════════════

function getDataDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'ltu');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getProfilePath(userId: string, roleId: string): string {
  // 安全化文件名：替换特殊字符
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getDataDir(), `${safeUserId}_${roleId}.json`);
}

/**
 * 加载某用户在某人格下的长期理解档案
 */
export function loadProfile(userId: string, roleId: string): LTUProfile {
  const filePath = getProfilePath(userId, roleId);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as LTUProfile;
    // 确保必需字段存在（兼容旧版本文件）
    if (!parsed.recentInputs) parsed.recentInputs = [];
    return parsed;
  } catch {
    return createEmptyProfile(userId, roleId);
  }
}

/**
 * 保存档案
 */
export function saveProfile(profile: LTUProfile): void {
  profile.lastUpdated = Date.now();
  const filePath = getProfilePath(profile.userId, profile.roleId);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════
// Fields 更新 — 追加语义去重
// ═══════════════════════════════════════════════════════════════

function appendUnique(arr: string[], newItem: string, maxLen = 8): string[] {
  if (!newItem || newItem.trim().length < 2) return arr;
  const trimmed = newItem.trim();
  // 语义去重：如果已有相似条目（包含相同子串），不重复添加
  const isDuplicate = arr.some(
    (existing) =>
      existing.includes(trimmed) ||
      trimmed.includes(existing) ||
      similarity(existing, trimmed) > 0.6
  );
  if (isDuplicate) return arr;
  const result = [trimmed, ...arr];
  return result.slice(0, maxLen);
}

/** 简单 Jaccard 相似度（基于字符级） */
function similarity(a: string, b: string): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((c) => setB.has(c)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function appendArrayUnique(arr: string[], newItems: string[], maxLen = 8): string[] {
  let result = [...arr];
  for (const item of newItems) {
    result = appendUnique(result, item, maxLen);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 核心更新逻辑
// ═══════════════════════════════════════════════════════════════

export interface LTUUpdateData {
  userInput: string;
  flowType?: string;
  flowStage?: string;
  emotionTag?: string;
  eventTag?: string;
  state?: string;
  keywords?: string[];
  deepSummary?: string;
  changeBlock?: string;
}

/**
 * 更新用户在某人格下的长期理解档案
 * 每轮 Deep 完成后调用
 */
export function updateProfile(
  userId: string,
  roleId: string,
  data: LTUUpdateData
): LTUProfile {
  const profile = loadProfile(userId, roleId);
  profile.totalInteractions += 1;

  // 1. 更新 recentInputs
  profile.recentInputs = appendUnique(profile.recentInputs, data.userInput, 3);

  // 2. 提取主题关键词
  if (data.keywords && data.keywords.length > 0) {
    for (const kw of data.keywords) {
      profile.dominantThemes = appendUnique(profile.dominantThemes, kw, 8);
    }
  }

  // 3. 记录心理流向模式
  if (data.flowType && data.flowType !== 'general_flow') {
    profile.recurringFlowPatterns = appendUnique(
      profile.recurringFlowPatterns,
      data.flowType,
      8
    );
  }

  // 4. 记录情绪触发点
  if (data.emotionTag && data.emotionTag !== 'general') {
    profile.emotionalTriggers = appendUnique(
      profile.emotionalTriggers,
      data.emotionTag,
      6
    );
  }

  // 5. 更新角色专属理解字段
  const input = data.userInput.toLowerCase();
  const deep = (data.deepSummary || '').toLowerCase();

  switch (roleId) {
    case 'clever-fox': {
      const spec = profile.roleSpecific as { roleId: 'clever-fox'; data: FoxUnderstanding };
      // 认知模式：从用户输入和 Deep 总结中提取模式关键词
      if (data.flowType === 'self_blame' || input.includes('自责') || input.includes('不够好')) {
        spec.data.cognitivePatterns = appendUnique(spec.data.cognitivePatterns, '自我否定倾向', 6);
      }
      if (input.includes('应该') || input.includes('必须') || input.includes('不得不')) {
        spec.data.cognitivePatterns = appendUnique(spec.data.cognitivePatterns, '绝对化要求', 6);
      }
      if (input.includes('总是') || input.includes('从来') || input.includes('每次')) {
        spec.data.recurringDistortions = appendUnique(spec.data.recurringDistortions, '过度概括', 6);
      }
      if (input.includes('做不了') || input.includes('做不到') || input.includes('没法')) {
        spec.data.actionBlockers = appendUnique(spec.data.actionBlockers, '行动困难', 6);
      }
      if (deep.includes('事实') && deep.includes('解释')) {
        spec.data.effectiveReframes = appendUnique(spec.data.effectiveReframes, '事实vs解释区分', 4);
      }
      break;
    }
    case 'warm-bear': {
      const spec = profile.roleSpecific as { roleId: 'warm-bear'; data: BearUnderstanding };
      if (input.includes('累') || input.includes('疲惫') || input.includes('撑不住')) {
        spec.data.exhaustionSignals = appendUnique(spec.data.exhaustionSignals, '耗竭感', 6);
      }
      if (input.includes('受伤') || input.includes('被伤害') || input.includes('委屈')) {
        spec.data.hurtPoints = appendUnique(spec.data.hurtPoints, '受伤感', 6);
      }
      if (input.includes('安全感') || input.includes('害怕') || input.includes('担心')) {
        spec.data.safetyNeeds = appendUnique(spec.data.safetyNeeds, '安全感需求', 6);
      }
      if (deep.includes('休息') || deep.includes('放下') || deep.includes('松')) {
        spec.data.soothingPatterns = appendUnique(spec.data.soothingPatterns, '需要被允许休息', 4);
      }
      break;
    }
    case 'wise-owl': {
      const spec = profile.roleSpecific as { roleId: 'wise-owl'; data: OwlUnderstanding };
      if (data.flowType && profile.recurringFlowPatterns.filter(p => p === data.flowType).length >= 1) {
        spec.data.recurringThemes = appendUnique(spec.data.recurringThemes, `重复流向:${data.flowType}`, 6);
      }
      if (input.includes('小时候') || input.includes('从小') || input.includes('原生')) {
        spec.data.earlyExperienceHints = appendUnique(spec.data.earlyExperienceHints, '早期经验线索', 6);
      }
      if (input.includes('回避') || input.includes('不想面对') || input.includes('逃避')) {
        spec.data.defensePatterns = appendUnique(spec.data.defensePatterns, '回避型防御', 6);
      }
      if (deep.includes('模式') || deep.includes('重复')) {
        spec.data.unconsciousSignals = appendUnique(spec.data.unconsciousSignals, '模式觉察', 4);
      }
      break;
    }
    case 'emotion-elf': {
      const spec = profile.roleSpecific as { roleId: 'emotion-elf'; data: ElfUnderstanding };
      if (input.includes('麻木') || input.includes('没感觉') || input.includes('空')) {
        spec.data.blockedFeelings = appendUnique(spec.data.blockedFeelings, '情绪麻木', 6);
      }
      if (data.emotionTag && data.emotionTag !== 'general') {
        spec.data.emotionalPatterns = appendUnique(spec.data.emotionalPatterns, `情绪基调:${data.emotionTag}`, 6);
      }
      if (input.includes('胸口') || input.includes('肩膀') || input.includes('胃') || input.includes('喘不过')) {
        spec.data.bodySignals = appendUnique(spec.data.bodySignals, '躯体反应', 6);
      }
      if (deep.includes('感受') || deep.includes('感觉')) {
        spec.data.expressionChannels = appendUnique(spec.data.expressionChannels, '感受表达倾向', 4);
      }
      break;
    }
    case 'philosophical-dolphin': {
      const spec = profile.roleSpecific as { roleId: 'philosophical-dolphin'; data: DolphinUnderstanding };
      if (input.includes('意义') || input.includes('为什么') || input.includes('活着')) {
        spec.data.meaningQuestions = appendUnique(spec.data.meaningQuestions, '意义追问', 6);
      }
      if (input.includes('价值') || input.includes('自信') || input.includes('觉得自己')) {
        spec.data.valueConflicts = appendUnique(spec.data.valueConflicts, '自我价值冲突', 6);
      }
      if (input.includes('选择') || input.includes('决定') || input.includes('自由')) {
        spec.data.freedomFears = appendUnique(spec.data.freedomFears, '选择焦虑', 6);
      }
      if (deep.includes('意义') || deep.includes('价值') || deep.includes('存在')) {
        spec.data.existentialThemes = appendUnique(spec.data.existentialThemes, '存在性议题', 4);
      }
      break;
    }
    case 'family-elephant': {
      const spec = profile.roleSpecific as { roleId: 'family-elephant'; data: ElephantUnderstanding };
      if (input.includes('关系') || input.includes('他们') || input.includes('别人')) {
        spec.data.relationshipPatterns = appendUnique(spec.data.relationshipPatterns, '关系关注', 6);
      }
      if (input.includes('家人') || input.includes('父母') || input.includes('家里') || input.includes('家庭')) {
        spec.data.familyRoles = appendUnique(spec.data.familyRoles, '家庭角色议题', 6);
      }
      if (input.includes('边界') || input.includes('拒绝') || input.includes('说不')) {
        spec.data.boundaryIssues = appendUnique(spec.data.boundaryIssues, '边界议题', 6);
      }
      if (input.includes('孤独') || input.includes('一个人') || input.includes('没人')) {
        spec.data.connectionNeeds = appendUnique(spec.data.connectionNeeds, '连接需求', 6);
      }
      break;
    }
  }

  // 6. 偏好学习（简单版本）
  // 如果用户多次使用同一个人格 → 可能偏好这种陪伴方式
  // 这里不做复杂分析，仅根据 flowType 和 response 记录基本倾向

  saveProfile(profile);
  return profile;
}

// ═══════════════════════════════════════════════════════════════
// 摘要生成 — 注入 Deep Prompt 时使用（200~300 字）
// ═══════════════════════════════════════════════════════════════

/**
 * 生成简洁的长期理解摘要，注入 Deep Prompt
 * 不超过 300 字
 */
export function generateLTUSummary(profile: LTUProfile): string {
  if (profile.totalInteractions < 1) return '';
  if (profile.totalInteractions === 1) {
    // 仅一轮对话，不做总结
    return '';
  }

  const lines: string[] = [];
  lines.push(`===== Long-Term Understanding =====`);
  lines.push(`该用户在你这里累计 ${profile.totalInteractions} 次互动。`);

  if (profile.dominantThemes.length > 0) {
    lines.push(`- 常见主题：${profile.dominantThemes.slice(0, 4).join('、')}。`);
  }

  if (profile.recurringFlowPatterns.length > 0) {
    lines.push(`- 常见心理流向：${profile.recurringFlowPatterns.slice(0, 3).join('、')}。`);
  }

  if (profile.emotionalTriggers.length > 0) {
    lines.push(`- 常见触发情绪：${profile.emotionalTriggers.slice(0, 3).join('、')}。`);
  }

  // 角色专属摘要
  const roleLine = generateRoleSpecificLine(profile);
  if (roleLine) lines.push(roleLine);

  if (profile.preferredResponseStyle.dislikes.length > 0) {
    lines.push(`- 用户可能不喜欢的回应方式：${profile.preferredResponseStyle.dislikes.slice(0, 2).join('、')}。`);
  }

  lines.push(`===============================`);

  return lines.join('\n');
}

function generateRoleSpecificLine(profile: LTUProfile): string {
  const spec = profile.roleSpecific;
  switch (spec.roleId) {
    case 'clever-fox': {
      const d = spec.data;
      const items: string[] = [];
      if (d.cognitivePatterns.length > 0) items.push(`认知模式：${d.cognitivePatterns.slice(0, 3).join('、')}`);
      if (d.recurringDistortions.length > 0) items.push(`常见偏差：${d.recurringDistortions.slice(0, 2).join('、')}`);
      if (d.actionBlockers.length > 0) items.push(`行动阻塞：${d.actionBlockers.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    case 'warm-bear': {
      const d = spec.data;
      const items: string[] = [];
      if (d.hurtPoints.length > 0) items.push(`受伤点：${d.hurtPoints.slice(0, 2).join('、')}`);
      if (d.safetyNeeds.length > 0) items.push(`安全感需求：${d.safetyNeeds.slice(0, 2).join('、')}`);
      if (d.exhaustionSignals.length > 0) items.push(`耗竭信号：${d.exhaustionSignals.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    case 'wise-owl': {
      const d = spec.data;
      const items: string[] = [];
      if (d.recurringThemes.length > 0) items.push(`重复主题：${d.recurringThemes.slice(0, 2).join('、')}`);
      if (d.defensePatterns.length > 0) items.push(`防御模式：${d.defensePatterns.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    case 'emotion-elf': {
      const d = spec.data;
      const items: string[] = [];
      if (d.emotionalPatterns.length > 0) items.push(`情绪基调：${d.emotionalPatterns.slice(0, 2).join('、')}`);
      if (d.blockedFeelings.length > 0) items.push(`阻隔感受：${d.blockedFeelings.slice(0, 2).join('、')}`);
      if (d.bodySignals.length > 0) items.push(`躯体信号：${d.bodySignals.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    case 'philosophical-dolphin': {
      const d = spec.data;
      const items: string[] = [];
      if (d.meaningQuestions.length > 0) items.push(`意义追问：${d.meaningQuestions.slice(0, 2).join('、')}`);
      if (d.valueConflicts.length > 0) items.push(`价值冲突：${d.valueConflicts.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    case 'family-elephant': {
      const d = spec.data;
      const items: string[] = [];
      if (d.relationshipPatterns.length > 0) items.push(`关系模式：${d.relationshipPatterns.slice(0, 2).join('、')}`);
      if (d.connectionNeeds.length > 0) items.push(`连接需求：${d.connectionNeeds.slice(0, 2).join('、')}`);
      if (d.boundaryIssues.length > 0) items.push(`边界议题：${d.boundaryIssues.slice(0, 2).join('、')}`);
      return items.length > 0 ? `- 你的观察：${items.join('；')}。` : '';
    }
    default:
      return '';
  }
}