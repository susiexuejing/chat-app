import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { MessageBubbleView } from '../components/MessageBubbleView';
import { MessageListView, type MessageListViewProps } from '../components/MessageListView';
import { MultimodalInputView, type MultimodalInputViewProps } from '../components/MultimodalInputView';
import type { ChatMessage } from '../types';

// These views must remain safe to import and mount without any live provider or
// recording permission module. An accidental wrapper import fails the suite.
jest.mock('../contexts/ChatContext', () => { throw new Error('Pure views imported live ChatContext'); });
jest.mock('expo-av', () => { throw new Error('Pure views imported recording permissions'); });
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    FontAwesome6: (props: any) => React.createElement('Icon', props),
    Ionicons: (props: any) => React.createElement('Icon', props),
  };
});
const mockScrollToEnd = jest.fn();
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  const ScrollView = React.forwardRef(({ children, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: mockScrollToEnd }));
    return React.createElement('ScrollView', props, children);
  });
  ScrollView.displayName = 'MockScrollView';
  return {
    Platform: { OS: 'web' }, View: host('View'), Text: host('Text'), Image: host('Image'),
    TouchableOpacity: host('TouchableOpacity'), ActivityIndicator: host('ActivityIndicator'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'), TextInput: host('TextInput'), ScrollView,
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

const user: ChatMessage = { id: 'user', role: 'user', content: '虚构用户输入', timestamp: 1767225600000 };
const assistant: ChatMessage = { id: 'assistant', role: 'assistant', content: '虚构回复', timestamp: 1767225660000 };
const role = { name: '测试陪伴者', shortDesc: '测试介绍', themeColor: '#10B981', avatar: null };

describe('EF-385 shared chat presentation without live dependencies', () => {
  let tree: ReactTestRenderer | undefined;
  let originalGlobals: Map<string, PropertyDescriptor | undefined>;
  let io: Record<string, jest.Mock>;

  function replaceGlobal(name: string, value: unknown) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Platform.OS = 'web';
    originalGlobals = new Map();
    replaceGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    io = Object.fromEntries(['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'getItem', 'setItem', 'removeItem'].map(name => [
      name, jest.fn(() => { throw new Error(`Unexpected I/O: ${name}`); }),
    ]));
    for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource']) replaceGlobal(name, io[name]);
    replaceGlobal('localStorage', { getItem: io.getItem, setItem: io.setItem, removeItem: io.removeItem });
    replaceGlobal('sessionStorage', { getItem: io.getItem, setItem: io.setItem, removeItem: io.removeItem });
  });
  afterEach(async () => {
    try {
      if (tree) await act(async () => { tree!.unmount(); });
      for (const mock of Object.values(io)) expect(mock).not.toHaveBeenCalled();
    } finally {
      tree = undefined;
      jest.clearAllTimers();
      jest.useRealTimers();
      Platform.OS = 'web';
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
    }
  });
  async function render(element: React.ReactElement) {
    await act(async () => {
      if (tree) tree.update(element);
      else tree = renderer.create(element);
    });
  }
  function hosts(type: string): ReactTestInstance[] {
    return tree!.root.findAll(node => typeof node.type === 'string' && node.type === type);
  }
  function output() { return JSON.stringify(tree!.toJSON()); }
  function listProps(overrides: Partial<MessageListViewProps> = {}): MessageListViewProps {
    return { messages: [user], currentRole: role, setInputText: jest.fn(), onShowIntro: jest.fn(), retryLastMessage: jest.fn(), ...overrides };
  }
  function composerProps(overrides: Partial<MultimodalInputViewProps> = {}): MultimodalInputViewProps {
    return { value: '  虚构输入  ', onChangeText: jest.fn(), onSend: jest.fn(), ...overrides };
  }

  it('preserves green right-aligned user bubbles, the local user avatar, and local-time timestamps', async () => {
    await render(<MessageBubbleView message={user} />);
    expect(hosts('View')[0].props.className).toContain('justify-end');
    expect(hosts('View').find(node => node.props.style?.backgroundColor === '#10B981')?.props.className).toContain('rounded-br-md');
    expect(hosts('Text').find(node => node.children.includes(user.content))?.props.className).toContain('text-white');
    expect(hosts('Image')).toHaveLength(0);
    expect(output()).toContain('我');
    expect(output()).toContain(new Date(user.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  });

  it('preserves gray left-aligned assistant bubbles, live avatar URI, and the last 200 thinking characters', async () => {
    const thinking = '前面'.repeat(110) + '最后';
    await render(<MessageBubbleView message={assistant} assistantAvatar="https://example.invalid/avatar.png" thinking={thinking} />);
    expect(hosts('View')[0].props.className).toContain('justify-start');
    expect(hosts('View').find(node => node.props.style?.backgroundColor === '#F3F4F6')?.props.className).toContain('rounded-bl-md');
    expect(hosts('Image')[0].props).toMatchObject({ source: { uri: 'https://example.invalid/avatar.png' }, className: 'w-8 h-8 rounded-full mr-2 self-end' });
    expect(output()).toContain(thinking.slice(-200));
    expect(output()).not.toContain(thinking);
  });

  it('uses a local avatar only for explicit null and preserves the previous undefined source behavior', async () => {
    await render(<MessageBubbleView message={assistant} assistantAvatar={null} />);
    expect(hosts('Image')).toHaveLength(0);
    expect(output()).toContain('伴');
    await render(<MessageBubbleView message={assistant} />);
    expect(hosts('Image')[0].props.source).toEqual({ uri: undefined });
  });

  it('preserves the welcome screen, introduction action and original starter text', async () => {
    const props = listProps({ messages: [], turnStatus: 'interrupted' });
    await render(<MessageListView {...props} />);
    expect(hosts('ScrollView')).toHaveLength(0);
    expect(hosts('ActivityIndicator')).toHaveLength(0);
    expect(output()).toContain('你不需要整理好语言。');
    expect(output()).not.toContain('重新生成');
    expect(hosts('TouchableOpacity')).toHaveLength(6);
    await act(async () => { hosts('TouchableOpacity')[0].props.onPress(); hosts('TouchableOpacity')[1].props.onPress(); });
    expect(props.onShowIntro).toHaveBeenCalledTimes(1);
    // Preserve the existing starter semantics, including its exact wording.
    expect(props.setInputText).toHaveBeenCalledWith('我感觉我很累');
  });

  it('keeps the original ScrollView and auto-scroll triggers when count or content changes', async () => {
    const props = listProps();
    await render(<MessageListView {...props} />);
    expect(hosts('ScrollView')[0].props).toMatchObject({ className: 'flex-1 py-4', showsVerticalScrollIndicator: false, contentContainerStyle: { flexGrow: 1 } });
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });
    mockScrollToEnd.mockClear();
    await render(<MessageListView {...props} messages={[{ ...user, content: '变化后的内容' }]} />);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    await act(async () => { hosts('ScrollView')[0].props.onContentSizeChange(); });
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    await render(<MessageListView {...props} messages={[user, assistant]} />);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
  });

  it.each(['idle', 'completed', 'failed', 'interrupted'] as const)('never infers a loading spinner for %s', async turnStatus => {
    await render(<MessageListView {...listProps({ turnStatus })} />);
    expect(hosts('ActivityIndicator')).toHaveLength(0);
  });

  it('shows generating only for a final user message and preserves interruption retry', async () => {
    const props = listProps({ turnStatus: 'generating' });
    await render(<MessageListView {...props} />);
    expect(hosts('ActivityIndicator')).toHaveLength(1);
    expect(output()).toContain('正在思考中...');
    await render(<MessageListView {...props} messages={[user, assistant]} />);
    expect(hosts('ActivityIndicator')).toHaveLength(0);
    await render(<MessageListView {...props} turnStatus="interrupted" />);
    expect(output()).toContain('刚才的回复因页面刷新而中断');
    await act(async () => { hosts('TouchableOpacity')[0].props.onPress(); });
    expect(props.retryLastMessage).toHaveBeenCalledTimes(1);
  });

  it('reuses the real collapsible deep-analysis card only after assistant messages', async () => {
    const analysis = { fact: '虚构事实', interpretation: '虚构解读', reframe: '虚构重构' };
    await render(<MessageListView {...listProps({ messages: [{ ...user, deepAnalysis: analysis }, { ...assistant, deepAnalysis: analysis }] })} />);
    expect(hosts('Text').filter(node => node.children.includes('我听见的东西'))).toHaveLength(1);
    expect(output()).not.toContain('虚构事实');
    await act(async () => { hosts('TouchableOpacity')[0].props.onPress(); });
    expect(output()).toContain('虚构事实');
    expect(output()).toContain('虚构解读');
    expect(output()).toContain('虚构重构');
  });

  it('keeps optional journey controls in the same message scroll area', async () => {
    await render(<MessageListView {...listProps()} footer={React.createElement('Footer')} />);
    expect(hosts('ScrollView')[0].findAll(node => node.type === ('Footer' as any))).toHaveLength(1);
  });

  it('reuses the editable controlled text field and paper-plane send affordance', async () => {
    const props = composerProps({ inputTestID: 'chat-input', sendTestID: 'chat-send' });
    await render(<MultimodalInputView {...props} />);
    const input = hosts('TextInput')[0];
    expect(input.props).toMatchObject({ value: props.value, editable: true, multiline: true, maxLength: 1000, testID: 'chat-input', style: { fontSize: 16, maxHeight: 100, minHeight: 24, color: '#374151' } });
    expect(hosts('Icon')[0].props).toMatchObject({ name: 'paper-plane', size: 18, color: 'white' });
    expect(hosts('TouchableOpacity')[0].props.className).toContain('bg-emerald-500');
    await act(async () => { input.props.onChangeText('新的虚构输入'); await hosts('TouchableOpacity')[0].props.onPress(); });
    expect(props.onChangeText).toHaveBeenCalledWith('新的虚构输入');
    expect(props.onSend).toHaveBeenCalledTimes(1);
    // Presentation does not clear a draft or decide if a send was accepted.
    expect(props.onChangeText).toHaveBeenCalledTimes(1);
    expect(hosts('TextInput')[0].props.value).toBe(props.value);
  });

  it.each([{ value: '   ' }, { value: '有内容', disabled: true }])('blocks sends but keeps typing available (%o)', async overrides => {
    const props = composerProps(overrides);
    await render(<MultimodalInputView {...props} />);
    expect(hosts('TextInput')[0].props.editable).toBe(true);
    expect(hosts('TouchableOpacity')[0].props.disabled).toBe(true);
    expect(hosts('TouchableOpacity')[0].props.className).toContain('bg-gray-300');
    await act(async () => { hosts('TouchableOpacity')[0].props.onPress(); hosts('TextInput')[0].props.onChangeText('仍可输入'); });
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onChangeText).toHaveBeenCalledWith('仍可输入');
  });

  it.each([
    ['idle', '直接说，不用整理语言'], ['responding', '　'], ['companion', '　'],
    ['waiting_deep', '　'], ['deep_arriving', '　'], ['done', '◎ 轮到你了'],
  ] as const)('preserves the %s phase placeholder and hint', async (phase, hint) => {
    await render(<MultimodalInputView {...composerProps({ phase })} />);
    expect(hosts('TextInput')[0].props.placeholder).toBe(phase === 'responding' ? '' : '把此刻最真实的一句话放在这里');
    expect(hosts('Text')[0].children).toEqual([hint]);
  });

  it('preserves iOS keyboard padding and the original offset', async () => {
    Platform.OS = 'ios';
    await render(<MultimodalInputView {...composerProps()} />);
    expect(hosts('KeyboardAvoidingView')[0].props).toMatchObject({ behavior: 'padding', keyboardVerticalOffset: 90 });
  });
});
