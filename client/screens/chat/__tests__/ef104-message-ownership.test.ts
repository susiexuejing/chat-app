import type { ChatMessage } from '../types';
import {
  appendOwnedResponseContent,
  createResponseMessage,
  updateOwnedResponseMessage,
} from '../utils/messageOwnership';

describe('EF-104 message ownership helpers', () => {
  const turn1 = 'turn_synthetic_1';
  const turn2 = 'turn_synthetic_2';

  test('inserts a late Turn1 Deep entity before Turn2 without mutating Turn2', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'U1', timestamp: 1, turnId: turn1 },
      createResponseMessage({ turnId: turn1, responseLayer: 'reaction', messageId: 'r1' }, 'R1', 2),
      createResponseMessage({ turnId: turn1, responseLayer: 'companion', messageId: 'c1' }, 'C1', 3),
      { id: 'u2', role: 'user', content: 'U2', timestamp: 4, turnId: turn2 },
      createResponseMessage({ turnId: turn2, responseLayer: 'reaction', messageId: 'r2' }, 'R2', 5),
    ];
    const turn2Before = messages.filter(message => message.turnId === turn2);

    const updated = appendOwnedResponseContent(
      messages,
      { turnId: turn1, responseLayer: 'deep', messageId: 'd1' },
      'D1',
      { createIfMissing: true, timestamp: 6 },
    );

    expect(updated.map(message => message.id)).toEqual(['u1', 'r1', 'c1', 'd1', 'u2', 'r2']);
    expect(updated.filter(message => message.turnId === turn2)).toEqual(turn2Before);
  });

  test('rejects a callback whose message id is owned by another Turn or layer', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'U1', timestamp: 1, turnId: turn1 },
      createResponseMessage({ turnId: turn1, responseLayer: 'deep', messageId: 'shared' }, 'D1', 2),
      { id: 'u2', role: 'user', content: 'U2', timestamp: 3, turnId: turn2 },
    ];

    expect(updateOwnedResponseMessage(
      messages,
      { turnId: turn2, responseLayer: 'reaction', messageId: 'shared' },
      'corrupt write',
      { createIfMissing: true },
    )).toBe(messages);
  });

  test('legacy entities remain readable without invented ownership', () => {
    const legacy: ChatMessage = {
      id: 'legacy-assistant',
      role: 'assistant',
      content: 'Legacy content',
      timestamp: 1,
    };
    const roundTrip = JSON.parse(JSON.stringify(legacy)) as ChatMessage;

    expect(roundTrip).toEqual(legacy);
    expect(roundTrip.turnId).toBeUndefined();
    expect(roundTrip.responseLayer).toBeUndefined();
  });
});
