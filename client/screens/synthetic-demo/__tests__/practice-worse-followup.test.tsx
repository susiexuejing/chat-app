import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import { createDemoRepository, DEMO_NUMBER, STORAGE_KEY, type Snapshot } from '@/features/synthetic-demo/repository';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/features/dev-journey/DevConversation', () => ({ DevConversation: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: any) => require('react').createElement('Screen', null, children) }));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    Platform: { OS: 'web' }, View: host('View'), Text: host('Text'), TextInput: host('TextInput'),
    Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
  };
});

// Actual React screen and repository. Only platform hosts and unrelated chat are mocked.
// No browser, live API, credentials or real personal data are used by this suite.
describe('EF-378 worse check-in follow-up', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failWrites: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;
  let a: string;
  let b: string;
  let listeners: Map<string, (event: any) => void>;

  beforeEach(() => {
    mounted = false; values = new Map(); failWrites = false; listeners = new Map();
    storage = {
      getItem: jest.fn((key: string) => values.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        if (failWrites) throw new Error('Injected storage write failure');
        values.set(key, value);
      }),
    };
    oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      localStorage: storage,
      addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } });
    oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const repo = createDemoRepository(storage);
    const account = repo.login(repo.requestCode(DEMO_NUMBER)).session!;
    a = repo.createPattern(account, '虚构 A：忙碌时停一下').patterns[0].pattern.patternId;
    b = repo.createPattern(account, '虚构 B：表达需要').patterns[1].pattern.patternId;
    repo.savePractice(account, a, { ifCue: '虚构 A 线索', thenAction: '虚构 A 动作' }, 0);
    repo.savePractice(account, b, { ifCue: '虚构 B 线索', thenAction: '虚构 B 动作' }, 0);
    repo.activatePractice(account, a, 1);
    storage.setItem.mockClear();
  });
  afterEach(async () => {
    if (mounted) await act(async () => { tree.unmount(); });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete (globalThis as any).window;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  async function mount() { await act(async () => { tree = renderer.create(<SyntheticDemoScreen />); }); mounted = true; }
  function nodes(id: string): ReactTestInstance[] { return tree.root.findAll(n => typeof n.type === 'string' && n.props.testID === id); }
  function node(id: string): ReactTestInstance { const result = nodes(id)[0]; if (!result) throw new Error(`Missing control: ${id}`); return result; }
  async function press(id: string) { const n = node(id); expect(n.props.disabled).not.toBe(true); await act(async () => { n.props.onPress(); }); }
  async function type(id: string, text: string) { await act(async () => { node(id).props.onChangeText(text); }); }
  function saved(): Snapshot { return JSON.parse(values.get(STORAGE_KEY)!); }
  function state(id = a, snapshot = saved()) { return snapshot.patterns.find(row => row.pattern.patternId === id)!; }
  function output() { return JSON.stringify(tree.toJSON()); }
  async function practice(id = a) { await press('nav-me'); await press('mode-open'); await press(`pattern-open-${id}`); await press('practice-open'); }
  async function worse(action: 'agreed' | 'other' = 'agreed') {
    await press('record-open'); await press('record-occurred-yes'); await press(`record-action-${action}`); await press('record-feeling-worse');
  }
  async function setup() { await mount(); await practice(); }

  it.each(['agreed', 'other'] as const)('offers help immediately for %s without saving or pausing', async action => {
    await setup(); const before = saved(); await worse(action);
    expect(nodes('record-worse-guidance')).toHaveLength(1);
    expect(node('record-worse-leave').props.accessibilityLabel).toBe('不保存本次记录，去调整或暂停');
    expect(nodes('record-worse-followup')).toHaveLength(0);
    expect(output()).toContain('不必继续重复');
    expect(storage.setItem).not.toHaveBeenCalled(); expect(saved()).toEqual(before);
    await press('record-worse-leave');
    expect(saved()).toEqual(before); expect(nodes('record-note')).toHaveLength(0);
    expect(nodes('practice-edit')).toHaveLength(1); expect(nodes('practice-pause')).toHaveLength(1);
    expect(nodes('record-worse-guidance')).toHaveLength(0);
  });

  it.each(['record-occurred-no', 'record-action-none', 'record-action-other', 'record-feeling-helped', 'record-feeling-unchanged', 'record-feeling-not_recorded'])(
    'clears worse guidance when the user changes %s', async choice => {
      await setup(); await worse(); const staleLeave = node('record-worse-leave').props.onPress;
      await press(choice); expect(nodes('record-worse-guidance')).toHaveLength(0);
      const before = output(); await act(async () => { staleLeave(); });
      expect(output()).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
      if (choice === 'record-action-other') await press('record-feeling-unchanged');
      await press('record-save'); expect(nodes('record-worse-followup')).toHaveLength(0);
      expect(nodes('record-new')).toHaveLength(1); expect(state().practice?.paused).toBe(false);
    },
  );

  it.each(['record-cancel', 'record-skip', 'record-back', 'nav-me'])('discards worse via %s without saving and rejects old save/leave', async dismiss => {
    await setup(); await worse(); const before = saved();
    const save = node('record-save').props.onPress; const leave = node('record-worse-leave').props.onPress;
    await press(dismiss); const dismissed = output();
    await act(async () => { save(); leave(); });
    expect(output()).toBe(dismissed); expect(saved()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    expect(nodes('record-worse-followup')).toHaveLength(0);
  });

  it('retains failed worse draft and retry identity, saves once, then offers pause/edit instead of another record', async () => {
    await setup(); await worse(); await type('record-note', '虚构说明');
    const before = saved(); failWrites = true; await press('record-save');
    expect(saved()).toEqual(before); expect(output()).toContain('未保存，原内容未改变');
    expect(node('record-note').props.value).toBe('虚构说明'); expect(nodes('record-worse-guidance')).toHaveLength(1);
    expect(nodes('record-worse-followup')).toHaveLength(0);
    failWrites = false; storage.setItem.mockClear(); const save = node('record-save').props.onPress;
    await act(async () => { save(); save(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(state().records).toHaveLength(1);
    expect(state().records[0]).toMatchObject({ occurred: true, action: 'agreed', feeling: 'worse', note: '虚构说明' });
    expect(state().practice).toEqual(state(a, before).practice); expect(state(b)).toEqual(state(b, before));
    expect(nodes('record-worse-followup')).toHaveLength(1); expect(nodes('record-worse-pause')).toHaveLength(1);
    expect(nodes('record-worse-edit')).toHaveLength(1); expect(nodes('record-new')).toHaveLength(0);
    expect(output()).not.toContain('记录新的一次'); expect(nodes('path-open')).toHaveLength(1);
    expect(node('record-back').props.accessibilityLabel).toBe('返回练习');
  });

  it('pauses only after explicit choice, keeps saved facts on failure, and retries once without another record', async () => {
    await setup(); await worse(); await press('record-save'); const before = saved();
    failWrites = true; await press('record-worse-pause');
    expect(saved()).toEqual(before); expect(output()).toContain('未保存，原内容未改变');
    expect(nodes('record-worse-paused')).toHaveLength(0); expect(nodes('record-worse-pause')).toHaveLength(1);
    failWrites = false; storage.setItem.mockClear(); const pause = node('record-worse-pause').props.onPress;
    await act(async () => { pause(); pause(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(state().practice?.paused).toBe(true);
    expect(saved().activePracticePatternId).toBeNull(); expect(state().records).toEqual(state(a, before).records);
    expect(state().path).toEqual(state(a, before).path); expect(state(b)).toEqual(state(b, before));
    expect(nodes('record-worse-paused')).toHaveLength(1); expect(nodes('record-worse-pause')).toHaveLength(0);
    expect(nodes('record-new')).toHaveLength(0); await press('record-back');
    expect(node('record-open').props.disabled).toBe(true);
  });

  it('opens a scoped edit draft, preserves failed edits and cancel, and changes only explicitly saved practice', async () => {
    await setup(); await worse(); await press('record-save'); const before = saved();
    await press('record-worse-edit'); expect(saved()).toEqual(before);
    expect(node('practice-action').props.value).toBe('虚构 A 动作');
    await type('practice-action', '虚构更轻的动作'); await press('practice-cancel'); expect(saved()).toEqual(before);
    await press('practice-edit'); await type('practice-action', '虚构更轻的动作');
    failWrites = true; await press('practice-save'); expect(saved()).toEqual(before);
    expect(node('practice-action').props.value).toBe('虚构更轻的动作'); expect(output()).toContain('未保存，原内容未改变');
    failWrites = false; await press('practice-save');
    expect(state().practice?.thenAction).toBe('虚构更轻的动作'); expect(state().practice?.paused).toBe(false);
    expect(state().records).toEqual(state(a, before).records); expect(state().path).toEqual(state(a, before).path);
    expect(state(b)).toEqual(state(b, before));
  });

  it('does not inherit an old saved worse follow-up after reopening and canceling another check-in', async () => {
    await setup(); await worse(); await press('record-save');
    await press('record-back'); await worse(); await press('record-cancel');
    expect(nodes('record-worse-followup')).toHaveLength(0); expect(nodes('record-new')).toHaveLength(1);
    expect(state().records).toHaveLength(1);
    await press('path-open'); expect(output()).toContain('更难受');
  });

  it.each(['pattern', 'logout', 'storage', 'unmount'])('rejects saved follow-up callbacks after %s invalidation', async reason => {
    await setup(); await worse(); await press('record-save');
    const pause = node('record-worse-pause').props.onPress; const edit = node('record-worse-edit').props.onPress;
    if (reason === 'pattern') await practice(b);
    if (reason === 'logout') { await press('nav-me'); await press('logout'); }
    if (reason === 'storage') {
      const oldValue = values.get(STORAGE_KEY)!;
      const next = { ...saved(), session: null }; values.set(STORAGE_KEY, JSON.stringify(next));
      await act(async () => { listeners.get('storage')!({ key: STORAGE_KEY, oldValue, newValue: values.get(STORAGE_KEY) }); });
    }
    if (reason === 'unmount') { await act(async () => { tree.unmount(); }); mounted = false; }
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await act(async () => { pause(); edit(); });
    expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
    if (mounted) { expect(nodes('record-worse-followup')).toHaveLength(0); expect(nodes('practice-action')).toHaveLength(0); }
  });
});
