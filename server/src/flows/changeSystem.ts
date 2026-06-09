// ═══════════════════════════════════════════════════════════════
// EmotionFlow Phase 5 — Change System（用户变化感知系统）
// 监测用户在长期对话中的心理演化
// 独立模块，不依赖现有系统
// ═══════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import type {
  FlowResult,
  ChangeSnapshot,
  ChangeVector,
  FlowPatternDelta,
  ChangeHistory,
} from './flowTypes';

// ─── 持久化路径 ─────────────────────────────────────────

const CHANGE_DATA_DIR = path.resolve(process.cwd(), 'auto', 'data');
const CHANGE_DATA_FILE = path.join(CHANGE_DATA_DIR, 'userChangeData.json');

// ─── 内存缓存 ───────────────────────────────────────────

interface ChangeDataEntry {
  history: ChangeHistory;
  /** 上一轮的完整 FlowResult（用于计算本轮的 ChangeSnapshot） */
  lastFlowResult: FlowResult | null;
}

const changeDataCache = new Map<string, ChangeDataEntry>();

function getChangeKey(userId: string, roleId: string): string {
  return `${userId}::${roleId}`;
}

// ─── 持久化 ─────────────────────────────────────────────

function ensureDir(): void {
  if (!fs.existsSync(CHANGE_DATA_DIR)) {
    fs.mkdirSync(CHANGE_DATA_DIR, { recursive: true });
  }
}

function loadAllChangeData(): Map<string, ChangeDataEntry> {
  try {
    ensureDir();
    if (fs.existsSync(CHANGE_DATA_FILE)) {
      const raw = fs.readFileSync(CHANGE_DATA_FILE, 'utf-8');
      const parsed: Record<string, { history: ChangeHistory; lastFlowResult: FlowResult | null }> = JSON.parse(raw);
      const map = new Map<string, ChangeDataEntry>();
      const keys = Object.keys(parsed);
      for (let i = 0; i < keys.length; i++) {
        map.set(keys[i], parsed[keys[i]]);
      }
      console.log(`[Change] 已加载 ${map.size} 个用户变化档案`);
      return map;
    }
  } catch (err) {
    console.error(`[Change] 加载用户变化档案失败:`, err);
  }
  return new Map();
}

