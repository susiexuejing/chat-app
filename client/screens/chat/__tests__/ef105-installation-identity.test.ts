import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  INSTALLATION_IDENTITY_STORAGE_KEY,
  attachCanonicalConversation,
  getOrCreateInstallationIdentity,
  prepareCanonicalConversation,
} from '../stores/installationIdentity';
import type { ChatSession } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
const firstUserId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';
const canonicalA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const canonicalB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session_local_1',
    roleId: 'clever-fox',
    messages: [{ id: 'legacy-message', role: 'user', content: 'preserved', timestamp: 1 }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('EF-105 installation identity', () => {
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: jest.fn(() => firstUserId) },
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
  });

  it('creates and durably stores one versioned UUIDv4 on first install', async () => {
    const identity = await getOrCreateInstallationIdentity();
    expect(identity).toEqual({ schemaVersion: 1, userId: firstUserId });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      JSON.stringify(identity),
    );
  });

  it('reuses the stored userId after reopen without creating another one', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      userId: firstUserId,
    }));
    expect(await getOrCreateInstallationIdentity()).toEqual({ schemaVersion: 1, userId: firstUserId });
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(['{broken', JSON.stringify({ schemaVersion: 1, userId: 'not-a-uuid' })])(
    'replaces only a corrupt identity record: %s',
    async raw => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
      (globalThis.crypto.randomUUID as jest.Mock).mockReturnValue(secondUserId);
      expect(await getOrCreateInstallationIdentity()).toEqual({ schemaVersion: 1, userId: secondUserId });
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    },
  );

  it('does not return an unstable in-memory identity when its write fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    await expect(getOrCreateInstallationIdentity()).rejects.toThrow('storage unavailable');
  });

  it('single-flights concurrent callers for a missing identity record', async () => {
    const callers = Array.from({ length: 5 }, () => getOrCreateInstallationIdentity());
    const identities = await Promise.all(callers);
    expect(identities.every(identity => identity === identities[0])).toBe(true);
    expect(identities.map(identity => identity.userId)).toEqual(Array(5).fill(firstUserId));
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('single-flights corrupt-record replacement without touching session storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{broken');
    (globalThis.crypto.randomUUID as jest.Mock).mockReturnValue(secondUserId);
    const identities = await Promise.all(
      Array.from({ length: 4 }, () => getOrCreateInstallationIdentity()),
    );
    expect(identities.every(identity => identity === identities[0])).toBe(true);
    expect(identities.map(identity => identity.userId)).toEqual(Array(4).fill(secondUserId));
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      JSON.stringify(identities[0]),
    );
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects all concurrent callers on write failure and permits a later retry', async () => {
    (globalThis.crypto.randomUUID as jest.Mock)
      .mockReturnValueOnce(firstUserId)
      .mockReturnValueOnce(secondUserId);
    (AsyncStorage.setItem as jest.Mock)
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);

    const failed = await Promise.allSettled(
      Array.from({ length: 3 }, () => getOrCreateInstallationIdentity()),
    );
    expect(failed).toHaveLength(3);
    expect(failed.every(result => result.status === 'rejected')).toBe(true);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);

    const retried = await getOrCreateInstallationIdentity();
    expect(retried).toEqual({ schemaVersion: 1, userId: secondUserId });
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      JSON.stringify(retried),
    );
  });
});

