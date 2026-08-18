/**
 * Retry the existing failed logical turn.
 *
 * This must never call sendMessage: doing so creates a new turn and duplicates
 * the user's message instead of reusing the pending turn's identities.
 */
export async function retryFailedTurn(
  clearError: () => void,
  retryLastMessage: () => Promise<void>,
): Promise<void> {
  clearError();
  await retryLastMessage();
}
