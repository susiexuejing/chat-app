import { retryFailedTurn } from '../utils/retryFailedTurn';

describe('E2E failed-turn retry contract', () => {
  it('clears the error and retries the existing logical turn exactly once', async () => {
    const clearError = jest.fn();
    const retryLastMessage = jest.fn().mockResolvedValue(undefined);

    await retryFailedTurn(clearError, retryLastMessage);

    expect(clearError).toHaveBeenCalledTimes(1);
    expect(retryLastMessage).toHaveBeenCalledTimes(1);
    expect(clearError.mock.invocationCallOrder[0])
      .toBeLessThan(retryLastMessage.mock.invocationCallOrder[0]);
  });
});
