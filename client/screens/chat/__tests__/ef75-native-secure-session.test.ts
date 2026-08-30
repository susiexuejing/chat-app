import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
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

const TOKEN = 'N'.repeat(43);
const expiresAt = Date.now() + 60_000;

describe('EF-75 native OS-protected anonymous credential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAnonymousSessionForTests();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    (SecureStore.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('reads a valid credential from SecureStore and makes no issuance request', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      credential: TOKEN,
      expiresAt,
    }));
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const options = await getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'GET');
    expect(options).toEqual({ headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      'emotionflow.anonymous_session.v1',
      expect.objectContaining({
        keychainService: 'emotionflow.anonymous-session.v1',
        keychainAccessible: 6,
        requireAuthentication: false,
      }),
    );
  });

  it('stores a newly issued credential before authorizing protected requests', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ credential: TOKEN, expiresAt }),
    } as Response);
    const options = await getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'POST');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'emotionflow.anonymous_session.v1',
      JSON.stringify({ schemaVersion: 1, credential: TOKEN, expiresAt }),
      expect.any(Object),
    );
    expect(options.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('fails closed without issuance when SecureStore is unavailable', async () => {
    (SecureStore.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'POST'))
      .rejects.toThrow('anonymous_secure_storage_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('revokes but never uses a token when protected storage write fails', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('synthetic'));
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential: TOKEN, expiresAt }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    await expect(getAnonymousRequestOptions('https://dev.douhaoyu.cn', 'POST'))
      .rejects.toThrow('anonymous_secure_storage_write_failed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toContain('/anonymous-sessions/revoke');
  });
});
