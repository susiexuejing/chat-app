import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import { createDemoRepository, STORAGE_KEY, type Snapshot } from '@/features/synthetic-demo/repository';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

// Host-only rendering deliberately excludes Expo, real ChatProvider and all APIs.
// Unlike a plain Modal host mock, this respects visibility for user-facing assertions.
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    Platform: { OS: 'web' }, View: host('View'), Text: host('Text'),
    TextInput: host('TextInput'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
  };
});
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: any) => require('react').createElement('Screen', null, children),
}));

describe('EF-384 actual native screen journey, backed by the real repository', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failWrites: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;

  beforeEach(() => {
    mounted = false;
    mockReplace.mockClear();
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
  async function confirm() {
    await press('nav-chat'); await press('chat-send'); await press('candidate-confirm'); await press('candidate-save');
  }
  async function mode() { await press('nav-me'); await press('mode-open'); }
  async function practice() { await mode(); await press('practice-open'); }
  async function setupPractice() {
    await mount(); await login(); await confirm(); await practice();
    await press('practice-edit'); await press('practice-save');
  }
  async function recordOther() {
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-other');
    await press('record-feeling-not_recorded'); await type('record-note', '虚构记录');
  }

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
    await press('chat-send'); await press('candidate-edit'); await type('candidate-text', '未保存'); await press('candidate-cancel');
    await press('candidate-stop');
    for (const choice of ['candidate-reject', 'candidate-unsure']) {
      await press('chat-send'); await press(choice);
      expect(nodes('candidate-confirm')).toHaveLength(0);
    }
    await press('chat-send'); await press('candidate-confirm'); await press('nav-me'); await press('nav-chat');
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
