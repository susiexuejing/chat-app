/**
 * EF-164 protected owner-binding boundary.
 *
 * The protected workload bootstrap supplies this store separately.  This
 * module intentionally has no credential, environment, network, or fallback
 * behaviour: an unavailable store fails closed.
 */
export type OwnerBindingResult = 'owned' | 'missing' | 'internal';

export interface RdsOwnerBindingStore {
  createBinding(conversationRef: string, ownerPrincipalId: string): Promise<void>;
  hasExactOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
  revokeBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
}

let protectedStore: RdsOwnerBindingStore | undefined;

/** Called only by protected workload bootstrap code, never by a request. */
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
