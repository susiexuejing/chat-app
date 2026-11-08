import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SyntheticDemoScreen from '../index';
import {
  createDemoRepository, DEMO_NUMBER, LEGACY_STORAGE_KEY, STORAGE_KEY,
  type PatternState, type Snapshot,
} from '@/features/synthetic-demo/repository';
import type { DevUnderstandingDraft } from '@/features/dev-journey/DevConversation';

// These are explicitly fictional test inputs, not application defaults or a live API reply.
let mockReply: DevUnderstandingDraft;
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/features/dev-journey/DevConversation', () => ({
  DevConversation: ({ onConfirm, onDraftDiscard, footer }: any) => {
    const React = require('react');
    return React.createElement('MockConversation', null,
      React.createElement('Pressable', { testID: 'mock-confirm', onPress: () => onConfirm(mockReply) }),
      React.createElement('Pressable', { testID: 'mock-discard', onPress: onDraftDiscard }), footer);
  },
}));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    Platform: { OS: 'web' }, View: host('View'), Text: host('Text'), TextInput: host('TextInput'),
    Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
  };
});
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: any) => require('react').createElement('Screen', null, children),
}));

// Exact v1 data emitted by baseline 0bd318b6's real repository, using its old public API.
// Kept as data so migration is tested against the old schema, never generated with v2.
function legacyV1() {
  const accountId = 'ef384-synthetic-account';
  const patternId = 'mode-fatigue-self-criticism-v1';
  const practiceId = 'practice-pause-10s-v1';
  const at = '2026-01-02T03:04:05.000Z';
  const marked = { schemaVersion: 1, demoSource: 'synthetic', accountId, patternId };
  const entry = { ...marked, createdAt: at, linked: true, userConfirmed: true };
  return {
    schemaVersion: 1, revision: 6, accountId, session: accountId,
    pattern: { ...marked, name: '旧版本虚构模式', currentUnderstanding: '原有的合成理解',
      decision: 'confirmed', clues: [], createdAt: at, updatedAt: '2026-01-02T03:04:05.001Z', version: 2 },
    practice: { demoSource: 'synthetic', accountId, patternId, practiceId, name: '停十秒，回到眼前',
      ifCue: '旧线索', thenAction: '旧动作', confirmed: true, paused: false, version: 1 },
    records: [{ ...marked, practiceId, practiceVersion: 1, recordId: 'record-1', operationId: 'legacy-record',
      createdAt: at, occurred: true, action: 'agreed', feeling: 'helped', note: '旧记录' }],
    path: [{ ...entry, entryId: 'evt-1', type: 'event', version: 1,
      fact: '用户明确保存的合成事件：累的时候注意到自己先责备自己。', source: '用户确认保存' },
    { ...entry, entryId: 'record-1', type: 'practice', version: 2, fact: '用户明确保存的练习记录。',
      source: '用户明确保存的练习记录', recordId: 'record-1', explanation: '旧解释', feeling: '旧感受' }],
  };
}

