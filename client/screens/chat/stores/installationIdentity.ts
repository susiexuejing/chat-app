import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatSession } from '../types';

export const INSTALLATION_IDENTITY_STORAGE_KEY = 'emotionflow.installation_identity.v1';
export const INSTALLATION_IDENTITY_SCHEMA_VERSION = 1;

export interface InstallationIdentity {
  schemaVersion: typeof INSTALLATION_IDENTITY_SCHEMA_VERSION;
  userId: string;
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export function isInstallationIdentity(value: unknown): value is InstallationIdentity {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === INSTALLATION_IDENTITY_SCHEMA_VERSION
    && isUuidV4(record.userId);
}

async function generateUuidV4(): Promise<string> {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const expoCrypto = await import('expo-crypto');
  return expoCrypto.randomUUID();
}

export async function getOrCreateInstallationIdentity(): Promise<InstallationIdentity> {
  const raw = await AsyncStorage.getItem(INSTALLATION_IDENTITY_STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isInstallationIdentity(parsed)) return parsed;
    } catch {
      // Replace only this dedicated identity record below. Session data is separate.
    }
  }

  const identity: InstallationIdentity = {
    schemaVersion: INSTALLATION_IDENTITY_SCHEMA_VERSION,
    userId: await generateUuidV4(),
  };
  await AsyncStorage.setItem(INSTALLATION_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function attachCanonicalConversation(
  sessions: ChatSession[],
  clientSessionId: string,
  conversationId: string,
  userId: string,
): ChatSession[] {
  if (!isUuidV4(conversationId) || !isUuidV4(userId)) {
    throw new Error('Canonical conversation creation returned an invalid identifier');
  }

  let found = false;
  const next = sessions.map(session => {
    if (session.id !== clientSessionId) return session;
    found = true;
    const legacyConversationId = session.conversationId !== conversationId
      ? session.conversationId ?? session.legacyConversationId
      : session.legacyConversationId;
    return {
      ...session,
      conversationId,
      canonicalConversationUserId: userId,
      legacyConversationId,
      pendingTurn: session.pendingTurn
        ? { ...session.pendingTurn, conversationId }
        : session.pendingTurn,
      updatedAt: Date.now(),
    };
  });

  if (!found) throw new Error('Client session is unavailable for canonical mapping');
  return next;
}

export function hasProvenCanonicalConversation(
  session: Pick<ChatSession, 'conversationId' | 'canonicalConversationUserId'> | undefined,
  userId: string,
): session is ChatSession & { conversationId: string; canonicalConversationUserId: string } {
  return isUuidV4(userId)
    && isUuidV4(session?.conversationId)
    && isUuidV4(session.canonicalConversationUserId)
    && session.canonicalConversationUserId === userId;
}

export async function prepareCanonicalConversation(args: {
  sessions: ChatSession[];
  clientSessionId: string;
  roleId: string;
  userId: string;
  createConversation: (userId: string, roleId: string) => Promise<{ id: string } | null>;
  persistMapping: (sessions: ChatSession[]) => Promise<void>;
}): Promise<{ conversationId: string; sessions: ChatSession[] }> {
  const existing = args.sessions.find(session => session.id === args.clientSessionId);
  if (hasProvenCanonicalConversation(existing, args.userId)) {
    return { conversationId: existing.conversationId, sessions: args.sessions };
  }

  const created = await args.createConversation(args.userId, args.roleId);
  if (!created || !isUuidV4(created.id)) {
    throw new Error('Canonical conversation creation failed');
  }
  const mapped = attachCanonicalConversation(args.sessions, args.clientSessionId, created.id, args.userId);
  await args.persistMapping(mapped);
  return { conversationId: created.id, sessions: mapped };
}
