/**
 * EM-43: 会话轮数计算模块
 *
 * 负责维护每个 conversationId 的用户消息轮数计数。
 * 用于控制前两轮高优先级规则的注入。
 */

// 轮数数据结构
interface ConversationTurnData {
  turnCount: number;
  lastAccessed: number;
}

// 存储所有会话的轮数数据
const conversationTurns = new Map<string, ConversationTurnData>();

// TTL 配置：30 分钟
const CONVERSATION_TTL_MS = 30 * 60 * 1000;

// 清理间隔：每分钟
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * 获取指定 conversationId 的当前轮数
 * @param conversationId 会话 ID
 * @returns 当前轮数，如果不存在或已过期则返回 0
 */
export function getConversationTurn(conversationId: string): number {
  const data = conversationTurns.get(conversationId);

  if (!data) {
    return 0;
  }

  // 检查是否已过期
  const now = Date.now();
  if (now - data.lastAccessed > CONVERSATION_TTL_MS) {
    // 已过期，删除并返回 0
    conversationTurns.delete(conversationId);
    return 0;
  }

  return data.turnCount;
}

/**
 * 递增指定 conversationId 的轮数
 * @param conversationId 会话 ID
 * @returns 递增后的轮数
 */
export function incrementConversationTurn(conversationId: string): number {
  const now = Date.now();
  const data = conversationTurns.get(conversationId);

  if (!data) {
    // 新会话，从 1 开始
    conversationTurns.set(conversationId, {
      turnCount: 1,
      lastAccessed: now,
    });
    return 1;
  }

  // 检查是否已过期
  if (now - data.lastAccessed > CONVERSATION_TTL_MS) {
    // 已过期，重置为 1
    conversationTurns.set(conversationId, {
      turnCount: 1,
      lastAccessed: now,
    });
    return 1;
  }

  // 递增轮数
  data.turnCount += 1;
  data.lastAccessed = now;
  return data.turnCount;
}

/**
 * 清理过期的会话数据
 * 返回被清理的会话数量
 */
export function cleanupExpiredConversations(): number {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [conversationId, data] of conversationTurns.entries()) {
    if (now - data.lastAccessed > CONVERSATION_TTL_MS) {
      conversationTurns.delete(conversationId);
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * 启动定期清理任务
 * 返回清理任务的 interval ID，可用于停止清理
 */
export function startPeriodicCleanup(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const cleaned = cleanupExpiredConversations();
    if (cleaned > 0) {
      console.log(`[EM-43] Cleaned up ${cleaned} expired conversations`);
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * 获取当前存储的会话数量（用于调试）
 */
export function getConversationCount(): number {
  return conversationTurns.size;
}

/**
 * 重置所有会话数据（仅用于测试）
 */
export function resetAllConversations(): void {
  conversationTurns.clear();
}
