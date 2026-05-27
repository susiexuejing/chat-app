import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatSession } from '../types';

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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    // silent
  }
}

export async function clearSessionsFromStorage(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // silent
  }
}