import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import { createDemoRepository, DEMO_NUMBER, STORAGE_KEY, type Snapshot } from '@/features/synthetic-demo/repository';

import {
  createDevRealRequestController,
  type DevRealRequestCallbacks, type DevRealRequestInput, type DevRealRequestStart,
} from '@/features/dev-journey/realRequestController';

const mockReplace = jest.fn();
const mockCreateController = jest.fn();
const mockStart = jest.fn<Promise<DevRealRequestStart>, [DevRealRequestInput, AbortSignal]>();
const mockStream = jest.fn<Promise<void>, [string, DevRealRequestCallbacks, AbortSignal]>();
const DEEP_REPLY = '这是测试传输返回的 Deep：先确认自己的需要，再选择下一步。';
const CURRENT_INPUT = '虚构场景：我准备先停下来想一想。';
jest.mock('@/features/dev-journey/realRequestAdapter', () => ({
  createDevRealRequestControllerForRuntime: () => mockCreateController(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

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

describe('EF-385 native journey with the real controller, views and local repository', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failWrites: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;

  beforeEach(() => {
    mounted = false;
    jest.useFakeTimers();
    mockReplace.mockClear();
    mockCreateController.mockReset();
    mockStart.mockReset().mockResolvedValue({
      sessionId: 'stub-session', reactionText: '前层即时回应', companionText: '前层陪伴回应',
    });
    mockStream.mockReset().mockImplementation(async (_session, callbacks) => {
      callbacks.onDeepChunk(DEEP_REPLY); callbacks.onDone();
    });
    let requestSequence = 0;
    mockCreateController.mockImplementation(() => createDevRealRequestController({
      enabled: true, transport: { start: mockStart, stream: mockStream },
      createRequestId: () => `stub-request-${++requestSequence}`,
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
    oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
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
  async function confirm() {
    await press('nav-chat'); await send(); await press('candidate-confirm'); await press('candidate-save');
  }
  async function mode() { await press('nav-me'); await press('mode-open'); }
  async function practice() { await mode(); await press('practice-open'); }
  async function setupPractice() {
    await mount(); await login(); await confirm(); await practice();
    await press('practice-edit');
    expect(node('practice-cue').props.value).toBe('');
    expect(node('practice-action').props.value).toBe('');
    await type('practice-cue', '虚构线索'); await type('practice-action', '停十秒');
    await press('practice-save');
  }
  async function recordOther() {
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-other');
    await press('record-feeling-not_recorded'); await type('record-note', '虚构记录');
  }
  function seedLegacyJourney() {
    const legacy = createDemoRepository(storage);
    legacy.login(legacy.requestCode(DEMO_NUMBER));
    legacy.confirmPattern('原有的合成理解');
    const practice = legacy.savePractice({ ifCue: '旧线索', thenAction: '旧动作' }, 0).practice!;
    return legacy.saveRecord({ occurred: true, action: 'agreed', feeling: 'helped', note: '旧记录' }, practice.version, 'legacy-record');
  }

  it('mount, login, navigation, new chat, logout and refresh never start a request', async () => {
    await mount();
    expect(storage.setItem).not.toHaveBeenCalled();
    await press('nav-me'); await press('nav-chat'); await login();
    expect(node('chat-input').props.value).toBe('');
    expect(node('chat-send').props.disabled).toBe(true);
    await type('chat-input', CURRENT_INPUT);
    await press('dev-new-chat');
    expect(node('chat-input').props.value).toBe('');
    await press('nav-me'); await press('nav-chat');
    await act(async () => { tree.unmount(); }); mounted = false;
    await mount();
    expect(node('chat-input').props.value).toBe('');
    await press('nav-me'); await press('logout'); await login();
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
    // The host mock uses RN names outside React's DOM intrinsic-name union.
    expect(tree.root.findAll(node => typeof node.type === 'string' && (node.type as string) === 'Image')).toHaveLength(0);
  });

  it('keeps Deep volatile until an edited local confirmation saves it once with request provenance', async () => {
    await mount(); await login();
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await send(`  ${CURRENT_INPUT}  `);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toEqual({
      roleId: 'clever-fox', message: CURRENT_INPUT, requestId: 'stub-request-1',
    });
    expect(values.get(STORAGE_KEY)).toBe(before);
    expect(saved().pattern).toBeNull();
    expect(saved().path).toEqual([]);
    await press('candidate-edit');
    expect(node('candidate-text').props.value).toBe(DEEP_REPLY);
    expect(nodes('candidate-correction-choice')).toHaveLength(0);
    expect(node('candidate-save').props.disabled).toBe(false);
    await type('candidate-text', '这是我编辑后愿意保留的理解。');
    expect(storage.setItem).not.toHaveBeenCalled();
    const save = node('candidate-save').props.onPress;
    await act(async () => { save(); save(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(saved().pattern).toMatchObject({
      currentUnderstanding: '这是我编辑后愿意保留的理解。', decision: 'confirmed',
      demoSource: 'dev-api-test', origin: { input: CURRENT_INPUT, requestId: 'stub-request-1' },
    });
    expect(saved().path).toHaveLength(1);
    expect(saved().path[0]).toMatchObject({ demoSource: 'dev-api-test', userConfirmed: true });
    expect(saved().path[0].fact).toContain(CURRENT_INPUT);
    expect(saved().path[0].source).toContain('未核验');
    expect(saved().practice).toBeNull();
    expect(saved().records).toEqual([]);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('a failed candidate save retains its edit and a new request clears the prior saved notice', async () => {
    await mount(); await login(); await send(); await press('candidate-confirm');
    await type('candidate-text', '本地修改仍应保留');
    const before = values.get(STORAGE_KEY); failWrites = true;
    await press('candidate-save');
    expect(values.get(STORAGE_KEY)).toBe(before);
    expect(node('candidate-text').props.value).toBe('本地修改仍应保留');
    expect(output()).toContain('未保存，原内容未改变');
    failWrites = false; await press('candidate-save');
    expect(output()).toContain('已保存到此浏览器的演示空间。');
    const after = values.get(STORAGE_KEY); storage.setItem.mockClear();
    let finishStart!: (value: DevRealRequestStart) => void;
    mockStart.mockReturnValueOnce(new Promise<DevRealRequestStart>(resolve => { finishStart = resolve; }));
    await press('dev-new-chat'); await send('虚构场景：另一个没有保存的请求。');
    expect(nodes('dev-stop')).toHaveLength(1);
    expect(output()).not.toContain('已保存到此浏览器的演示空间。');
    expect(values.get(STORAGE_KEY)).toBe(after);
    expect(storage.setItem).not.toHaveBeenCalled();
    await act(async () => { finishStart({ sessionId: 'second-session', reactionText: '', companionText: '' }); });
    expect(output()).not.toContain('已保存到此浏览器的演示空间。');
  });

  it('navigation aborts the pending stream and ignores late Deep without creating a draft or write', async () => {
    let callbacks!: DevRealRequestCallbacks;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    mockStream.mockImplementation(async (_session, next) => { callbacks = next; await pending; });
    await mount(); await login();
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await send();
    expect(nodes('dev-stop')).toHaveLength(1);
    const signal = mockStream.mock.calls[0][2];
    await press('nav-me');
    expect(signal.aborted).toBe(true);
    await act(async () => { callbacks.onDeepChunk('已离开页面后的内容'); callbacks.onDone(); finish(); });
    await press('nav-chat');
    expect(output()).not.toContain('已离开页面后的内容');
    expect(nodes('candidate-confirm')).toHaveLength(0);
    expect(nodes('candidate-save')).toHaveLength(0);
    expect(node('chat-input').props.value).toBe('');
    expect(values.get(STORAGE_KEY)).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('restores legacy records and preserves their facts when the user explicitly chooses a same-pattern correction', async () => {
    const before = seedLegacyJourney();
    storage.setItem.mockClear();
    await mount();
    expect(mockStart).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    await mode(); await press('path-open');
    expect(output()).toContain('旧记录');
    expect(output()).toContain('历史合成示例');
    await press('nav-chat'); await send(); await press('candidate-confirm');
    expect(node('candidate-correction-choice').props.accessibilityRole).toBe('checkbox');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(false);
    expect(node('candidate-save').props.disabled).toBe(true);
    expect(output()).toContain('保留当前练习');
    await press('candidate-correction-choice');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(true);
    expect(node('candidate-save').props.disabled).toBe(false);
    await press('candidate-save');
    const after = saved();
    expect(after.records).toEqual(before.records);
    expect(after.practice).toEqual(before.practice);
    for (const entry of before.path) {
      expect(after.path.find(item => item.entryId === entry.entryId)).toEqual(entry);
    }
    expect(after.pattern?.demoSource).toBe('dev-api-test');
    expect(after.pattern?.currentUnderstanding).toBe(DEEP_REPLY);
    expect(after.pattern?.patternId).toBe(before.pattern?.patternId);
    expect(after.pattern?.name).toBe(before.pattern?.name);
    expect(after.path.some(entry => entry.demoSource === 'dev-api-test')).toBe(true);
    expect(after.path.some(entry => entry.type === 'exception')).toBe(false);
    expect([...values.keys()]).toEqual([STORAGE_KEY]);
  });

  it('an unrelated Deep reply cannot overwrite an existing mode, practice or records without correction consent', async () => {
    const before = seedLegacyJourney();
    const persisted = values.get(STORAGE_KEY);
    mockStream.mockImplementation(async (_session, callbacks) => {
      callbacks.onDeepChunk('虚构旅行建议：比较两个目的地的交通时间。'); callbacks.onDone();
    });
    storage.setItem.mockClear();
    await mount(); await send('虚构场景：我想比较两个旅行目的地。');
    await press('candidate-confirm');
    expect(node('candidate-text').props.value).toBe('虚构旅行建议：比较两个目的地的交通时间。');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(false);
    expect(node('candidate-save').props.disabled).toBe(true);
    expect(output()).toContain('不同话题请取消');
    expect(output()).toContain('本版只保留一个模式');
    const directSave = node('candidate-save').props.onPress;
    // UI disabling alone is insufficient: the repository must reject this too.
    await act(async () => { directSave(); });
    expect(output()).toContain('不会自动关联新话题');
    expect(saved()).toEqual(before);
    expect(values.get(STORAGE_KEY)).toBe(persisted);
    expect(storage.setItem).not.toHaveBeenCalled();
    await press('candidate-cancel');
    await act(async () => { directSave(); });
    expect(nodes('candidate-save')).toHaveLength(0);
    expect(saved()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    await mode();
    expect(output()).toContain('原有的合成理解');
    expect(output()).not.toContain('虚构旅行建议');
    await press('path-open');
    expect(output()).toContain('旧记录');
    expect(output()).toContain('历史合成示例');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('correction consent can be withdrawn and never carries into a reopened draft or new request', async () => {
    const before = seedLegacyJourney(); storage.setItem.mockClear();
    await mount(); await send(); await press('candidate-edit');
    await press('candidate-correction-choice');
    expect(node('candidate-save').props.disabled).toBe(false);
    const previouslyEnabledSave = node('candidate-save').props.onPress;
    await press('candidate-correction-choice');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(false);
    expect(node('candidate-save').props.disabled).toBe(true);
    await act(async () => { previouslyEnabledSave(); });
    expect(saved()).toEqual(before);
    await press('candidate-correction-choice'); await press('candidate-cancel');
    await press('candidate-confirm');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(false);
    expect(node('candidate-save').props.disabled).toBe(true);
    await press('candidate-cancel'); await press('dev-new-chat');
    await send('虚构场景：新的一轮仍需要单独确认。'); await press('candidate-confirm');
    expect(node('candidate-correction-choice').props.accessibilityState.checked).toBe(false);
    expect(node('candidate-save').props.disabled).toBe(true);
    await act(async () => { previouslyEnabledSave(); });
    expect(saved()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('completes authentication → candidate → mode → practice → record → path, then restores through logout/login and a fresh runtime', async () => {
    await mount();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(node('number').props.editable).toBe(false);
    await login(); await confirm(); await mode();
    await press('pattern-edit'); await type('pattern-name', '虚构的新名称');
    await type('pattern-understanding', '我想先停一下'); await press('pattern-save');
    await press('practice-open'); await press('practice-edit');
    await type('practice-cue', '虚构线索'); await type('practice-action', '停十秒'); await press('practice-save');
    await recordOther(); await press('record-save');
    expect(saved().records).toHaveLength(1);
    expect(saved().records[0]).toMatchObject({ occurred: true, action: 'other', feeling: 'not_recorded', note: '虚构记录' });
    expect(saved().path.filter(entry => entry.type === 'exception')).toHaveLength(0);
    await press('path-open');
    expect(output()).toContain('做了其他动作'); expect(output()).toContain('暂不记录');
    const before = saved();
    await press('path-edit'); await type('path-explanation', '虚构解释'); await type('path-feeling', '虚构感受'); await press('path-save');
    const after = saved();
    const edited = after.path.find(entry => entry.explanation === '虚构解释')!;
    expect(edited).toBeDefined();
    expect(edited).toMatchObject({ fact: before.path.find(entry => entry.entryId === edited.entryId)!.fact,
      source: before.path.find(entry => entry.entryId === edited.entryId)!.source, feeling: '虚构感受' });
    expect(after.records).toEqual(before.records);
    await press('nav-me'); await press('logout');
    expect(saved().session).toBeNull();
    expect(createDemoRepository(storage).snapshot().records).toEqual([]);
    await login(); await mode();
    expect(output()).toContain('虚构的新名称');
    await act(async () => { tree.unmount(); }); mounted = false;
    await mount(); await mode();
    expect(output()).toContain('我想先停一下');
    expect(createDemoRepository(storage).snapshot().records).toEqual(after.records);
    expect([...values.keys()]).toEqual([STORAGE_KEY]);
  });

  it('cancel, stop, reject, unsure and navigation never commit candidate drafts', async () => {
    await mount(); await login();
    const persisted = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await send(); await press('candidate-edit'); await type('candidate-text', '未保存'); await press('candidate-cancel');
    await press('candidate-stop');
    for (const choice of ['candidate-reject', 'candidate-unsure']) {
      await send(); await press('candidate-edit'); await type('candidate-text', '仍然不保存');
      const staleSave = node('candidate-save').props.onPress;
      await press(choice);
      expect(nodes('candidate-confirm')).toHaveLength(0);
      expect(nodes('candidate-save')).toHaveLength(0);
      await act(async () => { staleSave(); });
    }
    await send(); await press('candidate-confirm'); await press('nav-me'); await press('nav-chat');
    expect(nodes('candidate-save')).toHaveLength(0);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(values.get(STORAGE_KEY)).toBe(persisted);
  });

  it('requires an explicit occurrence answer and shows feelings only after an eligible action', async () => {
    await setupPractice(); await press('record-open');
    expect(node('record-occurred-no').props.accessibilityState.checked).toBe(false);
    expect(node('record-occurred-yes').props.accessibilityState.checked).toBe(false);
    expect(node('record-save').props.disabled).toBe(true);
    expect(nodes('record-action-other')).toHaveLength(0); expect(nodes('record-feeling-helped')).toHaveLength(0);
    // Even a stale/direct handler call must not save an unanswered occurrence.
    const before = values.get(STORAGE_KEY);
    await act(async () => { node('record-save').props.onPress(); });
    expect(values.get(STORAGE_KEY)).toBe(before);
    await press('record-occurred-yes');
    expect(nodes('record-feeling-helped')).toHaveLength(0); expect(node('record-save').props.disabled).toBe(true);
    await press('record-action-agreed'); await press('record-feeling-helped');
    await press('record-action-other');
    expect(node('record-feeling-helped').props.accessibilityState.checked).toBe(false);
    expect(node('record-save').props.disabled).toBe(true);
    await press('record-action-none');
    expect(nodes('record-feeling-helped')).toHaveLength(0);
    await press('record-save');
    expect(saved().records[0]).toMatchObject({ occurred: true, action: 'none', feeling: null });
    expect(saved().path.some(entry => entry.type === 'exception')).toBe(false);
  });

  it('clears action/feeling on occurrence changes and saves not-occurred without a failure or exception', async () => {
    await setupPractice(); await recordOther(); await press('record-occurred-no');
    expect(nodes('record-action-other')).toHaveLength(0); expect(nodes('record-feeling-not_recorded')).toHaveLength(0);
    await press('record-save');
    expect(saved().records[0]).toMatchObject({ occurred: false, action: null, feeling: null });
    expect(saved().path.every(entry => entry.type !== 'exception')).toBe(true);
  });

  it('BQA-01: editing dismisses previous success; failed save keeps the exact draft and retry saves once', async () => {
    await setupPractice();
    expect(output()).toContain('已保存到此浏览器的演示空间。');
    await recordOther();
    expect(output()).not.toContain('已保存到此浏览器的演示空间。');
    const before = values.get(STORAGE_KEY); failWrites = true;
    await press('record-save');
    expect(values.get(STORAGE_KEY)).toBe(before);
    expect(node('record-note').props.value).toBe('虚构记录');
    expect(node('record-action-other').props.accessibilityState.checked).toBe(true);
    expect(node('record-feeling-not_recorded').props.accessibilityState.checked).toBe(true);
    expect(output()).toContain('未保存，原内容未改变');
    expect(output()).not.toContain('已保存到此浏览器的演示空间。');
    failWrites = false;
    const save = node('record-save').props.onPress;
    storage.setItem.mockClear();
    await act(async () => { save(); save(); });
    expect(saved().records).toHaveLength(1);
    expect(saved().path.filter(entry => entry.type === 'practice')).toHaveLength(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(nodes('record-save')).toHaveLength(0);
  });

  it('record cancellation, skip and navigation discard drafts without writes', async () => {
    await setupPractice();
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await recordOther(); await press('record-cancel');
    await practice(); await recordOther(); await press('record-skip');
    await recordOther(); await press('nav-me'); await practice();
    await press('record-open');
    expect(node('record-note').props.value).toBe(''); expect(node('record-save').props.disabled).toBe(true);
    expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('unlink needs confirmation, cancel is read-only, failed writes preserve the dialog, and retry retains immutable facts', async () => {
    await mount(); await login(); await confirm(); await mode(); await press('path-open');
    const before = saved(); storage.setItem.mockClear();
    await press('path-remove'); await press('path-remove-cancel');
    expect(storage.setItem).not.toHaveBeenCalled(); expect(saved()).toEqual(before);
    expect(nodes('path-remove-confirm')).toHaveLength(0);
    await press('path-remove'); failWrites = true; await press('path-remove-confirm');
    expect(saved()).toEqual(before); expect(nodes('path-remove-confirm')).toHaveLength(1);
    expect(output()).toContain('未保存，原内容未改变');
    failWrites = false; await press('path-remove-confirm');
    expect(saved().path).toHaveLength(before.path.length);
    expect(saved().path[0]).toEqual({ ...before.path[0], linked: false, version: before.path[0].version + 1 });
    expect(nodes('path-remove-confirm')).toHaveLength(0); expect(output()).toContain('已解除关联');
  });

  it('return to original chat discards a record draft without saving and replaces the route', async () => {
    await setupPractice(); await recordOther();
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await press('return-live-chat');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(nodes('record-save')).toHaveLength(0);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(values.get(STORAGE_KEY)).toBe(before);
    await practice(); await press('record-open');
    expect(node('record-note').props.value).toBe('');
    expect(node('record-save').props.disabled).toBe(true);
  });

  it('return to original chat cancels the pending code challenge without storage writes', async () => {
    await mount(); await press('get-code');
    const oldCode = node('displayed-code').children.join('').match(/\d{6}/)![0];
    await type('code', oldCode);
    const staleLogin = node('login').props.onPress;
    await press('return-live-chat');
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(nodes('displayed-code')).toHaveLength(0);
    await act(async () => { staleLogin(); });
    expect(output()).toContain('演示验证码已失效');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

});
