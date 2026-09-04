/**
 * EF-185 private conversation-owner binding boundary.
 *
 * A platform-controlled bootstrap (outside this Candidate) supplies this
 * store from the protected EF-182 workload binding. This module deliberately
 * contains no endpoint, credential, environment lookup, TLS material, or
 * fallback client.
 */
export type OwnerBindingResult = 'owned' | 'missing' | 'internal';

export interface RdsOwnerBindingStore {
  createBinding(conversationRef: string, ownerPrincipalId: string): Promise<void>;
  hasExactOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
  revokeBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
}

let protectedStore: RdsOwnerBindingStore | undefined;

/**
 * Called only by the protected workload bootstrap, never by a browser input.
 * Runtime provisioning of that bootstrap is separately governed by EF-182.
 */
export function registerProtectedOwnerBindingStore(store: RdsOwnerBindingStore): void {
  protectedStore = store;
}

function storeOrThrow(): RdsOwnerBindingStore {
  if (!protectedStore) throw new Error('protected_owner_binding_store_unavailable');
  return protectedStore;
}

export async function createOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<void> {
  await storeOrThrow().createBinding(conversationRef, ownerPrincipalId);
}

export async function verifyExactOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<OwnerBindingResult> {
  try {
    return await storeOrThrow().hasExactOwnerBinding(conversationRef, ownerPrincipalId)
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
    return await storeOrThrow().revokeBinding(conversationRef, ownerPrincipalId)
      ? 'owned'
      : 'missing';
  } catch {
    return 'internal';
  }
}
