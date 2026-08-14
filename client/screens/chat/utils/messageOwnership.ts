import type { ChatMessage, ResponseLayer } from '../types';

export interface ResponseMessageTarget {
  turnId: string;
  responseLayer: ResponseLayer;
  messageId: string;
}

export function generateTurnId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `turn_${Date.now().toString(36)}_${randomPart}`;
}

export function generateResponseMessageId(layer: ResponseLayer): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${layer}_${Date.now().toString(36)}_${randomPart}`;
}

export function createResponseMessage(
  target: ResponseMessageTarget,
  content: string,
  timestamp = Date.now(),
): ChatMessage {
  return {
    id: target.messageId,
    role: 'assistant',
    content,
    timestamp,
    turnId: target.turnId,
    responseLayer: target.responseLayer,
  };
}

/**
 * EF-104 client projection only. The existing backend persistence API still
 * stores one aggregated assistant payload and does not own these local IDs.
 */
export function updateOwnedResponseMessage(
  messages: ChatMessage[],
  target: ResponseMessageTarget,
  content: string,
  options: { createIfMissing?: boolean; timestamp?: number } = {},
): ChatMessage[] {
  const index = messages.findIndex(message =>
    message.id === target.messageId
    && message.role === 'assistant'
    && message.turnId === target.turnId
    && message.responseLayer === target.responseLayer
  );

  if (index < 0) {
    if (!options.createIfMissing) return messages;
    // A message ID already owned by another Turn/layer is a stale or corrupt
    // callback target. Reject it instead of reassigning or duplicating identity.
    if (messages.some(message => message.id === target.messageId)) return messages;

    const created = createResponseMessage(target, content, options.timestamp);
    const targetRank = target.responseLayer === 'reaction'
      ? 1
      : target.responseLayer === 'companion'
        ? 2
        : 3;
    const turnStart = messages.findIndex(message => message.turnId === target.turnId);
    if (turnStart < 0) return messages;

    let insertionIndex = turnStart + 1;
    while (insertionIndex < messages.length) {
      const message = messages[insertionIndex];
      if (message.turnId !== target.turnId) break;
      const rank = message.role === 'user'
        ? 0
        : message.responseLayer === 'reaction'
          ? 1
          : message.responseLayer === 'companion'
            ? 2
            : message.responseLayer === 'deep'
              ? 3
              : 4;
      if (rank > targetRank) break;
      insertionIndex += 1;
    }

    const next = [...messages];
    next.splice(insertionIndex, 0, created);
    return next;
  }

  const next = [...messages];
  next[index] = { ...next[index], content };
  return next;
}

export function appendOwnedResponseContent(
  messages: ChatMessage[],
  target: ResponseMessageTarget,
  content: string,
  options: { createIfMissing?: boolean; timestamp?: number } = {},
): ChatMessage[] {
  const existing = messages.find(message =>
    message.id === target.messageId
    && message.role === 'assistant'
    && message.turnId === target.turnId
    && message.responseLayer === target.responseLayer
  );
  return updateOwnedResponseMessage(
    messages,
    target,
    `${existing?.content ?? ''}${content}`,
    options,
  );
}
