/** Fixed, content-free result of the current parser path, NOT semantic truth. */
export const CANDIDATE_DIAGNOSTIC_CONTRACT = 'dev-candidate-diagnostic-v1' as const;
export const candidateDiagnosticResults = ['model_null', 'candidate_filtered', 'candidate_ready', 'reply_rejected', 'provider_incomplete', 'unavailable'] as const;
export type CandidateDiagnosticResult = typeof candidateDiagnosticResults[number];
export function negotiateCandidateDiagnostic(environment: string | undefined, enabled: string | undefined, ephemeral: boolean, retry: boolean, header: string | undefined): boolean {
  return environment === 'development' && enabled === '1' && ephemeral && retry && header === CANDIDATE_DIAGNOSTIC_CONTRACT;
}
