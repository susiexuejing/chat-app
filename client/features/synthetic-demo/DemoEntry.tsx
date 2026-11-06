import React from 'react';
import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import SyntheticDemoScreen from '@/screens/synthetic-demo';

// A direct /demo load never mounts or imports the live ChatProvider. The
// original / and /chat entries keep their existing behavior in every build.
export default function DemoEntry() {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'DEV') return <SyntheticDemoScreen />;
  return <Screen><Text>合成演示仅在 DEV 环境开放。原有聊天入口保持不变。</Text></Screen>;
}
