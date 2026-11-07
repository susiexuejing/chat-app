import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatScreen from '../index';
import { DEFAULT_ROLES } from '../constants/roles';

// Render the actual original ChatScreen and RoleHeader. Everything that can own
// live state or perform I/O is a test double. This is component-handler coverage,
// not Expo Router, browser-history, transport, or real HistoryList integration.
const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockSendMessage = jest.fn();
const mockCreateNewChat = jest.fn();
const mockSetCurrentRole = jest.fn();
const mockRetryLastMessage = jest.fn();
const mockClearError = jest.fn();
const mockInputFocus = jest.fn();
const mockLiveProvider = jest.fn((_props: unknown) => { throw new Error('Live provider must not mount in this component test'); });
let mockPathname = '/';

jest.mock('expo-router', () => ({
  // Defer reading the spies until the component uses them: Jest hoists this
  // factory above the imports, before top-level const initialization.
  router: {
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    push: (...args: unknown[]) => mockRouter.push(...args),
    back: (...args: unknown[]) => mockRouter.back(...args),
    navigate: (...args: unknown[]) => mockRouter.navigate(...args),
  },
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('../contexts/ChatContext', () => ({
  useChat: () => mockChatState,
  ChatProvider: (props: unknown) => mockLiveProvider(props),
}));
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: any) => require('react').createElement('Screen', null, children),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  const TextInput = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ focus: mockInputFocus }));
    return React.createElement('TextInput', props);
  });
  TextInput.displayName = 'MockTextInput';
  return {
    Platform: { OS: 'web' },
    View: host('View'), Text: host('Text'), TouchableOpacity: host('TouchableOpacity'),
    ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'), TextInput,
    // A closed modal must not expose history controls to the test tree.
    Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
  };
});
jest.mock('../components', () => {
  const React = require('react');
  const host = (name: string) => (props: any) => React.createElement(name, props);
  const modal = (name: string) => ({ visible, ...props }: any) => visible ? React.createElement(name, props) : null;
  return {
    RoleHeader: jest.requireActual('../components/RoleHeader').RoleHeader,
    MessageList: host('MessageList'), MultimodalInput: host('MultimodalInput'),
    HistoryList: host('HistoryList'), QueueStatusBar: host('QueueStatusBar'),
    ChangeSystemCard: host('ChangeSystemCard'),
    RoleIntroModal: modal('RoleIntroModal'), RoleDetailModal: modal('RoleDetailModal'),
    RolePickerModal: modal('RolePickerModal'),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn(),
    multiGet: jest.fn(), multiSet: jest.fn(), multiRemove: jest.fn(), mergeItem: jest.fn(), multiMerge: jest.fn(),
  },
}));
jest.mock('../api/cozeApi', () => ({ chatStart: jest.fn(), chatStream: jest.fn() }));
jest.mock('../stores/sessionStore', () => ({
  getChatSessions: jest.fn(), saveChatSessions: jest.fn(),
  createConversation: jest.fn(), fetchConversation: jest.fn(), persistMessage: jest.fn(),
}));

function homeState() {
  return {
    currentRole: DEFAULT_ROLES[0],
    messages: [] as { id: string; role: 'user' | 'assistant'; content: string; timestamp: number }[],
    sessions: [] as { id: string }[],
    currentSessionId: null as string | null,
    isHydrated: true,
    isLoading: false,
    chatPhase: 'idle' as 'idle' | 'responding',
    flowContext: null,
    error: null,
    sendMessage: mockSendMessage,
    createNewChat: mockCreateNewChat,
    setCurrentRole: mockSetCurrentRole,
    retryLastMessage: mockRetryLastMessage,
    clearError: mockClearError,
  };
}
let mockChatState: ReturnType<typeof homeState>;

