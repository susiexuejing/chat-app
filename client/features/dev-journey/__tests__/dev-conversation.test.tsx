import React from 'react';
import { Text } from 'react-native';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { DevConversation } from '../DevConversation';
import { MessageListView } from '@/screens/chat/components/MessageListView';
import { MultimodalInputView } from '@/screens/chat/components/MultimodalInputView';
import {
  createDevRealRequestController,
  DEV_REAL_REQUEST_NOTICE, DEV_REAL_REQUEST_SOURCE_NOTICE, DEV_REAL_REQUEST_STOP_NOTICE,
  type DevRealRequestCallbacks, type DevRealRequestController,
  type DevRealRequestInput, type DevRealRequestStart,
} from '../realRequestController';

// The runtime boundary is the only application mock: every send exercises the
// actual controller and original chat presentation against hermetic transport.
const mockCreateController = jest.fn();
const mockStart = jest.fn<Promise<DevRealRequestStart>, [DevRealRequestInput, AbortSignal]>();
const mockStream = jest.fn<Promise<void>, [string, DevRealRequestCallbacks, AbortSignal]>();
const mockConfirm = jest.fn();
const mockDiscard = jest.fn();
const mockControllers: DevRealRequestController[] = [];
let mockRequestIdFailure: 'throw' | 'invalid' | null = null;
const RECEIPT = { devConversationId: 'dev-conversation', expiresAt: 700000, remainingLifetimeMs: 600000 };
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => () => void) => require('react').useEffect(callback, [callback]) }));
const DEEP_REPLY = '测试后端 Deep 内容：可以先确认眼前的需要。';
const INPUT = '虚构场景：今天的安排有些乱。';
jest.mock('@/features/dev-journey/realRequestAdapter', () => ({
  createDevRealRequestControllerForRuntime: () => mockCreateController(),
}));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    View: host('View'), Text: host('Text'), TextInput: host('TextInput'),
    Pressable: host('Pressable'), ScrollView: host('ScrollView'), Image: host('Image'),
    TouchableOpacity: host('TouchableOpacity'), ActivityIndicator: host('ActivityIndicator'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'), Platform: { OS: 'web' },
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: (props: any) => require('react').createElement('Icon', props),
  Ionicons: (props: any) => require('react').createElement('Icon', props),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('DevConversation uses the shared chat UI and one explicitly requested DEV turn', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let oldAct: unknown;

  beforeEach(() => {
    mounted = false;
    jest.useFakeTimers();
    oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockCreateController.mockReset(); mockConfirm.mockReset(); mockDiscard.mockReset();
    mockControllers.splice(0); mockRequestIdFailure = null;
    mockStart.mockReset().mockResolvedValue({
      ...RECEIPT, sessionId: 'stub-session', reactionText: '即时回应（不是 Deep）', companionText: '陪伴回应（不是 Deep）',
    });
    mockStream.mockReset().mockImplementation(async (_session, callbacks) => {
      callbacks.onDeepChunk(DEEP_REPLY); callbacks.onDone();
    });
    let sequence = 0;
    mockCreateController.mockImplementation(() => {
      const controller = createDevRealRequestController({
        enabled: true, transport: { start: mockStart, stream: mockStream, end: async () => undefined },
        createRequestId: () => {
          if (mockRequestIdFailure === 'throw') throw new Error('synthetic request-ID failure');
          if (mockRequestIdFailure === 'invalid') return 'invalid request ID';
          return `stub-request-${++sequence}`;
        },
      });
      mockControllers.push(controller);
      return controller;
    });
  });
  afterEach(async () => {
    if (mounted) await act(async () => { tree.unmount(); });
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
    jest.clearAllTimers(); jest.useRealTimers();
  });

  function element(resetKey = 0) {
    return <DevConversation resetKey={resetKey} onConfirm={mockConfirm} onDraftDiscard={mockDiscard}
      footer={<Text testID="parent-draft">本地编辑区域</Text>} />;
  }
  async function mount(resetKey = 0) {
    await act(async () => { tree = renderer.create(element(resetKey)); });
    mounted = true;
  }
  async function update(resetKey: number) {
    await act(async () => { tree.update(element(resetKey)); });
  }
  function nodes(id: string): ReactTestInstance[] {
    return tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  }
  function node(id: string) {
    const result = nodes(id)[0];
    if (!result) throw new Error(`Missing visible native control: ${id}`);
    return result;
  }
  async function press(id: string) {
    const control = node(id);
    expect(control.props.disabled).not.toBe(true);
    await act(async () => { control.props.onPress(); });
  }
  async function type(text: string) {
    await act(async () => { node('chat-input').props.onChangeText(text); });
  }
  async function send(text = INPUT) { await type(text); await press('chat-send'); }
  async function unmount() {
    await act(async () => { tree.unmount(); }); mounted = false;
  }
  function output() { return JSON.stringify(tree.toJSON()); }
  function expectNoCandidate() {
    expect(nodes('candidate-confirm')).toHaveLength(0);
    expect(nodes('candidate-edit')).toHaveLength(0);
    expect(mockConfirm).not.toHaveBeenCalled();
  }

  it('StrictMode cleanup retires deferred initialization and only the current controller accepts an explicit send', async () => {
    await act(async () => { tree = renderer.create(<React.StrictMode>{element()}</React.StrictMode>); });
    mounted = true;
    expect(mockControllers.length).toBeGreaterThan(1);
    const retired = mockControllers.slice(0, -1);
    const current = mockControllers[mockControllers.length - 1];
    for (const controller of retired) expect(controller.getSnapshot().canSend).toBe(false);
    expect(current.getSnapshot().canSend).toBe(true);
    expect(node('chat-input').props.value).toBe('');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
    await send();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(current.getSnapshot().status).toBe('success');
    for (const controller of retired) {
      expect(controller.getSnapshot().inputText).toBe('');
      expect(controller.getSnapshot().canSend).toBe(false);
    }
    await press('candidate-confirm');
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({ text: DEEP_REPLY, input: INPUT, requestId: 'stub-request-1' });
  });

  it('mount, suggestions, intro, new chat and resetKey changes never initiate a request or external avatar', async () => {
    await mount();
    expect(tree.root.findByType(MessageListView)).toBeDefined();
    expect(tree.root.findByType(MultimodalInputView)).toBeDefined();
    expect(node('chat-input').props.value).toBe('');
    expect(node('chat-input').props.editable).toBe(true);
    expect(node('chat-send').props.disabled).toBe(true);
    expect(output()).toContain(DEV_REAL_REQUEST_NOTICE);
    // The host mock uses RN names outside React's DOM intrinsic-name union.
    expect(tree.root.findAll(item => typeof item.type === 'string' && (item.type as string) === 'Image')).toHaveLength(0);
    const list = tree.root.findByType(MessageListView);
    await act(async () => { list.props.setInputText('我感觉我很累'); list.props.onShowIntro(); });
    expect(node('chat-input').props.value).toBe('虚构场景：我感觉我很累');
    expect(output()).toContain('不是诊断');
    await press('dev-new-chat');
    expect(node('chat-input').props.value).toBe('');
    await type(INPUT); await update(1);
    expect(node('chat-input').props.value).toBe('');
    expect(mockStart).not.toHaveBeenCalled(); expect(mockStream).not.toHaveBeenCalled();
    expectNoCandidate();
  });

  it('refuses empty sends, trims and limits explicit input, and sends only the current text allowlist', async () => {
    await mount(); await type(' \n ');
    expect(node('chat-send').props.disabled).toBe(true);
    await act(async () => { node('chat-send').props.onPress(); });
    expect(mockStart).not.toHaveBeenCalled();
    await send(`  ${INPUT}  `);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toEqual({
      roleId: 'clever-fox', message: INPUT, requestId: 'stub-request-1',
    });
    expect(mockStream.mock.calls[0][0]).toBe('stub-session');
    expect(mockStream.mock.calls[0][2]).toBe(mockStart.mock.calls[0][1]);
    expect(mockDiscard).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(output()).toContain(INPUT);
    await press('dev-new-chat');
    await type('长'.repeat(1001));
    expect(node('chat-input').props.value).toHaveLength(1000);
    await press('chat-send');
    expect(mockStart.mock.calls[1][0]).toEqual({
      roleId: 'clever-fox', message: '长'.repeat(1000), requestId: 'stub-request-2',
    });
  });

  it('allows one in-flight send despite a double press and does not queue later typing', async () => {
    const start = deferred<DevRealRequestStart>();
    mockStart.mockReturnValue(start.promise);
    await mount(); await type(INPUT);
    const sendAgain = node('chat-send').props.onPress;
    await act(async () => { sendAgain(); sendAgain(); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(node('chat-send').props.disabled).toBe(true);
    await type('虚构场景：不得自动排队发送的下一句');
    await act(async () => { sendAgain(); node('chat-send').props.onPress(); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    await act(async () => { start.resolve({ ...RECEIPT, sessionId: 'stub-session', reactionText: '', companionText: '' }); });
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(node('chat-send').props.disabled).toBe(false);
    expect(mockStart).toHaveBeenCalledTimes(1);
    await press('dev-new-chat');
    expect(node('chat-input').props.value).toBe('');
    expect(mockStart).toHaveBeenCalledTimes(1);
    await send('虚构场景：明确发送的新一轮');
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('offers editable confirmation only after nonempty Deep completes, preserving original input and request identity', async () => {
    const stream = deferred<void>();
    let callbacks!: DevRealRequestCallbacks;
    mockStream.mockImplementation(async (_session, next) => { callbacks = next; await stream.promise; });
    await mount(); await send();
    expect(output()).not.toContain('即时回应（不是 Deep）');
    expect(output()).toContain('正在思考');
    expect(output()).not.toContain('陪伴回应（不是 Deep）');
    expectNoCandidate();
    await act(async () => { callbacks.onDeepChunk(DEEP_REPLY); });
    expect(output()).not.toContain(DEEP_REPLY);
    expect(output()).toContain('正在思考');
    expectNoCandidate();
    await type('发送后修改的输入不能替换原始输入');
    await act(async () => { callbacks.onDone(); stream.resolve(); });
    expect(output()).toContain(DEV_REAL_REQUEST_SOURCE_NOTICE);
    expect(output()).toContain(DEEP_REPLY);
    expect(output()).not.toContain('正在思考');
    expect(tree.root.findByType(MessageListView).props.messages.filter((message: { role: string }) => message.role === 'assistant')).toHaveLength(1);
    expect(nodes('parent-draft')).toHaveLength(1);
    expect(nodes('candidate-confirm')).toHaveLength(1);
    expect(nodes('candidate-edit')).toHaveLength(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    await press('candidate-edit');
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({ text: DEEP_REPLY, input: INPUT, requestId: 'stub-request-1' });
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it.each(['start rejection', 'front-only completion', 'partial Deep error', 'Deep without terminal'] as const)(
    '%s cannot become a successful candidate or implicit retry', async failure => {
      if (failure === 'start rejection') mockStart.mockRejectedValue(new Error('stub start failure'));
      else mockStream.mockImplementation(async (_session, callbacks) => {
        if (failure !== 'front-only completion') callbacks.onDeepChunk('尚未成功的局部 Deep');
        if (failure === 'partial Deep error') callbacks.onError();
        if (failure === 'front-only completion') callbacks.onDone();
      });
      await mount(); await send();
      expect(mockControllers[0].getSnapshot().status).toBe('failed');
      expectNoCandidate();
      expect(node('chat-send').props.disabled).toBe(true);
      expect(output()).not.toContain(DEV_REAL_REQUEST_SOURCE_NOTICE);
      await act(async () => { node('chat-send').props.onPress(); });
      await type('不会自动重试');
      expect(mockStart).toHaveBeenCalledTimes(1);
      await press('dev-new-chat');
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(node('chat-input').props.value).toBe('');
    },
  );

  it('stop during start aborts it, discards the draft and ignores a late session', async () => {
    const start = deferred<DevRealRequestStart>();
    mockStart.mockReturnValue(start.promise);
    await mount(); await send(); mockDiscard.mockClear();
    const signal = mockStart.mock.calls[0][1];
    await press('dev-stop');
    expect(signal.aborted).toBe(true);
    expect(mockDiscard).toHaveBeenCalledTimes(1);
    expect(output()).toContain(DEV_REAL_REQUEST_STOP_NOTICE);
    await act(async () => { start.resolve({ ...RECEIPT, sessionId: 'late-session', reactionText: '迟到回应', companionText: '' }); });
    expect(mockStream).not.toHaveBeenCalled();
    expect(output()).not.toContain('迟到回应');
    expectNoCandidate();
    expect(node('chat-send').props.disabled).toBe(true);
    await press('dev-new-chat');
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(node('chat-input').props.value).toBe('');
  });

  it('stop during streaming ignores late chunks and terminals without retaining a confirmable candidate', async () => {
    const stream = deferred<void>();
    let callbacks!: DevRealRequestCallbacks;
    mockStream.mockImplementation(async (_session, next) => { callbacks = next; await stream.promise; });
    await mount(); await send();
    await act(async () => { callbacks.onDeepChunk('停止前的局部内容'); });
    expect(output()).not.toContain('停止前的局部内容');
    mockDiscard.mockClear(); await press('dev-stop');
    expect(mockDiscard).toHaveBeenCalledTimes(1);
    expect(mockStream.mock.calls[0][2].aborted).toBe(true);
    await act(async () => { callbacks.onDeepChunk('不得显示的迟到内容'); callbacks.onDone(); stream.resolve(); });
    expect(output()).not.toContain('不得显示的迟到内容');
    expect(mockControllers[0].getSnapshot().status).toBe('stopped');
    expectNoCandidate();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it.each(['new chat', 'resetKey', 'unmount'] as const)(
    '%s aborts streaming and prevents old callbacks from affecting the next generation', async exit => {
      const stream = deferred<void>();
      let callbacks!: DevRealRequestCallbacks;
      mockStream.mockImplementation(async (_session, next) => { callbacks = next; await stream.promise; });
      await mount(); await send();
      const signal = mockStream.mock.calls[0][2];
      if (exit === 'new chat') await press('dev-new-chat');
      else if (exit === 'resetKey') await update(1);
      else await unmount();
      expect(signal.aborted).toBe(true);
      const oldSnapshot = mockControllers[0].getSnapshot();
      await act(async () => { callbacks.onDeepChunk('旧请求的迟到 Deep'); callbacks.onDone(); stream.resolve(); });
      expect(mockControllers[0].getSnapshot()).toEqual(oldSnapshot);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledTimes(1);
      if (mounted) {
        expect(output()).not.toContain('旧请求的迟到 Deep');
        expect(node('chat-input').props.value).toBe('');
        expectNoCandidate();
      }
    },
  );

  it.each(['candidate-reject', 'candidate-unsure', 'candidate-stop'])(
    '%s discards a successful candidate without confirming it or sending again', async choice => {
      await mount(); await send(); mockDiscard.mockClear();
      await press(choice);
      expect(mockDiscard).toHaveBeenCalledTimes(1);
      expectNoCandidate();
      expect(node('chat-input').props.value).toBe('');
      expect(mockControllers[0].getSnapshot().status).toBe('idle');
      expect(mockStart).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['new chat', 'resetKey', 'unmount'] as const)(
    'queued old confirmation is refused after %s', async exit => {
      await mount(); await send();
      const staleConfirm = node('candidate-confirm').props.onPress;
      if (exit === 'new chat') await press('dev-new-chat');
      else if (exit === 'resetKey') await update(1);
      else await unmount();
      await act(async () => { staleConfirm(); });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['new chat', 'resetKey', 'unmount'] as const)(
    'queued old send is refused after %s', async exit => {
      await mount(); await type(INPUT);
      const staleSend = node('chat-send').props.onPress;
      if (exit === 'new chat') await press('dev-new-chat');
      else if (exit === 'resetKey') await update(1);
      else await unmount();
      await act(async () => { staleSend(); });
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockStream).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    },
  );
  it('continues explicit same-session turns in the shared UI but confirms only selected current input and reply', async () => {
    await mount(); await send(INPUT);
    const second = '虚构场景：接着上一条，我想说的是明天的安排。';
    await send(second);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockStart.mock.calls[1][0]).toEqual({ roleId: 'clever-fox', message: second, requestId: 'stub-request-2',
      devConversationId: 'dev-conversation', afterRequestId: 'stub-request-1' });
    expect(output()).toContain(INPUT); expect(output()).toContain(second);
    expect(mockConfirm).not.toHaveBeenCalled();
    await press('candidate-confirm');
    expect(mockConfirm).toHaveBeenCalledWith({ text: DEEP_REPLY, input: second, requestId: 'stub-request-2' });
  });

  it('passive expiry clears unsent text, raw presentation and candidate without writing a pattern', async () => {
    await mount(); await send(); await type('未发送的下一句'); mockDiscard.mockClear();
    await act(async () => { jest.advanceTimersByTime(600000); });
    expect(node('chat-input').props.value).toBe('');
    expect(output()).not.toContain(DEEP_REPLY); expect(output()).not.toContain(INPUT);
    expectNoCandidate(); expect(mockDiscard).toHaveBeenCalledTimes(1);
    expect(node('chat-send').props.disabled).toBe(true); expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('pagehide ends context; ordinary browser blur has no registered ending handler', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const listeners = new Map<string, () => void>();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    } });
    try {
      await mount(); await send();
      expect(listeners.has('blur')).toBe(false);
      await act(async () => { listeners.get('pagehide')?.(); });
      expectNoCandidate(); expect(node('chat-input').props.value).toBe('');
      expect(output()).not.toContain(DEEP_REPLY); expect(mockStart).toHaveBeenCalledTimes(1);
      await unmount();
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else delete (globalThis as any).window;
    }
  });

  it.each(['throw', 'invalid'] as const)('retryable %s request-ID preflight preserves unsent text until an accepted send', async failure => {
    await mount(); await type(INPUT); mockDiscard.mockClear(); mockRequestIdFailure = failure;
    await press('chat-send');
    expect(node('chat-input').props.value).toBe(INPUT);
    expect(node('chat-send').props.disabled).toBe(false);
    expect(output()).toContain('无法生成有效请求标识');
    expect(mockStart).not.toHaveBeenCalled(); expect(mockStream).not.toHaveBeenCalled();
    expect(mockDiscard).not.toHaveBeenCalled();
    mockRequestIdFailure = null; await press('chat-send');
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStart.mock.calls[0][0].message).toBe(INPUT);
    expect(node('chat-input').props.value).toBe(''); expect(mockDiscard).toHaveBeenCalledTimes(1);
  });

  function negotiateRetry() {
    mockStart.mockResolvedValue({ ...RECEIPT, sessionId: 'stub-session', reactionText: '', companionText: '',
      devReplyContract: 'dev-reply-practice-v1', devRetryContract: 'dev-manual-retry-v1' });
  }
  it('retains one failed user bubble and independent draft through manual retry; no false candidate', async () => {
    negotiateRetry();
    const pending = deferred<void>(); let failed!: DevRealRequestCallbacks;
    mockStream.mockImplementationOnce(async (_s, cb) => { failed = cb; await pending.promise; });
    await mount(); await send(); await type('另一条尚未发送的草稿');
    await act(async () => { failed.onDeepChunk('不应展示的片段'); failed.onError('retry_turn'); pending.resolve(); });
    expect(output()).toContain('刚才的回复没有完成，可以重试'); expect(output()).not.toContain('不应展示的片段');
    expect(node('chat-input').props.value).toBe('另一条尚未发送的草稿'); expectNoCandidate();
    expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(1);
    const success = deferred<void>(); let completed!: DevRealRequestCallbacks;
    mockStream.mockImplementationOnce(async (_s, cb) => { completed = cb; await success.promise; });
    await press('dev-retry'); expect(nodes('dev-retry')).toHaveLength(0);
    expect(node('chat-input').props.value).toBe('另一条尚未发送的草稿');
    expect(mockStart.mock.calls[1][0]).toEqual({ roleId: 'clever-fox', message: INPUT, requestId: 'stub-request-2', retryOfRequestId: 'stub-request-1' });
    expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(1);
    await act(async () => {
      completed.onDeepChunk(DEEP_REPLY); completed.onDone({ contract: 'dev-reply-practice-v1', reply: DEEP_REPLY, practiceCandidate: null,
        source: { sessionId: 'stub-session', devConversationId: RECEIPT.devConversationId, requestId: 'stub-request-2' } }); success.resolve();
    });
    expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(2);
    expect(tree.root.findByType(MessageListView).props.messages[0].id).toBe('stub-request-1-user');
    expect(nodes('candidate-confirm')).toHaveLength(1); expect(node('chat-input').props.value).toBe('另一条尚未发送的草稿');
  });
  it('pending409 explains no new reply started and preserves the unsent draft', async () => {
    negotiateRetry(); mockStream.mockImplementationOnce(async (_s, cb) => { cb.onError('retry_turn'); });
    await mount(); await send(); await type('草稿');
    mockStart.mockRejectedValueOnce(Object.assign(new Error('safe'), { code: 'dev_retry_pending' }));
    await press('dev-retry'); expect(output()).toContain('本次点击没有启动新的回复请求');
    expect(node('chat-input').props.value).toBe('草稿'); expect(nodes('dev-retry')).toHaveLength(1); expectNoCandidate();
    await press('dev-new-chat'); expect(node('chat-input').props.value).toBe(''); expect(nodes('dev-retry')).toHaveLength(0);
  });
  it('unconfirmed start preserves read-only bubble and unsent draft, offers no Retry, then End clears all', async () => {
    const pending = deferred<DevRealRequestStart>(); mockStart.mockReturnValueOnce(pending.promise);
    await mount(); await send(); await type('草稿');
    await act(async () => { pending.reject(Object.assign(new Error('safe'), { code: 'dev_start_unconfirmed' })); });
    expect(node('chat-input').props.value).toBe('草稿'); expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(1);
    expect(nodes('dev-retry')).toHaveLength(0); expect(output()).toContain('暂不能重试'); expectNoCandidate();
    await press('dev-end-chat'); expect(node('chat-input').props.value).toBe(''); expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(0);
  });
  it.each(['dev-end-chat', 'dev-new-chat'])('%s clears recovery and draft without another send', async id => {
    negotiateRetry(); mockStream.mockImplementationOnce(async (_s, cb) => { cb.onError('retry_turn'); });
    await mount(); await send(); await type('草稿'); await press(id);
    expect(node('chat-input').props.value).toBe(''); expect(nodes('dev-retry')).toHaveLength(0);
    expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(0); expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('recoverable state expires at the original ten-minute boundary and clears independent draft', async () => {
    negotiateRetry(); mockStream.mockImplementationOnce(async (_s, cb) => { cb.onError('retry_turn'); });
    await mount(); await send(); await type('草稿');
    await act(async () => { jest.advanceTimersByTime(600000); });
    expect(node('chat-input').props.value).toBe(''); expect(nodes('dev-retry')).toHaveLength(0);
    expect(tree.root.findByType(MessageListView).props.messages).toHaveLength(0);
  });
  it('unmount invalidates a queued Retry callback and cannot send again', async () => {
    negotiateRetry(); mockStream.mockImplementationOnce(async (_s, cb) => { cb.onError('retry_turn'); });
    await mount(); await send(); const queued = node('dev-retry').props.onPress;
    await unmount(); await act(async () => { queued(); });
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockControllers[0].getSnapshot().inputText).toBe('');
  });

});
