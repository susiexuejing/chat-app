import React from 'react';
import { Stack } from 'expo-router';
import { ChatProvider } from '@/screens/chat/contexts/ChatContext';

// The original URLs and shared chat/history runtime remain intact. Only this
// route group mounts ChatProvider; /demo is its sibling, not its descendant.
export default function LiveChatLayout() {
  return <ChatProvider><Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" options={{ title: '' }} />
    <Stack.Screen name="chat" options={{ title: '' }} />
  </Stack></ChatProvider>;
}