describe('EF-384 multi-pattern navigation with the actual screen and scoped repository', () => {
  let tree: ReactTestRenderer;
  let mounted: boolean;
  let values: Map<string, string>;
  let failReads: boolean;
  let failWrites: boolean;
  let storage: { getItem: jest.Mock; setItem: jest.Mock };
  let oldWindow: PropertyDescriptor | undefined;
  let oldAct: unknown;
  let requestSequence: number;

  beforeEach(() => {
    mounted = false; values = new Map(); failReads = false; failWrites = false; requestSequence = 0;
    mockReplace.mockClear();
    mockReply = { text: '虚构理解', input: '虚构场景', requestId: 'fixture-request' };
    storage = {
      getItem: jest.fn((key: string) => {
        if (failReads) throw new Error('Injected storage read failure');
        return values.get(key) ?? null;
      }),
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

  async function mount(strict = false) {
    await act(async () => {
      const screen = <SyntheticDemoScreen />;
      tree = renderer.create(strict ? React.createElement(React.StrictMode, null, screen) : screen);
      await Promise.resolve();
    });
    mounted = true;
  }
  async function remount() {
    await act(async () => { tree.unmount(); }); mounted = false; await mount();
  }
  function nodes(id: string): ReactTestInstance[] {
    return tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  }
  function node(id: string, index = 0): ReactTestInstance {
    const result = nodes(id)[index];
    if (!result) throw new Error(`Missing visible control: ${id}[${index}]`);
    return result;
  }
  async function press(id: string, index = 0) {
    const control = node(id, index); expect(control.props.disabled).not.toBe(true);
    await act(async () => { control.props.onPress(); });
  }
  async function type(id: string, text: string) {
    await act(async () => { node(id).props.onChangeText(text); });
  }
  function output() { return JSON.stringify(tree.toJSON()); }
  function textOf(id: string) {
    const visit = (item: ReactTestInstance | string): string => typeof item === 'string' ? item : item.children.map(visit).join('');
    return visit(node(id));
  }
  function persisted(): Snapshot { return JSON.parse(values.get(STORAGE_KEY)!); }
  function state(id: string, data = persisted()): PatternState {
    const result = data.patterns.find(row => row.pattern.patternId === id);
    expect(result).toBeDefined(); return result!;
  }
  async function login() {
    await press('get-code');
    const code = node('displayed-code').children.join('').match(/\d{6}/)?.[0];
    expect(code).toBeDefined(); await type('code', code!); await press('login');
  }
  async function list() { await press('nav-me'); await press('mode-open'); }
  async function detail(id: string) { await list(); await press(`pattern-open-${id}`); }
  async function reply(text: string, input = `虚构情境：${text}`) {
    await press('nav-chat');
    mockReply = { text, input, requestId: `fictional-request-${++requestSequence}` };
    await press('mock-confirm');
  }
  async function create(text: string) {
    const ids = new Set(persisted().patterns.map(row => row.pattern.patternId));
    await reply(text);
    expect(node('candidate-save').props.disabled).toBe(true);
    await press('candidate-new-choice'); await press('candidate-save');
    const rows = persisted().patterns.filter(row => !ids.has(row.pattern.patternId));
    expect(rows).toHaveLength(1); return rows[0].pattern.patternId;
  }
  async function two() {
    await mount(); await login();
    const a = await create('虚构 A 理解：在忙碌时先停一下');
    const b = await create('虚构 B 理解：见朋友前先表达需要');
    return { a, b };
  }
  async function editPattern(id: string, name: string, understanding: string) {
    await detail(id); await press('pattern-edit');
    await type('pattern-name', name); await type('pattern-understanding', understanding); await press('pattern-save');
  }
  async function savePractice(id: string, cue: string, action: string) {
    await detail(id); await press('practice-open'); await press('practice-edit');
    await type('practice-cue', cue); await type('practice-action', action); await press('practice-save');
  }
  async function record(note: string) {
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-other');
    await press('record-feeling-not_recorded'); await type('record-note', note); await press('record-save');
  }

  it('survives StrictMode effect cleanup/setup and still permits login, list navigation and saving', async () => {
    await mount(true);
    await act(async () => { await Promise.resolve(); });
    expect(storage.setItem).not.toHaveBeenCalled();
    // Two source-key reads constitute one repository snapshot; the replayed,
    // obsolete setup's deferred initializer must not read a second time.
    expect(storage.getItem.mock.calls).toEqual([[STORAGE_KEY], [LEGACY_STORAGE_KEY]]);
    await login(); expect(persisted().session).not.toBeNull();
    const id = await create('虚构 StrictMode 理解');
    await detail(id); expect(output()).toContain('虚构 StrictMode 理解');
    await press('pattern-back'); expect(nodes(`pattern-open-${id}`)).toHaveLength(1);
    await press('patterns-back'); expect(nodes('mode-open')).toHaveLength(1);
    expect(persisted().patterns).toHaveLength(1);
  });

  it('starts with no fabricated pattern and requires My → list → selected detail with only two bottom tabs', async () => {
    await mount(); expect(storage.setItem).not.toHaveBeenCalled(); await login();
    expect(persisted().patterns).toEqual([]);
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await press('nav-me');
    expect(nodes('mode-open')).toHaveLength(1);
    for (const id of ['path-open', 'practice-open', 'record-open', 'pattern-edit', 'nav-path', 'nav-practice', 'nav-record']) {
      expect(nodes(id)).toHaveLength(0);
    }
    expect(nodes('nav-chat')).toHaveLength(1); expect(nodes('nav-me')).toHaveLength(1);
    await press('mode-open');
    expect(output()).toContain('还没有'); expect(nodes('pattern-edit')).toHaveLength(0);
    expect(tree.root.findAll(n => typeof n.type === 'string' && String(n.props.testID).startsWith('pattern-open-'))).toHaveLength(0);
    expect(output()).not.toContain('累时容易先责备自己');
    await press('patterns-back'); expect(nodes('mode-open')).toHaveLength(1);
    expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('creates two stable independent IDs only by explicit choice and opens their correct details and inline paths', async () => {
    const { a, b } = await two(); expect(a).not.toBe(b);
    await editPattern(a, '虚构 A 名称', '虚构 A 当前理解');
    await editPattern(b, '虚构 B 名称', '虚构 B 当前理解');
    const before = persisted(); storage.setItem.mockClear();
    await list();
    expect(nodes(`pattern-open-${a}`)).toHaveLength(1); expect(nodes(`pattern-open-${b}`)).toHaveLength(1);
    expect(nodes('pattern-edit')).toHaveLength(0); expect(nodes('path-edit')).toHaveLength(0);
    await press(`pattern-open-${a}`);
    expect(output()).toContain('虚构 A 名称'); expect(output()).toContain('虚构 A 当前理解');
    expect(output()).toContain(state(a).path[0].fact); expect(output()).not.toContain('虚构 B 名称');
    expect(output()).not.toContain(state(b).path[0].fact);
    expect(nodes('practice-open')).toHaveLength(1); expect(nodes('path-edit').length).toBeGreaterThan(0);
    await press('pattern-back'); await press(`pattern-open-${b}`);
    expect(output()).toContain('虚构 B 名称'); expect(output()).toContain('虚构 B 当前理解');
    expect(output()).not.toContain('虚构 A 名称'); expect(output()).not.toContain(state(a).path[0].fact);
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('requires a correction relation AND explicit target; editing B preserves every A field and existing B facts', async () => {
    const { a, b } = await two(); const before = persisted();
    await reply('虚构 B 修正后的理解');
    const unchosenSave = node('candidate-save').props.onPress;
    await act(async () => { unchosenSave(); }); expect(persisted()).toEqual(before);
    await press('candidate-correction-choice'); expect(node('candidate-save').props.disabled).toBe(true);
    await press(`candidate-target-${b}`); await press('candidate-save');
    expect(persisted().patterns).toHaveLength(2); expect(state(a)).toEqual(state(a, before));
    expect(state(b).pattern).toMatchObject({ patternId: b, currentUnderstanding: '虚构 B 修正后的理解', version: 2 });
    for (const entry of state(b, before).path) expect(state(b).path.find(row => row.entryId === entry.entryId)).toEqual(entry);
    expect(state(b).path.find(row => row.type === 'correction')).toMatchObject({
      oldUnderstanding: state(b, before).pattern.currentUnderstanding, currentUnderstanding: '虚构 B 修正后的理解',
    });
    await detail(a); expect(output()).not.toContain('虚构 B 修正后的理解');
    await detail(b); expect(output()).toContain('虚构 B 修正后的理解');
  });

  it('keeps a failed new-pattern draft and refuses a correction whose selected version changed', async () => {
    const { a, b } = await two(); const before = persisted();
    await reply('虚构 C 失败后可重试的理解'); await press('candidate-new-choice');
    failWrites = true; await press('candidate-save');
    expect(persisted()).toEqual(before); expect(node('candidate-text').props.value).toBe('虚构 C 失败后可重试的理解');
    expect(output()).toContain('未保存'); failWrites = false;
    const staleCreate = node('candidate-save').props.onPress; await press('candidate-cancel');
    await reply('虚构 A 基于旧版的修正'); await press('candidate-correction-choice'); await press(`candidate-target-${a}`);
    const repo = createDemoRepository(storage);
    const newer = repo.updatePattern(before.accountId!, a, { currentUnderstanding: '虚构 A 另一编辑已保存' }, state(a).pattern.version);
    storage.setItem.mockClear();
    await act(async () => { staleCreate(); }); expect(persisted().patterns).toEqual(newer.patterns);
    await press('candidate-save');
    expect(output()).toContain('版本'); expect(node('candidate-text').props.value).toBe('虚构 A 基于旧版的修正');
    expect(persisted().patterns).toEqual(newer.patterns); expect(state(b)).toEqual(state(b, before));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('saves practices independently and refuses a second activation without silently pausing the first', async () => {
    const { a, b } = await two();
    await savePractice(a, '虚构 A 线索', '虚构 A 动作');
    expect(state(a).practice?.paused).toBe(true); await press('practice-activate');
    const aActive = state(a);
    await savePractice(b, '虚构 B 线索', '虚构 B 动作');
    expect(state(a)).toEqual(aActive); expect(state(b).practice?.paused).toBe(true);
    expect(persisted().activePracticePatternId).toBe(a);
    const before = persisted(); storage.setItem.mockClear();
    // Even when the UI disables activation, a retained/direct callback must fail closed.
    await act(async () => { node('practice-activate').props.onPress(); });
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    await detail(a); await press('practice-open'); await press('practice-pause');
    const aPaused = state(a);
    await detail(b); await press('practice-open'); await press('practice-activate');
    expect(persisted().activePracticePatternId).toBe(b); expect(state(a)).toEqual(aPaused);
    expect(state(b).practice).toMatchObject({ ifCue: '虚构 B 线索', thenAction: '虚构 B 动作', paused: false });
    expect(persisted().patterns.filter(row => row.practice && !row.practice.paused)).toHaveLength(1);
  });

  it('editing A, recording A, changing its explanation/feeling and unlinking A never modifies B', async () => {
    const { a, b } = await two();
    await savePractice(b, '虚构 B 独立线索', '虚构 B 独立动作');
    await press('practice-activate'); await record('虚构 B 原始记录'); await press('path-open');
    await press('path-edit'); await type('path-explanation', '虚构 B 原有解释');
    await type('path-feeling', '虚构 B 原有感受'); await press('path-save');
    await press('path-remove'); await press('path-remove-confirm');
    await press('practice-open'); await press('practice-pause');
    const bBefore = state(b);
    await editPattern(a, '虚构 A 改名', '虚构 A 新理解'); expect(state(b)).toEqual(bBefore);
    await savePractice(a, '虚构 A 线索', '虚构 A 动作'); await press('practice-activate');
    await record('虚构 A 记录');
    expect(state(a).records).toHaveLength(1); expect(state(b)).toEqual(bBefore);
    await press('path-open');
    expect(output()).toContain('虚构 A 记录'); expect(output()).not.toContain('虚构 B 独立动作');
    const beforePath = state(a);
    await press('path-edit'); await type('path-explanation', '虚构 A 解释'); await type('path-feeling', '虚构 A 感受'); await press('path-save');
    const edited = state(a).path.find(row => row.explanation === '虚构 A 解释')!;
    const original = beforePath.path.find(row => row.entryId === edited.entryId)!;
    expect(edited).toEqual({ ...original, explanation: '虚构 A 解释', feeling: '虚构 A 感受', version: original.version + 1 });
    expect(state(a).records).toEqual(beforePath.records); expect(state(b)).toEqual(bBefore);
    const beforeUnlink = state(a); await press('path-remove'); await press('path-remove-confirm');
    expect(state(a).path.filter(row => !row.linked)).toHaveLength(1);
    expect(state(a).path).toHaveLength(beforeUnlink.path.length); expect(state(a).records).toEqual(beforeUnlink.records);
    expect(state(b)).toEqual(bBefore);
    await detail(b); expect(output()).not.toContain('虚构 A 解释'); expect(output()).not.toContain('虚构 A 记录');
    expect(output()).toContain('虚构 B 原始记录'); expect(output()).toContain('虚构 B 原有解释');
    expect(output()).toContain('虚构 B 原有感受'); expect(output()).toContain('已解除关联');
    await detail(a); expect(output()).toContain('虚构 A 解释'); expect(output()).toContain('虚构 A 感受');
  });

  it.each(['pattern', 'practice', 'path'] as const)('%s cancellation, failed save and retry preserve both patterns and the exact draft', async kind => {
    const { a, b } = await two(); await detail(a);
    if (kind === 'practice') await press('practice-open');
    const field = kind === 'pattern' ? 'pattern-understanding' : kind === 'practice' ? 'practice-action' : 'path-explanation';
    await press(`${kind}-edit`);
    if (kind === 'practice') await type('practice-cue', '虚构触发线索');
    await type(field, '虚构未保存编辑'); const stale = node(`${kind}-save`).props.onPress;
    const before = persisted(); storage.setItem.mockClear();
    await press(`${kind}-cancel`); await act(async () => { stale(); });
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    await press(`${kind}-edit`);
    if (kind === 'practice') await type('practice-cue', '虚构触发线索');
    await type(field, '虚构重试编辑');
    await act(async () => { stale(); }); // Same editor kind reopened, but not the same draft.
    expect(persisted()).toEqual(before); expect(node(field).props.value).toBe('虚构重试编辑');
    failWrites = true; await press(`${kind}-save`);
    expect(persisted()).toEqual(before); expect(node(field).props.value).toBe('虚构重试编辑');
    expect(output()).toContain('未保存'); expect(output()).not.toContain('已保存到此浏览器的演示空间。');
    failWrites = false; storage.setItem.mockClear();
    const save = node(`${kind}-save`).props.onPress;
    await act(async () => { save(); save(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(state(b)).toEqual(state(b, before));
    expect(nodes(`${kind}-save`)).toHaveLength(0);
    await detail(a); if (kind === 'practice') await press('practice-open');
    expect(output()).toContain('虚构重试编辑');
  });

  it('record failure and stale cancellation preserve both aggregates, then retry commits exactly one A record', async () => {
    const { a, b } = await two(); await savePractice(a, '虚构 A 记录线索', '虚构 A 记录动作'); await press('practice-activate');
    const before = persisted();
    await press('record-open'); await press('record-occurred-yes'); await press('record-action-other');
    await press('record-feeling-not_recorded'); await type('record-note', '虚构 A 失败后保留的记录');
    const cancelledSave = node('record-save').props.onPress; await press('record-cancel');
    await press('record-back'); await press('record-open'); await press('record-occurred-yes');
    await press('record-action-other'); await press('record-feeling-not_recorded'); await type('record-note', '虚构 A 第二次草稿');
    storage.setItem.mockClear(); await act(async () => { cancelledSave(); });
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    failWrites = true; await press('record-save');
    expect(persisted()).toEqual(before); expect(node('record-note').props.value).toBe('虚构 A 第二次草稿');
    expect(node('record-action-other').props.accessibilityState.checked).toBe(true);
    expect(node('record-feeling-not_recorded').props.accessibilityState.checked).toBe(true);
    expect(output()).toContain('未保存'); failWrites = false; storage.setItem.mockClear();
    const save = node('record-save').props.onPress; await act(async () => { save(); save(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(state(a).records).toHaveLength(1);
    expect(state(a).path.filter(row => row.type === 'practice')).toHaveLength(1);
    expect(state(b)).toEqual(state(b, before));
    await press('record-back'); await press('record-open'); await press('record-occurred-no'); await press('record-skip');
    expect(state(a).records).toHaveLength(1); expect(state(b)).toEqual(state(b, before));
  });

  it('unlink cancellation/failure preserves the original A and B facts and only a successful retry unlinks', async () => {
    const { a, b } = await two(); await detail(a);
    const before = persisted(); storage.setItem.mockClear();
    await press('path-remove'); const stale = node('path-remove-confirm').props.onPress;
    await press('path-remove-cancel'); await act(async () => { stale(); });
    expect(persisted()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled();
    await press('path-remove'); failWrites = true; await press('path-remove-confirm');
    expect(persisted()).toEqual(before); expect(nodes('path-remove-confirm')).toHaveLength(1);
    expect(output()).toContain('未保存'); failWrites = false; await press('path-remove-confirm');
    const original = state(a, before).path[0];
    expect(state(a).path[0]).toEqual({ ...original, linked: false, version: original.version + 1 });
    expect(state(b)).toEqual(state(b, before));
  });

  it('stale A editors, new-reply callbacks and correction target callbacks cannot save during rapid navigation', async () => {
    const { a, b } = await two(); await detail(a); await press('pattern-edit');
    await type('pattern-understanding', '虚构 A 被丢弃的草稿'); const staleEdit = node('pattern-save').props.onPress;
    const before = persisted(); storage.setItem.mockClear();
    await press('pattern-back'); await press(`pattern-open-${b}`); await press('pattern-edit');
    await type('pattern-understanding', '虚构 B 尚未保存');
    await act(async () => { staleEdit(); });
    expect(persisted()).toEqual(before); expect(node('pattern-understanding').props.value).toBe('虚构 B 尚未保存');
    await reply('虚构未确认纠正'); const lateReply = node('mock-confirm').props.onPress;
    await press('candidate-correction-choice'); await press(`candidate-target-${a}`);
    const staleCorrection = node('candidate-save').props.onPress;
    await press(`candidate-target-${b}`); await act(async () => { staleCorrection(); });
    expect(persisted()).toEqual(before);
    await press('nav-me'); await act(async () => { lateReply(); staleCorrection(); staleEdit(); });
    expect(nodes('candidate-save')).toHaveLength(0); expect(persisted()).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('read failures clear stale list/detail values and retry restores only the requested pattern', async () => {
    const { a, b } = await two(); await detail(a);
    const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    failReads = true; await press('pattern-back');
    expect(nodes(`pattern-open-${a}`)).toHaveLength(0); expect(nodes(`pattern-open-${b}`)).toHaveLength(0);
    expect(output()).not.toContain(state(a).pattern.currentUnderstanding);
    expect(nodes('list-retry')).toHaveLength(1);
    failReads = false; await press('list-retry');
    expect(nodes(`pattern-open-${a}`)).toHaveLength(1);
    failReads = true; await press(`pattern-open-${b}`);
    expect(nodes('pattern-retry')).toHaveLength(1); expect(nodes('pattern-edit')).toHaveLength(0);
    expect(output()).not.toContain(state(a).pattern.currentUnderstanding); expect(output()).not.toContain(state(b).pattern.currentUnderstanding);
    failReads = false; await press('pattern-retry');
    expect(output()).toContain(state(b).pattern.currentUnderstanding); expect(output()).not.toContain(state(a).pattern.currentUnderstanding);
    expect(values.get(STORAGE_KEY)).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('initial read failure is retryable and never turns corrupt or inaccessible storage into an empty account', async () => {
    const { a, b } = await two(); const before = values.get(STORAGE_KEY); storage.setItem.mockClear();
    failReads = true; await remount(); expect(nodes('demo-retry')).toHaveLength(1);
    expect(nodes('get-code')).toHaveLength(0); expect(output()).not.toContain('虚构 A 理解');
    expect(storage.setItem).not.toHaveBeenCalled(); failReads = false; await press('demo-retry'); await list();
    expect(nodes(`pattern-open-${a}`)).toHaveLength(1); expect(nodes(`pattern-open-${b}`)).toHaveLength(1);
    expect(values.get(STORAGE_KEY)).toBe(before);
  });

  it('unknown and foreign pattern IDs fail closed without revealing another pattern or writing', async () => {
    const { a, b } = await two(); await list();
    const original = persisted(); const staleB = node(`pattern-open-${b}`).props.onPress;
    const withoutB = { ...original, patterns: original.patterns.filter(row => row.pattern.patternId !== b) };
    values.set(STORAGE_KEY, JSON.stringify(withoutB)); storage.setItem.mockClear();
    await act(async () => { staleB(); });
    expect(output()).toMatch(/找不到|无权|不属于/); expect(nodes('pattern-edit')).toHaveLength(0);
    expect(output()).not.toContain(state(a, original).pattern.currentUnderstanding);
    expect(output()).not.toContain(state(b, original).pattern.currentUnderstanding);
    const repo = createDemoRepository(storage);
    expect(() => repo.getPattern(original.accountId!, b)).toThrow();
    expect(() => repo.getPattern('foreign-fictional-account', a)).toThrow();
    values.set(STORAGE_KEY, JSON.stringify(original)); await press('pattern-retry');
    expect(output()).toContain(state(b, original).pattern.currentUnderstanding);
    await press('pattern-back');
    const foreign = JSON.parse(JSON.stringify(original)) as Snapshot;
    state(b, foreign).pattern.accountId = 'foreign-fictional-account';
    values.set(STORAGE_KEY, JSON.stringify(foreign)); await press(`pattern-open-${b}`);
    expect(nodes('pattern-retry')).toHaveLength(1); expect(nodes('pattern-edit')).toHaveLength(0);
    expect(output()).not.toContain(state(a, original).pattern.currentUnderstanding);
    expect(output()).not.toContain(state(b, original).pattern.currentUnderstanding);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('expands only real saved clues, preserves source/confirmation and never invents missing categories or writes on collapse', async () => {
    const { a, b } = await two(); const data = persisted();
    state(a, data).pattern.clues = [{ schemaVersion: 1, demoSource: 'synthetic', accountId: data.accountId!,
      patternId: a, clueId: 'fictional-clue-A', kind: 'situation', fact: '虚构 A 已保存情境线索',
      source: '虚构测试中用户确认的具体情境', userConfirmed: true }];
    values.set(STORAGE_KEY, JSON.stringify(data)); storage.setItem.mockClear();
    await detail(a); expect(output()).not.toContain('虚构 A 已保存情境线索');
    await press('clues-toggle'); expect(output()).toContain('虚构 A 已保存情境线索');
    expect(output()).toContain('虚构测试中用户确认的具体情境'); expect(output()).toContain('确认');
    expect(output()).not.toContain('虚构 B 的线索'); expect(output()).not.toContain('例外：');
    await press('clues-toggle'); expect(output()).not.toContain('虚构 A 已保存情境线索');
    await press('pattern-back'); await press(`pattern-open-${b}`);
    expect(output()).not.toContain('虚构 A 已保存情境线索'); await press('clues-toggle');
    expect(output()).not.toContain('虚构 A 已保存情境线索');
    expect(persisted()).toEqual(data); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { source: undefined, userConfirmed: undefined },
    { source: null, userConfirmed: null },
    { source: '', userConfirmed: undefined },
  ] as const)('shows missing clue provenance as unknown without inventing source or confirmation: %p', async metadata => {
    const { a, b } = await two(); const data = persisted();
    state(a, data).pattern.clues = [{ schemaVersion: 1, demoSource: 'synthetic', accountId: data.accountId!,
      patternId: a, clueId: 'fictional-clue-unknown', kind: 'situation', fact: '虚构已存线索但来源未存', ...metadata }];
    values.set(STORAGE_KEY, JSON.stringify(data)); const raw = values.get(STORAGE_KEY); storage.setItem.mockClear();
    await detail(a); await press('clues-toggle');
    const clues = textOf('pattern-clues');
    expect(clues).toContain('虚构已存线索但来源未存'); expect(clues).toContain('来源：未提供');
    expect(clues).toContain('确认状态未知'); expect(clues).not.toContain('用户已确认'); expect(clues).not.toContain('用户未确认');
    for (const guessed of ['想法', '感受', '行为', '例外']) expect(clues).not.toContain(guessed);
    await press('clues-toggle'); await press('pattern-back'); await press(`pattern-open-${b}`); await press('clues-toggle');
    expect(textOf('pattern-clues')).not.toContain('虚构已存线索但来源未存');
    expect(values.get(STORAGE_KEY)).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('logout hides all A/B data; a fresh challenge and remount recover the same IDs and saved data', async () => {
    const { a, b } = await two(); await savePractice(a, '虚构 A 恢复线索', '虚构 A 恢复动作');
    await press('practice-activate'); await record('虚构 A 恢复记录');
    await savePractice(b, '虚构 B 恢复线索', '虚构 B 恢复动作');
    const before = persisted();
    await detail(a); await press('pattern-edit'); await type('pattern-name', '虚构不该恢复的草稿');
    const staleSave = node('pattern-save').props.onPress;
    await press('nav-me'); await press('logout');
    expect(createDemoRepository(storage).snapshot().patterns).toEqual([]);
    expect(output()).not.toContain('虚构 A 恢复记录'); expect(output()).not.toContain('虚构 B 恢复动作');
    storage.setItem.mockClear(); await act(async () => { staleSave(); }); expect(storage.setItem).not.toHaveBeenCalled();
    await login(); expect(persisted().accountId).toBe(before.accountId); expect(persisted().patterns).toEqual(before.patterns);
    await remount(); await list(); expect(nodes(`pattern-open-${a}`)).toHaveLength(1); expect(nodes(`pattern-open-${b}`)).toHaveLength(1);
    await press(`pattern-open-${a}`); expect(output()).toContain('虚构 A 恢复记录');
    expect(output()).not.toContain('虚构不该恢复的草稿'); await press('pattern-back'); await press(`pattern-open-${b}`);
    await press('practice-open'); expect(output()).toContain('虚构 B 恢复动作'); expect(output()).not.toContain('虚构 A 恢复动作');
    expect(persisted().patterns).toEqual(before.patterns);
  });

  it('reads an exact v1 snapshot without writing, then migrates once while retaining all old data and the original bytes', async () => {
    const old = legacyV1(); const raw = JSON.stringify(old); values.set(LEGACY_STORAGE_KEY, raw);
    await mount(); await list();
    const id = old.pattern.patternId; expect(nodes(`pattern-open-${id}`)).toHaveLength(1);
    await press(`pattern-open-${id}`); expect(output()).toContain('旧记录'); expect(output()).toContain('旧解释');
    expect(output()).toContain('旧感受'); expect(storage.setItem).not.toHaveBeenCalled();
    expect(values.has(STORAGE_KEY)).toBe(false); expect(values.get(LEGACY_STORAGE_KEY)).toBe(raw);
    const oldState = { pattern: old.pattern, practice: old.practice, records: old.records, path: old.path };
    expect(createDemoRepository(storage).snapshot().patterns).toEqual([oldState]);
    await reply('虚构迁移后独立的新模式'); await press('candidate-new-choice');
    failWrites = true; await press('candidate-save');
    expect(values.has(STORAGE_KEY)).toBe(false); expect(values.get(LEGACY_STORAGE_KEY)).toBe(raw);
    expect(node('candidate-text').props.value).toBe('虚构迁移后独立的新模式');
    failWrites = false; storage.setItem.mockClear(); await press('candidate-save');
    expect(storage.setItem).toHaveBeenCalledTimes(1); expect(storage.setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(persisted().patterns).toHaveLength(2); expect(state(id)).toEqual(oldState);
    expect(persisted().activePracticePatternId).toBe(id); expect(values.get(LEGACY_STORAGE_KEY)).toBe(raw);
    await remount(); await detail(id); expect(output()).toContain('旧记录'); expect(output()).toContain('旧解释');
    expect(state(id)).toEqual(oldState); expect(persisted().patterns.filter(row => row.pattern.patternId === id)).toHaveLength(1);
  });
});
