import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import { createDemoRepository, DEMO_NUMBER, STORAGE_KEY, type Snapshot, type PatternState } from '@/features/synthetic-demo/repository';

import {
  createDevRealRequestController,
  type DevRealRequestCallbacks, type DevRealRequestInput, type DevRealRequestStart,
} from '@/features/dev-journey/realRequestController';

const mockReplace = jest.fn();
const mockCreateController = jest.fn();
const mockStart = jest.fn<Promise<DevRealRequestStart>, [DevRealRequestInput, AbortSignal]>();
const mockEnd = jest.fn();
const mockStream = jest.fn<Promise<void>, [string, DevRealRequestCallbacks, AbortSignal]>();
const DEEP_REPLY = '这是测试传输返回的 Deep：先确认自己的需要，再选择下一步。';
const SAVE_RECEIPT = '已保存到此浏览器中你选择的模式。保存不会开启或暂停练习。';
const CURRENT_INPUT = '虚构场景：我准备先停下来想一想。';
jest.mock('@/features/dev-journey/realRequestAdapter', () => ({
  createDevRealRequestControllerForRuntime: () => mockCreateController(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }), useFocusEffect: (callback: () => () => void) => require('react').useEffect(callback, [callback]) }));

// Render the actual screen, controller and shared chat views; stub only platform hosts and transport.
// No live ChatProvider, auth helper, history, recording, external images or APIs are mounted.
// Unlike a plain Modal host mock, this respects visibility for user-facing assertions.
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    Platform: { OS: 'web' }, View: host('View'), Text: host('Text'),
    TextInput: host('TextInput'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Image: host('Image'), ActivityIndicator: host('ActivityIndicator'),
    TouchableOpacity: host('TouchableOpacity'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
  };
});
jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: (props: any) => require('react').createElement('Icon', props),
  Ionicons: (props: any) => require('react').createElement('Icon', props),
}));
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: any) => require('react').createElement('Screen', null, children),
}));

