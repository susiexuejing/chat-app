import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import { createDemoRepository, DEMO_NUMBER, STORAGE_KEY, type Decision, type Snapshot } from '@/features/synthetic-demo/repository';

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

describe('EF-383 saved-pattern decisions with the actual screen and repository', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failWrites: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;
  let accountId: string;
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
    // Explicitly fictional fixture. No candidate or example is seeded by the app.
    const repo = createDemoRepository(storage);
    accountId = repo.login(repo.requestCode(DEMO_NUMBER)).session!;
    a = repo.createPattern(accountId, '虚构 A：忙碌时先停一下').patterns[0].pattern.patternId;
    b = repo.createPattern(accountId, '虚构 B：见朋友前表达需要').patterns[1].pattern.patternId;
    repo.savePractice(accountId, a, { ifCue: '虚构线索', thenAction: '虚构动作' }, 0);
    repo.activatePractice(accountId, a, 1);
    repo.saveRecord(accountId, a, { occurred: true, action: 'agreed', feeling: 'helped' }, 2, 'fictional-record');
    repo.updatePattern(accountId, a, { decision: 'candidate' }, 1);
    storage.setItem.mockClear();
  });
  afterEach(async () => {
    if (mounted) await act(async () => { tree.unmount(); });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete (globalThis as any).window;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  async function mount() {
    await act(async () => { tree = renderer.create(<SyntheticDemoScreen />); await Promise.resolve(); });
    mounted = true;
  }
  async function remount() { await act(async () => { tree.unmount(); }); mounted = false; await mount(); }
  function nodes(id: string): ReactTestInstance[] { return tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id); }
  function node(id: string): ReactTestInstance {
    const result = nodes(id)[0]; if (!result) throw new Error(`Missing visible control: ${id}`); return result;
  }
  async function press(id: string) {
    const control = node(id); expect(control.props.disabled).not.toBe(true);
    await act(async () => { control.props.onPress(); });
  }
  async function type(id: string, text: string) { await act(async () => { node(id).props.onChangeText(text); }); }
  function persisted(): Snapshot { return JSON.parse(values.get(STORAGE_KEY)!); }
  function state(id: string, snapshot = persisted()) { return snapshot.patterns.find(row => row.pattern.patternId === id)!; }
  function output() { return JSON.stringify(tree.toJSON()); }
  async function detail(id = a) { await press('nav-me'); await press('mode-open'); await press(`pattern-open-${id}`); }
  async function editor(id = a) { await detail(id); await press('pattern-edit'); }
  function checked(decision: Exclude<Decision, 'candidate'>) { return node(`pattern-decision-${decision}`).props.accessibilityState.checked; }

  it.each([
    ['candidate', '演示候选 · 待确认'], ['rejected', '不符合'], ['uncertain', '暂不确定'],
  ] as const)('keeps %s practice state but blocks an unsavable new record before editing', async (decision, label) => {
    await mount(); await editor();
    if (decision !== 'candidate') { await press(`pattern-decision-${decision}`); await press('pattern-save'); }
    else await press('pattern-cancel');
    const before = persisted(); storage.setItem.mockClear();
    await press('practice-open');
    expect(output()).toContain('已保存 · 进行中');
    expect(output()).not.toContain('已确认 · 进行中');
    expect(node('record-open').props.disabled).toBe(true);
    expect(node('record-unavailable').children.join('')).toBe(`这条模式目前是「${label}」，暂不能新增练习记录。已有记录会保留，练习仍开启时可手动暂停。`);
    // An already queued or direct callback cannot bypass the disabled control.
    await act(async () => { node('record-open').props.onPress(); });
    expect(nodes('record-occurred-yes')).toHaveLength(0);
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    expect(node('practice-pause').props.disabled).toBe(false);
    await press('practice-pause');
    expect(output()).toContain('已保存 · 尚未开始或已暂停');
    expect(output()).not.toContain('已保存 · 进行中');
    expect(state(a).practice?.paused).toBe(true); expect(persisted().activePracticePatternId).toBeNull();
    expect(state(a).pattern).toEqual(state(a, before).pattern);
    expect(state(a).records).toEqual(state(a, before).records); expect(state(a).path).toEqual(state(a, before).path);
    expect(state(b)).toEqual(state(b, before)); expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'uncertain'] as const)('allows recording after an explicit %s-to-confirmed decision without restarting the practice', async decision => {
    await mount(); await editor(); await press(`pattern-decision-${decision}`); await press('pattern-save');
    await press('practice-open'); const blockedHandler = node('record-open').props.onPress;
    await press('practice-back'); await press('pattern-edit'); await press('pattern-decision-confirmed'); await press('pattern-save');
    const before = persisted(); storage.setItem.mockClear();
    await press('practice-open');
    expect(output()).toContain('已保存 · 进行中');
    expect(output()).not.toContain('已确认 · 进行中');
    expect(node('record-open').props.disabled).toBe(false); expect(nodes('record-unavailable')).toHaveLength(0);
    await act(async () => { blockedHandler(); }); expect(nodes('record-occurred-yes')).toHaveLength(0);
    await press('record-open'); await press('record-occurred-no'); await press('record-save');
    expect(state(a).records).toHaveLength(state(a, before).records.length + 1);
    expect(state(a).practice).toEqual(state(a, before).practice);
    expect(persisted().activePracticePatternId).toBe(a); expect(state(b)).toEqual(state(b, before));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps an unsaved practice distinct without writing or claiming it is active', async () => {
    await mount(); await detail(b); const before = persisted(); storage.setItem.mockClear();
    await press('practice-open');
    expect(output()).toContain('尚未保存'); expect(output()).not.toContain('已保存 · 进行中');
    expect(output()).not.toContain('已确认 · 进行中'); expect(nodes('record-open')).toHaveLength(0);
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed', '符合我的体验', '已确认'],
    ['rejected', '不符合', '不符合'],
    ['uncertain', '还不确定', '暂不确定'],
  ] as const)('only saves an explicit %s choice and retains it on reopen/remount', async (decision, label, status) => {
    await mount(); await editor(); const before = persisted();
    for (const key of ['confirmed', 'rejected', 'uncertain'] as const) expect(checked(key)).toBe(false);
    expect(node(`pattern-decision-${decision}`).props.accessibilityLabel).toBe(label);
    await press(`pattern-decision-${decision}`);
    expect(checked(decision)).toBe(true); expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    await press('pattern-save');
    expect(state(a).pattern.decision).toBe(decision); expect(state(b)).toEqual(state(b, before));
    expect(state(a).practice).toEqual(state(a, before).practice); expect(state(a).records).toEqual(state(a, before).records);
    expect(state(a).path).toEqual(state(a, before).path); expect(state(a).pattern.clues).toEqual(state(a, before).pattern.clues);
    expect(persisted().activePracticePatternId).toBe(before.activePracticePatternId);
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(nodes('draft-editor')).toHaveLength(0); expect(output()).toContain(status);
    await press('pattern-edit'); expect(checked(decision)).toBe(true); await press('pattern-cancel');
    await press('pattern-back'); expect(output()).toContain(status);
    await remount(); await editor(); expect(checked(decision)).toBe(true);
  });

  it('editing text alone preserves the candidate without requiring a complete explanation', async () => {
    await mount(); await editor();
    await type('pattern-name', '虚构改名'); await type('pattern-understanding', ''); await press('pattern-save');
    expect(state(a).pattern).toMatchObject({ name: '虚构改名', currentUnderstanding: '', decision: 'candidate' });
    expect(state(a).pattern.clues).toEqual([]); expect(output()).toContain('演示候选 · 待确认');
    await press('pattern-edit'); await press('pattern-decision-uncertain'); await press('pattern-save');
    expect(state(a).pattern).toMatchObject({ currentUnderstanding: '', decision: 'uncertain' });
  });

  it.each(['rejected', 'uncertain', 'confirmed'] as const)('can revise a saved %s decision again without changing related records', async initial => {
    const repo = createDemoRepository(storage); repo.updatePattern(accountId, a, { decision: initial }, 2);
    await mount(); await editor(); expect(checked(initial)).toBe(true); const before = persisted();
    await press('pattern-decision-confirmed'); await press('pattern-save');
    await press('pattern-edit'); await press('pattern-decision-uncertain'); await press('pattern-save');
    expect(state(a).pattern.decision).toBe('uncertain'); expect(state(b)).toEqual(state(b, before));
    expect(state(a).records).toEqual(state(a, before).records); expect(state(a).path).toEqual(state(a, before).path);
    expect(state(a).practice).toEqual(state(a, before).practice);
  });

  it('cancels choices and text without writing or allowing stale callbacks to revive them', async () => {
    await mount(); await editor(); const before = values.get(STORAGE_KEY);
    await press('pattern-decision-confirmed'); await type('pattern-name', '不要保存的名字');
    const save = node('pattern-save').props.onPress; const choose = node('pattern-decision-rejected').props.onPress;
    await press('pattern-cancel'); await act(async () => { save(); choose(); });
    expect(nodes('draft-editor')).toHaveLength(0); expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
    await press('pattern-edit'); expect(node('pattern-name').props.value).not.toBe('不要保存的名字');
    for (const key of ['confirmed', 'rejected', 'uncertain'] as const) expect(checked(key)).toBe(false);
  });

  it('retains failed choice/text and old saved data, then retries exactly once', async () => {
    await mount(); await editor(); const before = persisted();
    await type('pattern-name', '虚构重试名称'); await type('pattern-understanding', '虚构重试理解'); await press('pattern-decision-rejected');
    failWrites = true; await press('pattern-save');
    expect(persisted()).toEqual(before); expect(output()).toContain('未保存'); expect(output()).not.toContain('已保存到此浏览器');
    expect(node('pattern-name').props.value).toBe('虚构重试名称'); expect(node('pattern-understanding').props.value).toBe('虚构重试理解'); expect(checked('rejected')).toBe(true);
    failWrites = false; storage.setItem.mockClear(); const save = node('pattern-save').props.onPress;
    await act(async () => { save(); save(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(state(a).pattern).toMatchObject({ name: '虚构重试名称', currentUnderstanding: '虚构重试理解', decision: 'rejected' });
    expect(state(b)).toEqual(state(b, before));
  });

  it('keeps a conflicting draft and requires reopening the latest saved version before retrying', async () => {
    await mount(); await editor(); await press('pattern-decision-confirmed');
    const repo = createDemoRepository(storage); repo.updatePattern(accountId, a, { name: '虚构外部修改' }, 2);
    const before = persisted(); storage.setItem.mockClear(); await press('pattern-save');
    expect(output()).toContain('版本已变化'); expect(checked('confirmed')).toBe(true); expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    await press('pattern-cancel'); await editor(); expect(node('pattern-name').props.value).toBe('虚构外部修改');
    await press('pattern-decision-uncertain'); await press('pattern-save'); expect(state(a).pattern.decision).toBe('uncertain');
  });

  it('does not apply an A decision to B after navigation or to a newer editor', async () => {
    await mount(); await editor(); await press('pattern-decision-confirmed');
    const save = node('pattern-save').props.onPress; const choose = node('pattern-decision-uncertain').props.onPress;
    await editor(b); const before = persisted(); storage.setItem.mockClear();
    await act(async () => { save(); choose(); });
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled(); expect(checked('confirmed')).toBe(true);
    await press('pattern-decision-rejected'); await press('pattern-save');
    expect(state(a)).toEqual(state(a, before)); expect(state(b).pattern.decision).toBe('rejected');
  });

  it('drops the decision draft and rejects captured handlers after logout', async () => {
    await mount(); await editor(); await press('pattern-decision-confirmed'); const save = node('pattern-save').props.onPress;
    await press('nav-me'); await press('logout'); const before = persisted(); storage.setItem.mockClear();
    await act(async () => { save(); });
    expect(persisted()).toEqual(before); expect(persisted().session).toBeNull(); expect(nodes('draft-editor')).toHaveLength(0); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('invalidates a pending decision when the account storage is replaced', async () => {
    await mount(); await editor(); await press('pattern-decision-confirmed'); const save = node('pattern-save').props.onPress;
    const oldValue = values.get(STORAGE_KEY)!; const replacement = persisted(); replacement.session = null;
    const newValue = JSON.stringify(replacement); values.set(STORAGE_KEY, newValue); storage.setItem.mockClear();
    await act(async () => { listeners.get('storage')!({ key: STORAGE_KEY, oldValue, newValue }); save(); });
    expect(values.get(STORAGE_KEY)).toBe(newValue); expect(nodes('draft-editor')).toHaveLength(0); expect(nodes('get-code')).toHaveLength(1); expect(storage.setItem).not.toHaveBeenCalled();
  });
});