function saveAllChangeData(data: Map<string, ChangeDataEntry>): void {
  try {
    ensureDir();
    const obj: Record<string, ChangeDataEntry> = {};
    const keys = Array.from(data.keys());
    for (let i = 0; i < keys.length; i++) {
      obj[keys[i]] = data.get(keys[i])!;
    }
    fs.writeFileSync(CHANGE_DATA_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Change] 保存用户变化档案失败:`, err);
  }
}

// ─── 初始化加载 ─────────────────────────────────────────

// 启动时一次性加载
(function init() {
  const loaded = loadAllChangeData();
  const keys = Array.from(loaded.keys());
  for (let i = 0; i < keys.length; i++) {
    changeDataCache.set(keys[i], loaded.get(keys[i])!);
  }
})();

// ─── 核心函数 ───────────────────────────────────────────

/**
 * 分析两轮 FlowResult 之间的变化，生成 ChangeSnapshot
 *
 * @param previous 上一轮的 FlowResult（可为 null，首次调用时）
 * @param current  当前轮的 FlowResult
 * @returns ChangeSnapshot
 */
export function analyzeChange(
  previous: FlowResult | null,
  current: FlowResult
): ChangeSnapshot {
  const positionDelta: ChangeVector = {
    cognitionDelta: previous
      ? +(current.position.cognition - previous.position.cognition).toFixed(2)
      : 0,
    attributionDelta: previous
      ? +(current.position.attribution - previous.position.attribution).toFixed(2)
      : 0,
    agencyDelta: previous
      ? +(current.position.agency - previous.position.agency).toFixed(2)
      : 0,
    abstractionDelta: previous
      ? +(current.position.abstraction - previous.position.abstraction).toFixed(2)
      : 0,
  };

  const patternDelta: FlowPatternDelta = {
    flowTypePrevious: previous?.primaryFlow?.flowType || null,
    flowTypeCurrent: current.primaryFlow?.flowType || null,
    directionChange: determineDirectionChange(previous, current),
  };

  return {
    timestamp: Date.now(),
    positionDelta,
    patternDelta,
    confidence: current.primaryFlow?.confidence || 0,
    strength: current.primaryFlow?.strength || 0,
    status: current.status,
    position: { ...current.position },
  };
}

/**
 * 判断流向变化方向
 */
function determineDirectionChange(
  previous: FlowResult | null,
  current: FlowResult
): '保持' | '深化' | '转移' | '首次' {
  if (!previous) return '首次';

  const prevType = previous.primaryFlow?.flowType;
  const currType = current.primaryFlow?.flowType;

  if (!prevType && currType) return '首次';
  if (prevType && !currType) return '转移';
  if (!prevType && !currType) return '保持';
  if (prevType === currType) {
    // 同一流向：检查抽象层是否升高
    const absDelta =
      current.position.abstraction - previous.position.abstraction;
    if (absDelta >= 1) return '深化';
    return '保持';
  }
  return '转移';
}

/**
 * 计算最近 N 轮的累积趋势
 *
 * @param snapshots 变化快照列表（从旧到新）
 * @param windowSize 窗口大小，默认 20
 * @returns 趋势分析对象
 */
export function computeTrends(
  snapshots: ChangeSnapshot[],
  windowSize = 20
): ChangeHistory['trendAnalysis'] {
  if (snapshots.length === 0) return undefined;

  // 取最近 windowSize 个
  const recent = snapshots.slice(-windowSize);
  if (recent.length < 2) return undefined;

  // 各轴平均变化方向
  const avgCog = recent.reduce((s, p) => s + p.positionDelta.cognitionDelta, 0) / recent.length;
  const avgAtt = recent.reduce((s, p) => s + p.positionDelta.attributionDelta, 0) / recent.length;
  const avgAge = recent.reduce((s, p) => s + p.positionDelta.agencyDelta, 0) / recent.length;
  const avgAbs = recent.reduce((s, p) => s + p.positionDelta.abstractionDelta, 0) / recent.length;

  // 对比前后两半
  const halfIdx = Math.floor(recent.length / 2);
  const early = recent.slice(0, halfIdx);
  const late = recent.slice(halfIdx);

  const earlyAtt = early.reduce((s, p) => s + p.position.attribution, 0) / early.length;
  const lateAtt = late.reduce((s, p) => s + p.position.attribution, 0) / late.length;
  const earlyAge = early.reduce((s, p) => s + p.position.agency, 0) / early.length;
  const lateAge = late.reduce((s, p) => s + p.position.agency, 0) / late.length;
  const earlyAbs = early.reduce((s, p) => s + p.position.abstraction, 0) / early.length;
  const lateAbs = late.reduce((s, p) => s + p.position.abstraction, 0) / late.length;

  // 自我责备变化（负归因→0或正归因 = 改善）
  const selfBlameChange = +(lateAtt - earlyAtt).toFixed(2);
  // 行动力变化（从无力→掌控 = 改善）
  const agencyChange = +(lateAge - earlyAge).toFixed(2);
  // 模式觉察变化（抽象层升高 = 改善）
  const reflectionChange = +(lateAbs - earlyAbs).toFixed(2);

  // 流向深化度：最近 N 轮中抽象层净变化
  const flowDepthTrend = +(avgAbs * recent.length).toFixed(1);

  return {
    attributionTrend: +avgAtt.toFixed(3),
    agencyTrend: +avgAge.toFixed(3),
    abstractionTrend: +avgAbs.toFixed(3),
    cognitionTrend: +avgCog.toFixed(3),
    flowDepthTrend,
    selfBlameChange,
    agencyChange,
    reflectionChange,
  };
}

/**
 * 格式化 Change 信息为 Deep Prompt 可注入的文本块
 *
 * @param history 用户变化档案
 * @param compact 是否使用紧凑格式（默认true）
 * @returns 格式化文本
 */
export function formatChangeBlock(
  history: ChangeHistory | null
): string {
  if (!history || history.snapshots.length < 3) return '';

  const trends = history.trendAnalysis;
  if (!trends) return '';

  const lines: string[] = [];
  lines.push('===== Change System =====');

  // 变化趋势概览
  const sb = trends.selfBlameChange;
  const ac = trends.agencyChange;
  const rc = trends.reflectionChange;

  lines.push('[趋势]');
  if (sb < -0.1) lines.push(`  自责倾向: ↑ (加重 ${Math.abs(sb).toFixed(2)})`);
  else if (sb > 0.1) lines.push(`  自责倾向: ↓ (减轻 ${sb.toFixed(2)})`);
  else lines.push(`  自责倾向: 稳定 (${sb.toFixed(2)})`);

  if (ac > 0.1) lines.push(`  行动感: ↑ (提升 ${ac.toFixed(2)})`);
  else if (ac < -0.1) lines.push(`  行动感: ↓ (减弱 ${Math.abs(ac).toFixed(2)})`);
  else lines.push(`  行动感: 稳定 (${ac.toFixed(2)})`);

  if (rc > 0.3) lines.push(`  模式觉察: ↑ (显著提升 ${rc.toFixed(2)})`);
  else if (rc > 0.1) lines.push(`  模式觉察: ↑ (提升 ${rc.toFixed(2)})`);
  else if (rc < -0.1) lines.push(`  模式觉察: ↓ (减弱 ${Math.abs(rc).toFixed(2)})`);
  else lines.push(`  模式觉察: 稳定 (${rc.toFixed(2)})`);

  // 最近两次的变化
  const recentSnapshots = history.snapshots.slice(-2);
  if (recentSnapshots.length >= 2) {
    const latest = recentSnapshots[recentSnapshots.length - 1];
    lines.push('[最新变化]');
    lines.push(`  本轮: ${latest.patternDelta.directionChange}`);
    if (latest.patternDelta.flowTypeCurrent) {
      lines.push(`  当前流向: ${latest.patternDelta.flowTypeCurrent}`);
    }
  }

  // 最近出现的新能力（基于模式觉察变化）
  if (rc > 0.3 && recentSnapshots.length >= 2) {
    const latestAbs = recentSnapshots[recentSnapshots.length - 1].position.abstraction;
    if (latestAbs >= 3) {
      lines.push('[新能力]');
      lines.push('  开始区分事实和解释');
    }
  }

  lines.push('========================');
  return '\n' + lines.join('\n') + '\n';
}

// ─── 用户数据管理 ───────────────────────────────────────

/**
 * 获取或创建用户变化档案
 */
export function getOrCreateChangeHistory(
  userId: string,
  roleId: string
): { history: ChangeHistory; lastFlowResult: FlowResult | null } {
  const key = getChangeKey(userId, roleId);

  if (changeDataCache.has(key)) {
    const entry = changeDataCache.get(key)!;
    return { history: entry.history, lastFlowResult: entry.lastFlowResult };
  }

  // 创建新档案
  const history: ChangeHistory = {
    userId,
    roleId,
    snapshots: [],
    updatedAt: Date.now(),
  };

  const entry: ChangeDataEntry = { history, lastFlowResult: null };
  changeDataCache.set(key, entry);

  return { history, lastFlowResult: null };
}

/**
 * 记录一轮变化：分析 FlowResult 变化并追加到档案
 *
 * @param userId 用户标识
 * @param roleId 人格标识
 * @param currentFlow 当前轮的 FlowResult
 * @returns 生成的 ChangeSnapshot（如为首次调用则返回 null）
 */
export function recordChange(
  userId: string,
  roleId: string,
  currentFlow: FlowResult
): ChangeSnapshot | null {
  const entry = getOrCreateChangeHistory(userId, roleId);
  const previous = entry.lastFlowResult;

  if (!previous) {
    // 首次调用，只存不分析
    const key = getChangeKey(userId, roleId);
    const cache = changeDataCache.get(key)!;
    cache.lastFlowResult = currentFlow;
    saveAllChangeData(changeDataCache);
    return null;
  }

  // 生成变化快照
  const snapshot = analyzeChange(previous, currentFlow);

  // 追加到历史
  const key = getChangeKey(userId, roleId);
  const cache = changeDataCache.get(key)!;
  cache.history.snapshots.push(snapshot);

  // 保留最近50轮
  if (cache.history.snapshots.length > 50) {
    cache.history.snapshots = cache.history.snapshots.slice(-50);
  }

  // 更新趋势分析
  cache.history.trendAnalysis = computeTrends(cache.history.snapshots);
  cache.history.updatedAt = Date.now();

  // 更新上一轮 FlowResult
  cache.lastFlowResult = currentFlow;

  // 持久化
  saveAllChangeData(changeDataCache);

  return snapshot;
}

/**
 * 获取用户变化档案的格式化文本（用于 Deep Prompt 注入）
 */
export function getChangeBlock(userId: string, roleId: string): string {
  const entry = getOrCreateChangeHistory(userId, roleId);
  return formatChangeBlock(entry.history);
}

// ─── 单元测试辅助 ───────────────────────────────────────

/**
 * 重置用户变化档案（用于测试）
 */
export function resetChangeHistory(userId: string, roleId: string): void {
  const key = getChangeKey(userId, roleId);
  changeDataCache.delete(key);
}

/**
 * 清除所有变化档案（用于测试）
 */
export function resetAllChangeHistory(): void {
  changeDataCache.clear();
  // 清空文件
  try {
    if (fs.existsSync(CHANGE_DATA_FILE)) {
      fs.writeFileSync(CHANGE_DATA_FILE, '{}', 'utf-8');
    }
  } catch {}
}

/**
 * 加载所有离线变化档案（用于测试时检查已保存数据）
 */
export function loadChangeHistoryFromFile(userId: string, roleId: string): ChangeHistory | null {
  const map = loadAllChangeData();
  const key = getChangeKey(userId, roleId);
  const entry = map.get(key);
  return entry?.history || null;
}