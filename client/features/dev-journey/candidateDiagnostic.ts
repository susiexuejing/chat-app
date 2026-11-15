export const CANDIDATE_DIAGNOSTIC_CONTRACT = 'dev-candidate-diagnostic-v1' as const;
export const candidateDiagnosticResults = ['model_null', 'candidate_filtered', 'candidate_ready', 'reply_rejected', 'provider_incomplete', 'unavailable'] as const;
export type CandidateDiagnosticResult = typeof candidateDiagnosticResults[number];
export function validCandidateDiagnostic(value: unknown): value is CandidateDiagnosticResult {
  return typeof value === 'string' && (candidateDiagnosticResults as readonly string[]).includes(value);
}
