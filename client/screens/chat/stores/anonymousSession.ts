import { Platform } from 'react-native';

type SecureStoreModule = typeof import('expo-secure-store');

const STORAGE_KEY = 'emotionflow.anonymous_session.v1';
const KEYCHAIN_SERVICE = 'emotionflow.anonymous-session.v1';
const TOKEN_PATTERN = /^[\w-]{43}$/;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface NativeCredential {
  schemaVersion: 1;
  credential: string;
  expiresAt: number;
}

interface WebCredentialState {
  csrfToken: string;
  expiresAt: number;
}

export interface AnonymousRequestOptions {
  headers: Record<string, string>;
  credentials?: 'include';
}

let nativeCredentialInFlight: Promise<NativeCredential> | null = null;
let webCredentialInFlight: Promise<WebCredentialState> | null = null;
let webCredential: WebCredentialState | null = null;

function isExpiryValid(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > Date.now()
    && value <= Date.now() + MAX_TTL_MS + 60_000;
}

function parseNativeCredential(raw: string | null): NativeCredential | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NativeCredential>;
    return value.schemaVersion === 1
      && TOKEN_PATTERN.test(value.credential ?? '')
      && isExpiryValid(value.expiresAt)
      ? value as NativeCredential
      : null;
  } catch {
    return null;
  }
}

async function loadSecureStore(): Promise<SecureStoreModule> {
  return import('expo-secure-store');
}

function secureStoreOptions(secureStore: SecureStoreModule): import('expo-secure-store').SecureStoreOptions {
  return {
    keychainService: KEYCHAIN_SERVICE,
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
}

async function revokeUnstoredNativeCredential(baseUrl: string, credentialValue: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/v1/anonymous-sessions/revoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentialValue}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    // The credential was never used for protected data. Best-effort cleanup only.
  }
}

async function loadOrIssueNativeCredential(baseUrl: string): Promise<NativeCredential> {
  const secureStore = await loadSecureStore();
  if (!await secureStore.isAvailableAsync()) {
    throw new Error('anonymous_secure_storage_unavailable');
  }

  const options = secureStoreOptions(secureStore);
  const raw = await secureStore.getItemAsync(STORAGE_KEY, options);
  const stored = parseNativeCredential(raw);
  if (stored) return stored;
  if (raw !== null) await secureStore.deleteItemAsync(STORAGE_KEY, options);

  const response = await fetch(`${baseUrl}/api/v1/anonymous-sessions/native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('anonymous_session_issue_failed');
  const payload = await response.json() as { credential?: unknown; expiresAt?: unknown };
  if (typeof payload.credential !== 'string'
    || !TOKEN_PATTERN.test(payload.credential)
    || !isExpiryValid(payload.expiresAt)) {
    throw new Error('anonymous_session_issue_invalid');
  }

  const credential: NativeCredential = {
    schemaVersion: 1,
    credential: payload.credential,
    expiresAt: payload.expiresAt,
  };
  try {
    await secureStore.setItemAsync(STORAGE_KEY, JSON.stringify(credential), options);
  } catch {
    await revokeUnstoredNativeCredential(baseUrl, credential.credential);
    throw new Error('anonymous_secure_storage_write_failed');
  }
  return credential;
}

function ensureNativeCredential(baseUrl: string): Promise<NativeCredential> {
  if (!nativeCredentialInFlight) {
    const operation = loadOrIssueNativeCredential(baseUrl);
    nativeCredentialInFlight = operation;
    const clear = () => {
      if (nativeCredentialInFlight === operation) nativeCredentialInFlight = null;
    };
    operation.then(clear, clear);
  }
  return nativeCredentialInFlight;
}

async function issueOrResumeWebCredential(baseUrl: string): Promise<WebCredentialState> {
  const response = await fetch(`${baseUrl}/api/v1/anonymous-sessions/web`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-EF-Client': 'web',
    },
    body: '{}',
  });
  if (!response.ok) throw new Error('anonymous_web_session_failed');
  const payload = await response.json() as { csrfToken?: unknown; expiresAt?: unknown };
  if (typeof payload.csrfToken !== 'string'
    || !TOKEN_PATTERN.test(payload.csrfToken)
    || !isExpiryValid(payload.expiresAt)) {
    throw new Error('anonymous_web_session_invalid');
  }
  return { csrfToken: payload.csrfToken, expiresAt: payload.expiresAt };
}

function ensureWebCredential(baseUrl: string): Promise<WebCredentialState> {
  if (webCredential && isExpiryValid(webCredential.expiresAt)) {
    return Promise.resolve(webCredential);
  }
  if (!webCredentialInFlight) {
    const operation = issueOrResumeWebCredential(baseUrl);
    webCredentialInFlight = operation;
    operation.then(
      value => { webCredential = value; },
      () => { webCredential = null; },
    ).finally(() => {
      if (webCredentialInFlight === operation) webCredentialInFlight = null;
    });
  }
  return webCredentialInFlight;
}

export async function getAnonymousRequestOptions(
  baseUrl: string,
  method: 'GET' | 'POST',
): Promise<AnonymousRequestOptions> {
  if (Platform.OS === 'web') {
    const state = await ensureWebCredential(baseUrl);
    return {
      credentials: 'include',
      headers: method === 'POST' ? { 'X-EF-CSRF': state.csrfToken } : {},
    };
  }
  const credential = await ensureNativeCredential(baseUrl);
  return { headers: { Authorization: `Bearer ${credential.credential}` } };
}

export function resetAnonymousSessionForTests(): void {
  nativeCredentialInFlight = null;
  webCredentialInFlight = null;
  webCredential = null;
}
