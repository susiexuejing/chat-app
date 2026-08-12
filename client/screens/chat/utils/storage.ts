import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatSession } from '../types';
import { attributedRemoveItem, attributedSetItem } from './ef77Diagnostics';

const STORAGE_KEY = 'chat_sessions';

export async function loadSessionsFromStorage(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as ChatSession[];
    }
  } catch (e) {
    // silent
  }
  return [];
}

export async function saveSessionsToStorage(sessions: ChatSession[]): Promise<void> {
  try {
    await attributedSetItem(AsyncStorage, STORAGE_KEY, JSON.stringify(sessions), {
      writerSource: 'storage.saveSessionsToStorage',
      transitionReason: 'bypass_storage_write',
      queueKind: 'bypass',
    });
  } catch (e) {
    // silent
  }
}

export async function clearSessionsFromStorage(): Promise<void> {
  try {
    await attributedRemoveItem(AsyncStorage, STORAGE_KEY, {
      writerSource: 'storage.clearSessionsFromStorage',
      transitionReason: 'legacy_storage_cleared',
      queueKind: 'bypass',
    });
  } catch (e) {
    // silent
  }
}
