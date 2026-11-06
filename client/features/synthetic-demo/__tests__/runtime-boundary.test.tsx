import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockLiveProvider = jest.fn(({ children }) => children);
const mockLiveScreen = jest.fn(() => React.createElement('LiveChat'));
const mockDemoScreen = jest.fn(() => React.createElement('SyntheticDemo'));
jest.mock('@/screens/chat/contexts/ChatContext', () => ({
  ChatProvider: (props: { children: React.ReactNode }) => mockLiveProvider(props),
}));
jest.mock('@/screens/chat', () => ({ __esModule: true, default: () => mockLiveScreen() }));
jest.mock('@/screens/synthetic-demo', () => ({ __esModule: true, default: () => mockDemoScreen() }));

const originalEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment;
  jest.clearAllMocks();
});

function loadBoundary(environment: string) {
  process.env.EXPO_PUBLIC_APP_ENV = environment;
  let boundary: typeof import('../RuntimeBoundary');
  jest.isolateModules(() => { boundary = require('../RuntimeBoundary'); });
  return boundary!;
}

test('DEV selects native synthetic UI without mounting the live hydration/request provider', async () => {
  const { default: Entry, AppRuntimeProvider } = loadBoundary('DEV');
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppRuntimeProvider><Entry /></AppRuntimeProvider>); });
  expect(mockLiveProvider).not.toHaveBeenCalled();
  expect(mockLiveScreen).not.toHaveBeenCalled();
  expect(mockDemoScreen).toHaveBeenCalled();
  await act(async () => renderer!.unmount());
});

test('production preserves existing chat provider and entry', async () => {
  const { default: Entry, AppRuntimeProvider } = loadBoundary('production');
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppRuntimeProvider><Entry /></AppRuntimeProvider>); });
  expect(mockLiveProvider).toHaveBeenCalled();
  expect(mockLiveScreen).toHaveBeenCalled();
  expect(mockDemoScreen).not.toHaveBeenCalled();
  await act(async () => renderer!.unmount());
});