describe('EF-105 canonical conversation compatibility', () => {
  it.each([undefined, 'conv_legacy_value'])(
    'preserves legacy content and attaches a canonical mapping for %s',
    legacyConversationId => {
      const original = session({ conversationId: legacyConversationId });
      const [mapped] = attachCanonicalConversation([original], original.id, canonicalA, firstUserId);
      expect(mapped.conversationId).toBe(canonicalA);
      expect(mapped.canonicalConversationUserId).toBe(firstUserId);
      expect(mapped.legacyConversationId).toBe(legacyConversationId);
      expect(mapped.messages).toEqual(original.messages);
      expect(original.conversationId).toBe(legacyConversationId);
    },
  );

  it('reuses a canonical UUID only when it is correlated to the current installation', async () => {
    const correlated = session({
      conversationId: canonicalA,
      canonicalConversationUserId: firstUserId,
    });
    const createConversation = jest.fn();
    const persistMapping = jest.fn();
    const prepared = await prepareCanonicalConversation({
      sessions: [correlated], clientSessionId: correlated.id, roleId: correlated.roleId,
      userId: firstUserId, createConversation, persistMapping,
    });
    expect(prepared.conversationId).toBe(canonicalA);
    expect(createConversation).not.toHaveBeenCalled();
    expect(persistMapping).not.toHaveBeenCalled();
  });

  it.each([
    ['regenerated identity', { conversationId: canonicalA, canonicalConversationUserId: secondUserId }],
    ['pre-EF-105 UUID', { conversationId: canonicalA }],
    ['provisional ID', { conversationId: 'conv_legacy_value' }],
  ])('creates a fresh mapping for %s without changing messages', async (_label, mapping) => {
    const original = session(mapping);
    const persistMapping = jest.fn(async () => undefined);
    const prepared = await prepareCanonicalConversation({
      sessions: [original], clientSessionId: original.id, roleId: original.roleId,
      userId: firstUserId, createConversation: async () => ({ id: canonicalB }), persistMapping,
    });
    expect(prepared.conversationId).toBe(canonicalB);
    expect(prepared.sessions[0]).toMatchObject({
      conversationId: canonicalB,
      canonicalConversationUserId: firstUserId,
      legacyConversationId: mapping.conversationId,
      messages: original.messages,
    });
    expect(original.conversationId).toBe(mapping.conversationId);
    expect(persistMapping).toHaveBeenCalledTimes(1);
  });

  it('orders canonical creation before mapping persistence and gives new chats distinct IDs', async () => {
    const calls: string[] = [];
    const createConversation = jest.fn()
      .mockImplementationOnce(async () => { calls.push('create-a'); return { id: canonicalA }; })
      .mockImplementationOnce(async () => { calls.push('create-b'); return { id: canonicalB }; });
    const persistMapping = jest.fn(async () => { calls.push('persist'); });

    const first = await prepareCanonicalConversation({
      sessions: [session()], clientSessionId: 'session_local_1', roleId: 'clever-fox',
      userId: firstUserId, createConversation, persistMapping,
    });
    calls.push('chatStart-a');
    const second = await prepareCanonicalConversation({
      sessions: [session({ id: 'session_local_2' })], clientSessionId: 'session_local_2', roleId: 'clever-fox',
      userId: firstUserId, createConversation, persistMapping,
    });
    calls.push('chatStart-b');

    expect(calls).toEqual([
      'create-a', 'persist', 'chatStart-a',
      'create-b', 'persist', 'chatStart-b',
    ]);
    expect(first.conversationId).not.toBe(second.conversationId);
    expect(createConversation).toHaveBeenNthCalledWith(1, firstUserId, 'clever-fox');
    expect(createConversation).toHaveBeenNthCalledWith(2, firstUserId, 'clever-fox');
  });

  it('stops before continuation when canonical creation or mapping persistence fails', async () => {
    const continueToChatStart = jest.fn();
    const createFailure = prepareCanonicalConversation({
      sessions: [session()], clientSessionId: 'session_local_1', roleId: 'clever-fox',
      userId: firstUserId, createConversation: async () => null, persistMapping: jest.fn(),
    }).then(continueToChatStart);
    await expect(createFailure).rejects.toThrow('Canonical conversation creation failed');

    const original = session({ conversationId: 'conv_legacy_value' });
    const mappingFailure = prepareCanonicalConversation({
      sessions: [original], clientSessionId: original.id, roleId: original.roleId,
      userId: firstUserId, createConversation: async () => ({ id: canonicalA }),
      persistMapping: async () => { throw new Error('mapping write failed'); },
    }).then(continueToChatStart);
    await expect(mappingFailure).rejects.toThrow('mapping write failed');
    expect(continueToChatStart).not.toHaveBeenCalled();
    expect(original.conversationId).toBe('conv_legacy_value');
    expect(original.messages).toHaveLength(1);
  });
});
