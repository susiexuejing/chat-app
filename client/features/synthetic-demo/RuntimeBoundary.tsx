import React, { type ReactNode } from 'react';
import { ChatProvider } from '@/screens/chat/contexts/ChatContext';
import ChatScreen from '@/screens/chat';
import SyntheticDemoScreen from '@/screens/synthetic-demo';

// The existing DEV export sets this value at build time. Select the runtime
// before mounting providers, never after live chat hydration has started.
// Production retains its existing provider, routes, transport and storage.
export const IS_SYNTHETIC_DEMO = process.env.EXPO_PUBLIC_APP_ENV === 'DEV';

export function AppRuntimeProvider({ children }: { children: ReactNode }) {
  if (IS_SYNTHETIC_DEMO) return <>{children}</>;
  return <ChatProvider>{children}</ChatProvider>;
}

export default function RuntimeEntry() {
  return IS_SYNTHETIC_DEMO ? <SyntheticDemoScreen /> : <ChatScreen />;
}
