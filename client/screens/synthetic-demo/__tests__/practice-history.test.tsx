import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '@/screens/synthetic-demo';
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
describe('EF-378 practice snapshot regression', () => {
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
  function contents(n: ReactTestInstance): string { return n.children.map(c=>typeof c === 'string' ? c : contents(c)).join(''); }
  function output() { return JSON.stringify(tree.toJSON()); }
  async function practice(id = a) { await press('nav-me'); await press('mode-open'); await press(`pattern-open-${id}`); await press('practice-open'); }
  async function setup() { await mount(); await practice(); }


  it('preserves saved agreement after the practice text is replaced and the UI is remounted', async () => {
    await setup();
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-agreed');
    await press('record-feeling-helped'); await press('record-save');
    const before = saved();
    const oldRecord = state(a, before).records[0];
    const oldPractice = state(a, before).practice!;
    expect(oldRecord.action).toBe('agreed'); expect(oldRecord.practiceVersion).toBe(oldPractice.version);
    await press('path-open');
    expect(nodes(`path-entry-${oldRecord.recordId}`)).toHaveLength(1);
    await press('practice-open'); await press('practice-edit');
    await type('practice-cue', '虚构：回家把钥匙放好');
    await type('practice-action', '虚构：读两页书');
    await press('practice-save');
    const after = saved();
    expect(state(a, after).records[0]).toEqual(oldRecord);
    expect(state(a, after).practice?.version).toBe(oldPractice.version + 1);
    expect(state(a, after).practice?.paused).toBe(false);
    expect(state(b, after)).toEqual(state(b, before));
    // Regression: the old confirmed practice remains independently readable.
    expect(JSON.stringify(after)).toContain(oldPractice.ifCue);
    expect(JSON.stringify(after)).toContain(oldPractice.thenAction);
    expect(Object.keys(oldRecord)).not.toContain('ifCue');
    expect(Object.keys(oldRecord)).not.toContain('thenAction');
    await press('practice-back');
    expect(output()).toContain('虚构：读两页书');
    expect(output()).toContain('做了约定动作');
    expect(output()).toContain(oldPractice.ifCue); expect(output()).toContain(oldPractice.thenAction);
    storage.setItem.mockClear();
    await act(async () => { tree.unmount(); }); mounted = false;
    await mount(); await practice(); await press('practice-back');
    expect(state().records[0]).toEqual(oldRecord);
    expect(output()).toContain('做了约定动作'); expect(output()).toContain('虚构：读两页书');
    expect(output()).toContain(oldPractice.ifCue); expect(output()).toContain(oldPractice.thenAction);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(saved()).toEqual(after);

  });
  it('shows missing historic practice without silently filling from current practice', async () => {
    const repo = createDemoRepository(storage), before = repo.snapshot();
    repo.saveRecord(before.accountId!, a, {occurred:true,action:'agreed',feeling:'helped'},2,'old-record');
    const legacy = saved();
    delete state(a,legacy).records[0].practiceSnapshot;
    values.set(STORAGE_KEY,JSON.stringify(legacy));
    storage.setItem.mockClear();
    await setup(); await press('practice-back');
    expect(nodes('record-practice-missing-record-1')).toHaveLength(1);
    expect(nodes('record-practice-record-1')).toHaveLength(0);
    expect(output()).toContain('这条旧记录未保存当时的练习内容，不能从当前练习推断。');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(state().records[0].practiceSnapshot).toBeUndefined();
  });

  it('stitched lifecycle: legacy plus two agreement versions, failure recovery, cross-pattern and explicit logout/login', async () => {
    // Only fixture setup uses the repository directly; subsequent mutations use real screen handlers.
    const repo=createDemoRepository(storage), account=repo.snapshot().accountId!;
    repo.saveRecord(account,a,{occurred:false,action:null,feeling:null},2,'legacy-fixture');
    const mixed=saved(); delete state(a,mixed).records[0].practiceSnapshot;
    values.set(STORAGE_KEY,JSON.stringify(mixed));
    const untouchedB=state(b); const legacyRecord=state().records[0];
    await setup();
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-agreed');
    await press('record-feeling-helped'); await press('record-save');
    const firstNew=state().records[1];
    expect(firstNew.practiceSnapshot).toEqual({ifCue:'虚构 A 线索',thenAction:'虚构 A 动作'});
    await press('path-open'); await press('practice-open'); await press('practice-edit');
    await type('practice-cue','虚构新情境'); await type('practice-action','虚构新动作'); await press('practice-save');
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-other'); await press('record-feeling-unchanged');
    const beforeFailedWrite=values.get(STORAGE_KEY);
    failWrites=true; await press('record-save');
    expect(values.get(STORAGE_KEY)).toBe(beforeFailedWrite);
    expect(output()).toContain('未保存'); expect(nodes('record-save')).toHaveLength(1);
    failWrites=false; await press('record-save');
    expect(state().records).toHaveLength(3);
    const secondNew=state().records[2];
    expect(secondNew.practiceSnapshot).toEqual({ifCue:'虚构新情境',thenAction:'虚构新动作'});
    expect(state().records[0]).toEqual(legacyRecord); expect(state().records[1]).toEqual(firstNew);
    await press('path-open');
    expect(nodes('record-practice-missing-record-1')).toHaveLength(1);
    expect(contents(node('record-practice-record-2'))).toContain('虚构 A 动作');
    expect(contents(node('record-practice-record-3'))).toContain('虚构新动作');
    await press('nav-me'); await press('mode-open'); await press(`pattern-open-${b}`);
    expect(output()).not.toContain('虚构 A 动作'); expect(output()).not.toContain('虚构新动作');
    expect(state(b)).toEqual(untouchedB);
    const beforeLogout=saved();
    await press('nav-me'); await press('logout');
    expect(output()).not.toContain('虚构 A 动作'); expect(output()).not.toContain('虚构新动作');
    expect(saved().session).toBeNull(); expect(saved().patterns).toEqual(beforeLogout.patterns);
    await act(async()=>tree.unmount()); mounted=false; await mount();
    expect(nodes('get-code')).toHaveLength(1); expect(nodes('record-practice-record-2')).toHaveLength(0);
    await press('get-code');
    const displayed=node('displayed-code').props.children;
    const code=Array.isArray(displayed)?displayed.join(''):String(displayed);
    const match=code.match(/\d{6}/); expect(match).not.toBeNull();
    await type('code',match![0]); await press('login');
    await press('nav-me'); await press('mode-open'); await press(`pattern-open-${a}`);
    expect(nodes('record-practice-missing-record-1')).toHaveLength(1);
    expect(contents(node('record-practice-record-2'))).toContain('虚构 A 动作');
    expect(contents(node('record-practice-record-3'))).toContain('虚构新动作');
    expect(saved().patterns).toEqual(beforeLogout.patterns); expect(state(b)).toEqual(untouchedB);
    expect(state().records[0]).toEqual(legacyRecord);
  });

});
