/**
 * Protected owner-binding workload registration.
 *
 * This boundary uses the existing server database client and the private
 * owner-binding table only. Client-derived identities never enter here: the
 * route layer passes the verified, server-issued owner principal.
 */
import { registerProtectedOwnerBindingStore } from './rds-owner-binding-store';
import { getSupabaseClient } from './supabase-client';

let registered = false;

export function registerProtectedOwnerBindingWorkload(): void {
  if (registered) return;

  registerProtectedOwnerBindingStore({
    async createBinding(conversationRef, ownerPrincipalId): Promise<void> {
      const { error } = await getSupabaseClient()
        .from('conversation_owner_bindings')
        .insert({
          conversation_ref: conversationRef,
          owner_principal_id: ownerPrincipalId,
          created_at: Date.now(),
          revoked_at: null,
        });
      if (error) throw error;
    },

    async hasExactOwnerBinding(conversationRef, ownerPrincipalId): Promise<boolean> {
      const { data, error } = await getSupabaseClient()
        .from('conversation_owner_bindings')
        .select('conversation_ref')
        .eq('conversation_ref', conversationRef)
        .eq('owner_principal_id', ownerPrincipalId)
        .is('revoked_at', null)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async revokeBinding(conversationRef, ownerPrincipalId): Promise<boolean> {
      const { data, error } = await getSupabaseClient()
        .from('conversation_owner_bindings')
        .update({ revoked_at: Date.now() })
        .eq('conversation_ref', conversationRef)
        .eq('owner_principal_id', ownerPrincipalId)
        .is('revoked_at', null)
        .select('conversation_ref')
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },
  });

  registered = true;
}