describe('EF-384 DEV entry in the actual original ChatScreen', () => {
  let tree: ReactTestRenderer | undefined;
  let originalEnvironment: string | undefined;
  let originalGlobals: Map<string, PropertyDescriptor | undefined>;
  let storage: Record<string, jest.Mock>;
  let network: Record<string, jest.Mock>;
  let logSpy: jest.SpyInstance;

  function replaceGlobal(name: string, value: unknown) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
    process.env.EXPO_PUBLIC_APP_ENV = 'DEV';
    mockPathname = '/';
    mockChatState = homeState();
    mockSendMessage.mockReset().mockResolvedValue(true);
    mockCreateNewChat.mockReset().mockReturnValue('synthetic-test-conversation');
    originalGlobals = new Map();
    storage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() };
    network = Object.fromEntries(['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'].map(name => [
      name, jest.fn(() => { throw new Error(`Unexpected ${name} in isolated component test`); }),
    ]));
    replaceGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // A development runtime must not override the explicit application-env gate.
    replaceGlobal('__DEV__', true);
    replaceGlobal('window', { location: { search: '' }, localStorage: storage, sessionStorage: storage, ...network });
    replaceGlobal('localStorage', storage);
    replaceGlobal('sessionStorage', storage);
    for (const [name, value] of Object.entries(network)) replaceGlobal(name, value);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  function expectNoIO() {
    const api = jest.requireMock('../api/cozeApi');
    const sessions = jest.requireMock('../stores/sessionStore');
    for (const mock of [
      ...Object.values(network), ...Object.values(storage), ...Object.values(AsyncStorage),
      ...Object.values(api), ...Object.values(sessions), mockLiveProvider,
    ]) expect(mock).not.toHaveBeenCalled();
  }

  afterEach(async () => {
    try {
      if (tree) await act(async () => { tree!.unmount(); });
      // Even ordinary-chat action tests call only mocked callbacks, never I/O.
      expectNoIO();
    } finally {
      tree = undefined;
      if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
      else process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment;
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
      logSpy.mockRestore();
    }
  });

  function selectView(view: 'home' | 'chat') {
    if (view === 'chat') {
      mockPathname = '/chat';
      mockChatState = {
        ...mockChatState,
        currentSessionId: 'synthetic-test-session',
        sessions: [{ id: 'synthetic-test-session' }],
        messages: [{ id: 'synthetic-test-message', role: 'user', content: '虚构的测试消息', timestamp: 1 }],
      };
    }
  }

  async function mount() {
    await act(async () => { tree = renderer.create(<ChatScreen />); });
  }
  async function updateState(patch: Partial<ReturnType<typeof homeState>>) {
    mockChatState = { ...mockChatState, ...patch };
    await act(async () => { tree!.update(<ChatScreen />); });
  }
  function hosts(type: string): ReactTestInstance[] {
    return tree!.root.findAll(node => typeof node.type === 'string' && node.type === type);
  }
  function demoEntries() {
    return tree!.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'native-demo-open');
  }
  function demoEntry() {
    expect(demoEntries()).toHaveLength(1);
    return demoEntries()[0];
  }
  function button(label: string) {
    const matches = hosts('TouchableOpacity').filter(control => control.findAll(node =>
      node.type === ('Text' as any) && node.children.join('') === label).length > 0);
    expect(matches).toHaveLength(1);
    return matches[0];
  }
  async function press(control: ReactTestInstance) {
    expect(control.props.disabled).not.toBe(true);
    await act(async () => { await control.props.onPress(); });
  }
  function expectNoChatActions() {
    for (const mock of [mockSendMessage, mockCreateNewChat, mockSetCurrentRole, mockRetryLastMessage, mockClearError]) {
      expect(mock).not.toHaveBeenCalled();
    }
  }
  function expectNoNavigation() {
    for (const mock of Object.values(mockRouter)) expect(mock).not.toHaveBeenCalled();
  }
  function expectOriginalControls(view: 'home' | 'chat') {
    expect(hosts('Text').some(node => node.children.join('') === 'EmotionFlow')).toBe(true);
    if (view === 'home') {
      expect(hosts('TextInput')).toHaveLength(1);
      expect(hosts('TextInput')[0].props.placeholder).toBe('今天真的好累');
      expect(button('开始').props.disabled).toBe(true);
      for (const label of ['我很累', '我很乱', '我很烦', '我很空', '说不清']) button(label);
      expect(hosts('MultimodalInput')).toHaveLength(0);
    } else {
      button('历史聊天');
      button('新对话');
      expect(hosts('MessageList')).toHaveLength(1);
      expect(hosts('QueueStatusBar')).toHaveLength(1);
      expect(hosts('MultimodalInput')).toHaveLength(1);
      expect(hosts('MultimodalInput')[0].props.onSendMessage).toBe(mockSendMessage);
      expect(hosts('HistoryList')).toHaveLength(0);
    }
  }

  describe.each(['home', 'chat'] as const)('%s view', view => {
    it.each(['DEV', 'PROD', 'production', 'dev', '', undefined])(
      'shows the entry only for exact DEV while preserving original controls (environment=%s)',
      async environment => {
        if (environment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
        else process.env.EXPO_PUBLIC_APP_ENV = environment;
        selectView(view);
        await mount();
        expect(demoEntries()).toHaveLength(environment === 'DEV' ? 1 : 0);
        expectOriginalControls(view);
        expectNoChatActions();
        expectNoNavigation();
      },
    );

    it.each([
      { isHydrated: false, isLoading: false },
      { isHydrated: false, isLoading: true },
      { isHydrated: true, isLoading: true },
    ])('blocks even a direct handler call when hydrated=$isHydrated/loading=$isLoading', async state => {
      selectView(view);
      Object.assign(mockChatState, state);
      await mount();
      expect(demoEntry().props.disabled).toBe(true);
      expect(demoEntry().props.accessibilityState).toEqual({ disabled: true });
      await act(async () => { demoEntry().props.onPress(); });
      expectNoNavigation();
      expectNoChatActions();
    });

    it('enables after hydration and one press replaces only /demo exactly once', async () => {
      selectView(view);
      mockChatState.isHydrated = false;
      await mount();
      expect(demoEntry().props.disabled).toBe(true);
      await updateState({ isHydrated: true });
      expect(demoEntry().props.disabled).toBe(false);
      expect(demoEntry().props.accessibilityRole).toBe('button');
      expect(demoEntry().props.accessibilityLabel).toBe('DEV 体验流程（真实 API）');
      expect(demoEntry().props.accessibilityState).toEqual({ disabled: false });
      const beforeState = JSON.stringify(mockChatState);
      await press(demoEntry());
      // Re-rendering itself must not repeat navigation. The mocked router does
      // not unmount the screen, so this does not assert real route replacement.
      await updateState({});
      expect(mockRouter.replace.mock.calls).toEqual([['/demo']]);
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(mockRouter.back).not.toHaveBeenCalled();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(JSON.stringify(mockChatState)).toBe(beforeState);
      expectOriginalControls(view);
      expectNoChatActions();
      expectNoIO();
    });
  });

  it('preserves state-entry input/focus and the ordinary start flow, including its in-flight guard', async () => {
    let resolveSend!: (value: boolean) => void;
    const pendingSend = new Promise<boolean>(resolve => { resolveSend = resolve; });
    mockSendMessage.mockReturnValue(pendingSend);
    await mount();
    await act(async () => { hosts('TextInput')[0].props.onChangeText('   '); });
    expect(button('开始').props.disabled).toBe(true);
    await act(async () => { await button('开始').props.onPress(); });
    expectNoChatActions();

    await press(button('我很累'));
    expect(hosts('TextInput')[0].props.value).toBe('我很累');
    expect(mockInputFocus).toHaveBeenCalledTimes(1);
    expect(button('开始').props.disabled).toBe(false);
    expectNoChatActions();
    await act(async () => { hosts('TextInput')[0].props.onChangeText('  虚构的首次消息  '); });
    const start = button('开始').props.onPress;
    let started!: Promise<void>;
    await act(async () => {
      started = start();
      await start(); // Same handler while the first send is unresolved.
    });
    const defaultRole = DEFAULT_ROLES.find(role => role.id === 'clever-fox') || DEFAULT_ROLES[0];
    expect(mockSetCurrentRole).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentRole).toHaveBeenCalledWith(defaultRole);
    expect(mockCreateNewChat.mock.calls).toEqual([[defaultRole]]);
    expect(mockSendMessage.mock.calls).toEqual([
      ['虚构的首次消息', { conversationId: 'synthetic-test-conversation' }],
    ]);
    expect(hosts('TextInput')).toHaveLength(0);
    expectOriginalControls('chat');
    expectNoNavigation();

    // The provider is controlled here: verify ChatScreen responds to the live
    // loading signal, not the implementation/timing of a real provider send.
    await updateState({ isLoading: true, chatPhase: 'responding' });
    expect(demoEntry().props.disabled).toBe(true);
    expect(hosts('MultimodalInput')[0].props.disabled).toBe(true);
    await act(async () => { demoEntry().props.onPress(); });
    expectNoNavigation();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockCreateNewChat).toHaveBeenCalledTimes(1);

    await act(async () => { resolveSend(true); await started; });
    await updateState({ isLoading: false, chatPhase: 'idle' });
    expect(demoEntry().props.disabled).toBe(false);
    expect(hosts('MultimodalInput')[0].props.disabled).toBe(false);
    expectNoNavigation();
  });

  it('keeps real header history open/close and new-chat callbacks without entering the demo', async () => {
    selectView('chat');
    await mount();
    expectOriginalControls('chat');
    await press(button('历史聊天'));
    expect(hosts('HistoryList')).toHaveLength(1);
    expect(hosts('Modal')).toHaveLength(1);
    await act(async () => { hosts('HistoryList')[0].props.onClose(); });
    expect(hosts('HistoryList')).toHaveLength(0);
    expect(hosts('Modal')).toHaveLength(0);
    expectNoChatActions();
    expectNoNavigation();

    // Simulate the provider's new-chat state update without running it.
    mockCreateNewChat.mockImplementation(() => {
      mockChatState = { ...mockChatState, messages: [], currentSessionId: null };
      return 'synthetic-test-next-conversation';
    });
    await press(button('新对话'));
    expect(mockCreateNewChat.mock.calls).toEqual([[]]);
    expect(hosts('TextInput')[0].props.value).toBe('');
    expectOriginalControls('home');
    expect(demoEntry().props.disabled).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSetCurrentRole).not.toHaveBeenCalled();
    expectNoNavigation();
  });
});
