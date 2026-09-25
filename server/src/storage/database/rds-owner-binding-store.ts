import {
  createConversationOwnerBinding,
  findConversationOwner,
  hasRegisteredIdentityDb,
  registerRuntimeIdentityDb,
  revokeConversationOwnerBinding,
  verifyConversationOwner,
} from './identity-db';

/** EF-235 protected owner-binding boundary. */
export type OwnerBindingResult = 'owned' | 'missing' | 'internal';

export interface RdsOwnerBindingStore {
  createBinding(conversationRef: string, ownerPrincipalId: string): Promise<void>;
  hasExactOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
  revokeBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
}

let compatibilityStore: RdsOwnerBindingStore | undefined;

/** Compatibility adapter retained for existing isolated ownership tests. */
export function registerProtectedOwnerBindingStore(store: RdsOwnerBindingStore): void {
  compatibilityStore = store;
}

export function registerRuntimeOwnerBindingStore(): boolean {
  const registered = registerRuntimeIdentityDb();
  if (registered) compatibilityStore = undefined;
  return registered;
}

export function hasRegisteredOwnerBindingStore(): boolean {
  return compatibilityStore !== undefined || hasRegisteredIdentityDb();
}

export async function createOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<void> {
  if (compatibilityStore) {
    await compatibilityStore.createBinding(conversationRef, ownerPrincipalId);
    return;
  }
  await createConversationOwnerBinding(conversationRef, ownerPrincipalId);
}

export async function findOwnerBinding(
  conversationRef: string,
): Promise<string | null> {
  return findConversationOwner(conversationRef);
}

export async function verifyExactOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<OwnerBindingResult> {
  try {
    if (compatibilityStore) {
      return await compatibilityStore.hasExactOwnerBinding(conversationRef, ownerPrincipalId)
        ? 'owned'
        : 'missing';
    }
    return await verifyConversationOwner(conversationRef, ownerPrincipalId)
      ? 'owned'
      : 'missing';
  } catch {
    return 'internal';
  }
}

export async function revokeOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<OwnerBindingResult> {
  try {
    if (compatibilityStore) {
      return await compatibilityStore.revokeBinding(conversationRef, ownerPrincipalId)
        ? 'owned'
        : 'missing';
    }
    return await revokeConversationOwnerBinding(conversationRef, ownerPrincipalId)
      ? 'owned'
      : 'missing';
  } catch {
    return 'internal';
  }
}
