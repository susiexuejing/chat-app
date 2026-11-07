import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import DemoEntry from '../DemoEntry';
import LiveChatLayout from '../LiveChatLayout';

const mockLiveProvider = jest.fn(({ children }: { children: React.ReactNode }) => React.createElement('LiveProvider', null, children));
const mockDemoScreen = jest.fn(() => React.createElement('SyntheticDemo'));
jest.mock('@/screens/chat/contexts/ChatContext', () => ({
  ChatProvider: (props: { children: React.ReactNode }) => mockLiveProvider(props),
}));
jest.mock('@/screens/synthetic-demo', () => ({ __esModule: true, default: () => mockDemoScreen() }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: any) => require('react').createElement('Screen', null, children) }));
jest.mock('react-native', () => ({ Text: ({ children }: any) => require('react').createElement('Text', null, children) }));
jest.mock('expo-router', () => {
  const React = require('react');
  const Stack = ({ children, ...props }: any) => React.createElement('Stack', props, children);
  Stack.Screen = (props: any) => React.createElement('Route', props);
  return { Stack };
});

const originalEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
let tree: TestRenderer.ReactTestRenderer | undefined;
let oldAct: unknown;
beforeEach(() => {
  oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  jest.clearAllMocks();
});

test('DEV /demo renders synthetic entry without mounting live provider', async () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'DEV';
  await act(async () => { tree = TestRenderer.create(<DemoEntry />); });
  expect(mockLiveProvider).not.toHaveBeenCalled();
  expect(mockDemoScreen).toHaveBeenCalled();
  expect(tree!.root.findAllByType('SyntheticDemo' as any)).toHaveLength(1);
});

test.each(['production', 'PROD', '', undefined])('non-DEV /demo fails closed (%s), without live fallback', async environment => {
  if (environment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = environment;
  await act(async () => { tree = TestRenderer.create(<DemoEntry />); });
  expect(mockLiveProvider).not.toHaveBeenCalled();
  expect(mockDemoScreen).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain('体验流程仅在 DEV 环境开放');
});

test.each(['DEV', 'production'])('live group preserves one shared provider and index/chat routes (%s)', async environment => {
  process.env.EXPO_PUBLIC_APP_ENV = environment;
  await act(async () => { tree = TestRenderer.create(<LiveChatLayout />); });
  const providers = tree!.root.findAllByType('LiveProvider' as any);
  expect(providers).toHaveLength(1);
  const stack = providers[0].findByType('Stack' as any);
  expect(stack.findAllByType('Route' as any).map(route => route.props.name)).toEqual(['index', 'chat']);
  expect(mockDemoScreen).not.toHaveBeenCalled();
});
