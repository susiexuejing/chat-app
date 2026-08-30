import { Platform } from 'react-native';
import {
  getAnonymousRequestOptions,
  resetAnonymousSessionForTests,
} from '../stores/anonymousSession';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const CSRF = 'C'.repeat(43);

describe('EF-75 browser HttpOnly session transport', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    resetAnonymousSessionForTests();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  it('bootstraps with credentialed cookie mode and persists only in-memory CSRF state', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ csrfToken: CSRF, expiresAt: Date.now() + 60_000 }),
    } as Response);
    const post = await getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'POST');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://dev.douhaoyu.cn/api/v1/anonymous-sessions/web',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-EF-Client': 'web' },
        body: '{}',
      },
    );
    expect(post).toEqual({ credentials: 'include', headers: { 'X-EF-CSRF': CSRF } });

    const get = await getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'GET');
    expect(get).toEqual({ credentials: 'include', headers: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(post)).not.toMatch(/Bearer|__Host-ef_anon/);
  });

  it('fails before a protected request when web session bootstrap fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    await expect(getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'POST'))
      .rejects.toThrow('anonymous_web_session_failed');
  });
});