describe('EF-378 actual host, conversation, candidate editor, controller and repository', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failWrites: boolean;
  let a: string, b: string, account: string;
  let repo: ReturnType<typeof createDemoRepository>;
  let offer: { ifCue: string; thenAction: string } | null;
  let lastCallbacks: DevRealRequestCallbacks;
  let failRequestId: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let listeners: Map<string, (event: any) => void>;
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;

  beforeEach(() => {
    mounted = false;
    jest.useFakeTimers();
    mockReplace.mockClear();
    mockCreateController.mockReset(); mockEnd.mockReset().mockResolvedValue(undefined); failRequestId = false;
    mockStart.mockReset().mockResolvedValue({
      devReplyContract: 'dev-reply-practice-v1', devConversationId: 'dev-conversation', expiresAt: 700000, remainingLifetimeMs: 600000, sessionId: 'stub-session', reactionText: '前层即时回应', companionText: '前层陪伴回应',
    });
    mockStream.mockReset().mockImplementation(async (_session, callbacks) => {
      lastCallbacks = callbacks;
      callbacks.onDeepChunk(DEEP_REPLY);
      callbacks.onDone({ contract: 'dev-reply-practice-v1', reply: DEEP_REPLY, practiceCandidate: offer, source: { sessionId: _session, devConversationId: 'dev-conversation', requestId: mockStart.mock.calls.at(-1)![0].requestId } });
    });
    let requestSequence = 0;
    mockCreateController.mockImplementation(() => createDevRealRequestController({
      enabled: true, transport: { start: mockStart, stream: mockStream, end: mockEnd },
      createRequestId: () => {
        if (failRequestId) throw new Error('synthetic request-ID failure');
        return `stub-request-${++requestSequence}`;
      },
    }));
    values = new Map();
    failWrites = false;
    storage = {
      getItem: jest.fn((key: string) => values.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        if (failWrites) throw new Error('Injected storage write failure');
        values.set(key, value);
      }),
    };
    offer = { ifCue: '虚构触发线索', thenAction: '虚构的新动作' };
    repo = createDemoRepository(storage); account = repo.login(repo.requestCode(DEMO_NUMBER)).session!;
    a = repo.createPattern(account, '本地理解 A').patterns[0].pattern.patternId;
    b = repo.createPattern(account, '本地理解 B').patterns[1].pattern.patternId;
    repo.updatePattern(account, a, { name: '明确模式 A' }, 1);
    repo.updatePattern(account, b, { name: '明确模式 B' }, 1);
    storage.setItem.mockClear();
    oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    listeners = new Map();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage,
      addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    } });
    oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(async () => {
    if (mounted) await act(async () => { tree.unmount(); });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete (globalThis as any).window;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function mount() {
    await act(async () => { tree = renderer.create(<SyntheticDemoScreen />); });
    mounted = true;
  }
  // Filtering host nodes avoids matching both Button/Field and their rendered controls.
  function nodes(id: string): ReactTestInstance[] {
    return tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  }
  function node(id: string, index = 0) {
    const result = nodes(id)[index];
    if (!result) throw new Error(`Missing visible native control: ${id}[${index}]`);
    return result;
  }
  async function press(id: string, index = 0) {
    const control = node(id, index);
    expect(control.props.disabled).not.toBe(true);
    await act(async () => { control.props.onPress(); });
  }
  async function type(id: string, text: string) {
    await act(async () => { node(id).props.onChangeText(text); });
  }
  function output() { return JSON.stringify(tree.toJSON()); }
  function saved(): Snapshot { return JSON.parse(values.get(STORAGE_KEY)!); }
  async function login() {
    await press('get-code');
    const displayed = node('displayed-code').children.join('');
    const code = displayed.match(/\d{6}/)?.[0];
    expect(code).toBeDefined();
    await type('code', code!);
    await press('login');
  }
  async function send(text = CURRENT_INPUT) {
    await type('chat-input', text); await press('chat-send');
  }
  function state(id = a) { return saved().patterns.find(item => item.pattern.patternId === id)!; }
  async function choose(id = b) { await press(`practice-candidate-target-${id}`); await press('practice-candidate-confirm-target'); }
  async function start() { await mount(); await send(); }
  it('discovery preview exposes exact saved scope without confirming or persisting it', async () => {
    await start();
    expect(nodes('candidate-text')).toHaveLength(0);
    await press('candidate-save-discovery');
    expect(node('candidate-input-preview').children.join('')).toContain(CURRENT_INPUT);
    expect(output()).toContain('保存不表示 AI 推断已被核实');
    expect(node('candidate-save').props.accessibilityLabel).toBe('确认保存这次发现');
    await type('candidate-text', '我选择保留的发现');
    expect(storage.setItem).not.toHaveBeenCalled();
    await press('candidate-cancel');
    expect(nodes('candidate-text')).toHaveLength(0);
    expect(nodes('practice-candidate-card')).toHaveLength(1);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('practice is editable without any saved discovery or understanding confirmation', async () => {
    values.clear(); repo = createDemoRepository(storage); account = repo.login(repo.requestCode(DEMO_NUMBER)).session!;
    storage.setItem.mockClear(); await start();
    expect(saved().patterns).toHaveLength(0);
    expect(nodes('candidate-text')).toHaveLength(0);
    expect(nodes('practice-candidate-card')).toHaveLength(1);
    await type('practice-candidate-action', '我自行选择的可选动作');
    expect(node('practice-candidate-action').props.value).toBe('我自行选择的可选动作');
    expect(output()).toContain('无需先保存理解');
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    await press('practice-candidate-skip');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(saved().patterns).toHaveLength(0);
  });
  it('normal receipts display the candidate without a dropped-suggestion notice', async () => {
    await start();
    expect(nodes('practice-candidate-card')).toHaveLength(1);
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('a changed account at receipt does not display the old candidate or its notice', async () => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementation(async (...args) => { repo.logout(); await transport(...args); });
    await start();
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it.each(['dev-end-chat', 'dev-new-chat', 'nav-me'])('%s clears a failed-receipt notice without restoring the candidate', async id => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementation(async (...args) => {
      storage.getItem.mockImplementation(() => { throw new Error('synthetic read failure'); });
      await transport(...args);
    });
    await start(); expect(output()).toContain('本轮 AI 练习建议未显示');
    storage.getItem.mockImplementation((key: string) => values.get(key) ?? null);
    await press(id);
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
  });
  it('account replacement clears a failed-receipt notice', async () => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementation(async (...args) => {
      repo.updatePattern(account, a, { name: '另一页面更新的模式名称' }, state(a).pattern.version);
      await transport(...args);
    });
    await start(); expect(output()).toContain('本轮 AI 练习建议未显示');
    const old = values.get(STORAGE_KEY)!; repo.logout(); const after = values.get(STORAGE_KEY)!;
    await act(async () => listeners.get('storage')!({ key: STORAGE_KEY, oldValue: old, newValue: after }));
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
  });
  it('a fresh explicit send clears the failed receipt notice rather than retrying it', async () => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementationOnce(async (...args) => {
      storage.getItem.mockImplementation(() => { throw new Error('synthetic read failure'); });
      await transport(...args);
    });
    await start(); expect(output()).toContain('本轮 AI 练习建议未显示');
    storage.getItem.mockImplementation((key: string) => values.get(key) ?? null);
    await send('虚构场景：新的明确发送');
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(nodes('practice-candidate-card')).toHaveLength(1);
    expect(mockStart).toHaveBeenCalledTimes(2); expect(mockStream).toHaveBeenCalledTimes(2);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('a terminal arriving after leaving cannot display a receipt failure notice', async () => {
    let release!: () => void;
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      await transport(...args);
    });
    await mount(); await send(); await press('nav-me');
    storage.getItem.mockImplementation(() => { throw new Error('synthetic read failure'); });
    await act(async () => release());
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('explains same-account revision drift without displaying or saving the candidate', async () => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementation(async (...args) => {
      repo.updatePattern(account, a, { name: '另一页面更新的模式名称' }, state(a).pattern.version);
      await transport(...args);
    });
    await start();
    expect(output()).toContain('本地数据已变化，本轮 AI 练习建议未显示，也未保存。请核对本地模式后再继续。');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(saved().patterns.every(item => item.practice === null)).toBe(true);
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1); // only the independent revision update
    await press('nav-me');
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
  });
  it('explains a failed receipt snapshot read without retaining or retrying the candidate', async () => {
    const transport = mockStream.getMockImplementation()!;
    mockStream.mockImplementation(async (...args) => {
      storage.getItem.mockImplementation(() => { throw new Error('synthetic read failure'); });
      await transport(...args);
    });
    await start();
    expect(output()).toContain('未能核验本地模式，本轮 AI 练习建议未显示，也未保存。请检查本地存储后再继续。');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
    storage.getItem.mockImplementation(key => values.get(key) ?? null);
    await press('dev-new-chat');
    expect(output()).not.toContain('本轮 AI 练习建议未显示');
    expect(nodes('practice-candidate-card')).toHaveLength(0);
  });
  it('keeps a same-turn edited suggestion through first-pattern creation, with a fresh explicit target choice', async () => {
    values.clear(); repo = createDemoRepository(storage); account = repo.login(repo.requestCode(DEMO_NUMBER)).session!;
    storage.setItem.mockClear(); await start();
    expect(output()).toContain('目前没有可选的已保存发现或已确认模式');
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    await type('practice-candidate-cue', '用户为首个模式编辑的线索');
    await type('practice-candidate-action', '用户为首个模式编辑的动作');
    await press('candidate-save-discovery'); await press('candidate-new-choice'); await press('candidate-save');
    const first = saved().patterns[0];
    expect(saved().patterns).toHaveLength(1); expect(first.pattern.decision).toBe('candidate');
    expect(first.practice).toBeNull(); expect(saved().activePracticePatternId).toBeNull();
    expect(node('practice-candidate-cue').props.value).toBe('用户为首个模式编辑的线索');
    expect(node('practice-candidate-action').props.value).toBe('用户为首个模式编辑的动作');
    expect(nodes(`practice-candidate-target-${first.pattern.patternId}`)).toHaveLength(1);
    expect(nodes('practice-candidate-target-review')).toHaveLength(0);
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    await choose(first.pattern.patternId); await press('practice-candidate-save');
    expect(state(first.pattern.patternId).practice).toMatchObject({
      ifCue: '用户为首个模式编辑的线索', thenAction: '用户为首个模式编辑的动作', paused: true,
      candidateOrigin: { kind: 'ai-suggestion', sessionId: 'stub-session', devConversationId: 'dev-conversation', requestId: 'stub-request-1' },
    });
    expect(state(first.pattern.patternId).path).toEqual(first.path); expect(saved().activePracticePatternId).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(2); expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
  });
  it('new-pattern save preserves edits but revokes prior target and confirmation callbacks', async () => {
    await start(); await choose(a); await type('practice-candidate-action', '同轮保留的编辑');
    const oldSave = node('practice-candidate-save').props.onPress;
    const oldConfirm = node('practice-candidate-confirm-target').props.onPress;
    const beforeA = state(a), beforeB = state(b);
    await press('candidate-save-discovery'); await press('candidate-new-choice'); await press('candidate-save');
    const created = saved().patterns[2];
    expect(node('practice-candidate-action').props.value).toBe('同轮保留的编辑');
    expect(nodes('practice-candidate-target-review')).toHaveLength(0);
    await act(async () => { oldConfirm(); oldSave(); });
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    expect(state(a)).toEqual(beforeA); expect(state(b)).toEqual(beforeB); expect(created.practice).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    await choose(created.pattern.patternId); await press('practice-candidate-save');
    expect(state(created.pattern.patternId).practice?.thenAction).toBe('同轮保留的编辑');
    expect(state(a)).toEqual(beforeA); expect(state(b)).toEqual(beforeB); expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it('failed understanding save keeps the original editor; successful retry refreshes its target choices', async () => {
    await start(); await choose(a); await type('practice-candidate-action', '失败后仍保留');
    await press('candidate-save-discovery'); await press('candidate-new-choice'); const before = saved();
    failWrites = true; await press('candidate-save');
    expect(saved()).toEqual(before); expect(node('practice-candidate-action').props.value).toBe('失败后仍保留');
    expect(node('practice-candidate-save').props.disabled).toBe(false);
    failWrites = false; await press('candidate-save');
    expect(node('practice-candidate-action').props.value).toBe('失败后仍保留');
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    expect(nodes('practice-candidate-target-review')).toHaveLength(0); expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it.each(['dev-end-chat', 'dev-new-chat', 'nav-me'])('same-turn preservation still revokes the suggestion on %s', async id => {
    await start(); await press('candidate-save-discovery'); await press('candidate-new-choice'); await press('candidate-save');
    await choose(saved().patterns[2].pattern.patternId); const oldSave = node('practice-candidate-save').props.onPress;
    const before = saved(); storage.setItem.mockClear();
    await press(id); await act(async () => oldSave());
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(saved()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it('correcting an existing understanding still invalidates its old practice editor', async () => {
    await start(); await choose(a);
    await press('candidate-save-discovery'); await press('candidate-correction-choice'); await press(`candidate-target-${a}`); await press('candidate-save');
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(state(a).practice).toBeNull();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it('a later Send replaces a preserved suggestion and cannot reuse its old save', async () => {
    await start(); await press('candidate-save-discovery'); await press('candidate-new-choice'); await press('candidate-save');
    await choose(saved().patterns[2].pattern.patternId); const staleSave = node('practice-candidate-save').props.onPress;
    const before = saved(); storage.setItem.mockClear();
    offer = { ifCue: '下一轮线索', thenAction: '下一轮动作' }; await send('虚构场景：下一轮');
    await act(async () => staleSave());
    expect(node('practice-candidate-action').props.value).toBe('下一轮动作');
    expect(node('practice-candidate-save').props.disabled).toBe(true); expect(saved()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(mockStart).toHaveBeenCalledTimes(2);
  });
  it.each(['expiry', 'safety'] as const)('%s still clears a preserved suggestion and rejects its old save', async kind => {
    await start(); await press('candidate-save-discovery'); await press('candidate-new-choice'); await press('candidate-save');
    await choose(saved().patterns[2].pattern.patternId); const staleSave = node('practice-candidate-save').props.onPress;
    const before = saved(); storage.setItem.mockClear();
    if (kind === 'expiry') await act(async () => jest.advanceTimersByTime(600001));
    else { await press('dev-safety-controls'); await press('dev-safety-unknown'); }
    await act(async () => staleSave());
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(saved()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it.each(['help', 'emergency', 'unknown'] as const)('synthetic %s clears both unsaved editors and stale saves without changing saved patterns, practice or path', async kind => {
    repo.savePractice(account, a, { ifCue: '已保存线索', thenAction: '已保存动作' }, 0);
    repo.activatePractice(account, a, 1);
    repo.saveRecord(account, a, { occurred: true, action: 'agreed', feeling: 'unchanged', note: '已保存的虚构记录' }, 2, 'saved-record');
    storage.setItem.mockClear(); const before = values.get(STORAGE_KEY)!;
    await start(); await choose(b); await type('practice-candidate-action', '未保存练习改写');
    const stalePracticeSave = node('practice-candidate-save').props.onPress;
    await press('candidate-save-discovery'); await type('candidate-text', '未保存理解改写'); await press('candidate-new-choice');
    const staleUnderstandingSave = node('candidate-save').props.onPress;
    await type('chat-input', '未发送独立草稿'); await press('dev-safety-controls');
    const safety = node(`dev-safety-${kind}`).props.onPress;
    await act(async () => { safety(); safety(); stalePracticeSave(); staleUnderstandingSave(); });
    expect(nodes('dev-safety-support')).toHaveLength(1);
    for (const id of ['practice-candidate-card', 'candidate-text', 'candidate-save', 'candidate-save-discovery', 'chat-input', 'chat-send', 'dev-retry']) expect(nodes(id)).toHaveLength(0);
    for (const text of [DEEP_REPLY, CURRENT_INPUT, '未保存练习改写', '未保存理解改写', '未发送独立草稿']) expect(output()).not.toContain(text);
    expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1); expect(mockEnd).toHaveBeenCalledWith('stub-request-1');
    await press('dev-new-chat');
    await act(async () => { stalePracticeSave(); staleUnderstandingSave(); });
    expect(node('chat-input').props.value).toBe(''); expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(nodes('candidate-save')).toHaveLength(0); expect(values.get(STORAGE_KEY)).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(mockStart).toHaveBeenCalledTimes(1);
  });
  it('renders no card by default or when the successful result has no candidate', async () => {
    offer = null; await mount(); expect(nodes('practice-candidate-card')).toHaveLength(0); await send();
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('never defaults a target; edits then explicitly saves only B with independent source and no activation/event', async () => {
    const beforeA = state(a), pathB = state(b).path; await start();
    expect(node('practice-candidate-save').props.disabled).toBe(true);
    expect(nodes('practice-candidate-target-review')).toHaveLength(0);
    await type('practice-candidate-action', '用户改写动作'); await choose();
    expect(output()).toContain('本地理解 B'); expect(output()).toContain('明确模式 B');
    expect(storage.setItem).not.toHaveBeenCalled(); await press('practice-candidate-save');
    expect(state(a)).toEqual(beforeA); expect(state(b).path).toEqual(pathB);
    expect(state(b).practice).toMatchObject({ thenAction: '用户改写动作', paused: true, candidateOrigin: { kind: 'ai-suggestion', sessionId: 'stub-session', devConversationId: 'dev-conversation', requestId: 'stub-request-1' } });
    expect(saved().activePracticePatternId).toBeNull(); expect(output()).toContain(SAVE_RECEIPT);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(createDemoRepository(storage).getPattern(account, b)).toEqual(state(b));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(nodes('practice-candidate-card')).toHaveLength(0);
    expect(JSON.stringify(mockStart.mock.calls)).not.toMatch(/本地理解|明确模式|用户改写动作/);
  });
  it.each(['practice-candidate-skip', 'practice-candidate-cancel'])('explicit %s discards without writes and rejects saved callback', async id => {
    await start(); await choose(); const save = node('practice-candidate-save').props.onPress;
    await press(id); await act(async () => save()); expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('switching A to B to A requires fresh confirmation and rejects all stale callbacks', async () => {
    await start(); await choose(a); const oldSave = node('practice-candidate-save').props.onPress;
    const oldConfirm = node('practice-candidate-confirm-target').props.onPress;
    await press(`practice-candidate-target-${b}`); await press(`practice-candidate-target-${a}`);
    await act(async () => { oldConfirm(); oldSave(); });
    expect(node('practice-candidate-save').props.disabled).toBe(true); expect(storage.setItem).not.toHaveBeenCalled();
    await press('practice-candidate-confirm-target'); await press('practice-candidate-save'); expect(state(a).practice).not.toBeNull(); expect(state(b).practice).toBeNull();
  });
  it('failed storage write keeps edited draft and retries with no false saved status', async () => {
    await start(); await choose(); await type('practice-candidate-action', '保留这个改写'); failWrites = true;
    await press('practice-candidate-save'); expect(output()).toContain('未能保存'); expect(output()).not.toContain(SAVE_RECEIPT);
    expect(node('practice-candidate-action').props.value).toBe('保留这个改写'); expect(state(b).practice).toBeNull();
    failWrites = false; await press('practice-candidate-save'); expect(state(b).practice?.thenAction).toBe('保留这个改写');
  });
  it.each(['pattern', 'practice'])('changed %s version fails closed and keeps draft', async kind => {
    await start(); await choose();
    if (kind === 'pattern') repo.updatePattern(account, b, { currentUnderstanding: '较新的理解' }, 2);
    else repo.savePractice(account, b, { ifCue: '较新线索', thenAction: '较新动作' }, 0);
    const before = saved(); await press('practice-candidate-save'); expect(saved()).toEqual(before); expect(output()).toContain('未能保存');
    expect(output()).not.toContain(SAVE_RECEIPT);
    expect(node('practice-candidate-action').props.value).toBe(offer!.thenAction);
  });
  it('overwrite warning precedes explicit save and keeps other active practice unchanged', async () => {
    repo.savePractice(account, a, { ifCue: '旧 A 线索', thenAction: '旧 A 动作' }, 0); repo.activatePractice(account, a, 1);
    repo.savePractice(account, b, { ifCue: '旧 B 线索', thenAction: '旧 B 动作' }, 0); const beforeA = state(a);
    await start(); await choose(); expect(output()).toContain('保存将替换'); expect(output()).toContain('旧 B 动作');
    await press('practice-candidate-save'); expect(state(a)).toEqual(beforeA); expect(saved().activePracticePatternId).toBe(a); expect(state(b).practice?.paused).toBe(true);
  });
  it.each([false, true])('local save receipt never toggles existing paused=%s target or sends chat', async paused => {
    repo.savePractice(account, b, { ifCue: '旧 B 线索', thenAction: '旧 B 动作' }, 0);
    if (!paused) repo.activatePractice(account, b, 1);
    const beforeA = state(a), previous = state(b).practice!;
    storage.setItem.mockClear();
    await start(); await choose();
    const save = node('practice-candidate-save').props.onPress;
    await act(async () => { save(); save(); });
    expect(output()).toContain(SAVE_RECEIPT);
    expect(state(a)).toEqual(beforeA);
    expect(state(b).practice).toMatchObject({ ...offer, paused, version: previous.version + 1 });
    expect(saved().activePracticePatternId).toBe(paused ? null : b);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(createDemoRepository(storage).getPattern(account, b)).toEqual(state(b));
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    await send('虚构场景：保存后由我继续说');
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockStart.mock.calls[1][0]).toEqual({
      roleId: 'clever-fox', message: '虚构场景：保存后由我继续说', requestId: 'stub-request-2',
      devConversationId: 'dev-conversation', afterRequestId: 'stub-request-1',
    });
    expect(JSON.stringify(mockStart.mock.calls[1][0])).not.toMatch(/已保存|此浏览器|本地理解|明确模式|虚构触发线索|虚构的新动作|paused|pattern|practice/i);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it('typing leaves edits intact; actual continuing send revokes old draft then displays a separate new candidate', async () => {
    await start(); await choose(); await type('practice-candidate-action', '旧编辑'); const oldSave = node('practice-candidate-save').props.onPress;
    await type('chat-input', '虚构场景：继续表达'); expect(node('practice-candidate-action').props.value).toBe('旧编辑'); expect(node('chat-send').props.disabled).not.toBe(true);
    offer = { ifCue: '新的线索', thenAction: '新的建议' }; await press('chat-send');
    expect(node('practice-candidate-action').props.value).toBe('新的建议'); expect(node('practice-candidate-save').props.disabled).toBe(true);
    await act(async () => oldSave()); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(['dev-end-chat', 'dev-new-chat', 'nav-me'])('%s synchronously revokes old editor even within the same React batch', async id => {
    await start(); await choose(); const oldSave = node('practice-candidate-save').props.onPress;
    const stop = node(id).props.onPress; await act(async () => { stop(); oldSave(); });
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('same-account logout/login cannot revive old save callbacks', async () => {
    await start(); await choose(); const oldSave = node('practice-candidate-save').props.onPress;
    await press('nav-me'); await press('logout'); await login(); const before = saved();
    await act(async () => oldSave()); expect(saved()).toEqual(before); expect(nodes('practice-candidate-card')).toHaveLength(0);
    await send(); await choose(); await press('practice-candidate-save'); expect(state(b).practice).not.toBeNull();
  });
  it('expiry revokes displayed edits and old save handles', async () => {
    await start(); await choose(); const oldSave = node('practice-candidate-save').props.onPress;
    await act(async () => { jest.advanceTimersByTime(600001); oldSave(); });
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('late terminal after stop cannot resurrect a candidate', async () => {
    let release!: () => void;
    mockStream.mockImplementationOnce(async (_id, callbacks) => { lastCallbacks = callbacks; await new Promise<void>(resolve => { release = resolve; }); });
    await mount(); await send(); await press('dev-stop');
    await act(async () => { lastCallbacks.onDeepChunk(DEEP_REPLY); lastCallbacks.onDone({ contract: 'dev-reply-practice-v1', reply: DEEP_REPLY, practiceCandidate: offer, source: { sessionId: 'stub-session', devConversationId: 'dev-conversation', requestId: 'stub-request-1' } }); release(); });
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('storage account-session replacement synchronously revokes the editor', async () => {
    await start(); await choose(); const oldSave = node('practice-candidate-save').props.onPress; const old = values.get(STORAGE_KEY)!;
    repo.logout(); const after = values.get(STORAGE_KEY)!;
    await act(async () => { listeners.get('storage')!({ key: STORAGE_KEY, oldValue: old, newValue: after }); oldSave(); });
    expect(nodes('practice-candidate-card')).toHaveLength(0); expect(state(b).practice).toBeNull();
  });
  it('manual editing later removes candidate attribution while keeping understanding origin unchanged', async () => {
    await start(); await choose(); await press('practice-candidate-save');
    await press('nav-me'); await press('mode-open'); await press(`pattern-open-${b}`); await press('practice-open');
    expect(nodes('practice-suggestion-source')).toHaveLength(1); await press('practice-edit'); await type('practice-action', '独立手填动作'); await press('practice-save');
    expect(state(b).practice?.candidateOrigin).toBeUndefined(); expect(nodes('practice-suggestion-source')).toHaveLength(0);
  });
  it('continuing send invalidates synchronously before an old save in the same event batch', async () => {
    await start(); await choose(); const oldSave = node('practice-candidate-save').props.onPress;
    await type('chat-input', '虚构场景：再说一件事'); const sendNow = node('chat-send').props.onPress;
    await act(async () => { sendNow(); oldSave(); }); expect(storage.setItem).not.toHaveBeenCalled();
    expect(node('practice-candidate-save').props.disabled).toBe(true);
  });
  it('candidate terminal is not displayed before transport completion, and failure cannot publish it', async () => {
    let release!: () => void;
    mockStream.mockImplementationOnce(async (_id, callbacks) => {
      callbacks.onDeepChunk(DEEP_REPLY); callbacks.onDone({ contract: 'dev-reply-practice-v1', reply: DEEP_REPLY, practiceCandidate: offer, source: { sessionId: 'stub-session', devConversationId: 'dev-conversation', requestId: 'stub-request-1' } });
      await new Promise<void>(resolve => { release = resolve; }); throw Error('injected transport failure');
    });
    await mount(); await send(); expect(nodes('practice-candidate-card')).toHaveLength(0);
    await act(async () => release()); expect(nodes('practice-candidate-card')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('a preflight failure does not replace an edited suggestion or write it', async () => {
    await start(); await type('practice-candidate-action', '保留已编辑建议'); failRequestId = true;
    await send('虚构场景：继续'); expect(node('practice-candidate-action').props.value).toBe('保留已编辑建议'); expect(storage.setItem).not.toHaveBeenCalled();
  });

});
