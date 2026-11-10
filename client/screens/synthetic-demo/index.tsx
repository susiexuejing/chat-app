import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useRouter } from 'expo-router';
import {
  DEMO_NUMBER, STORAGE_KEY, LEGACY_STORAGE_KEY, createDemoRepository,
  type Decision, type DemoRepository, type Pattern, type PatternState, type PathEntry, type RecordPayload, type Snapshot,
} from '@/features/synthetic-demo/repository';
import { PracticeCandidateCard, type PracticeCandidateCardHandle } from '@/features/dev-journey/PracticeCandidateCard';
import type { DevPracticeCandidate } from '@/features/dev-journey/realRequestController';
import { DevConversation, type DevUnderstandingDraft } from '@/features/dev-journey/DevConversation';

type Page = 'chat' | 'me' | 'patterns' | 'detail' | 'practice' | 'checkin';
type Scope = { accountId: string; patternId: string };
type CorrectionTarget = { patternId: string; version: number; name: string; understanding: string };
type Draft =
  | { kind: 'candidate'; accountId: string; text: string; input: string; requestId: string; mode: 'new' | 'correct' | null; target: CorrectionTarget | null; choices: Pattern[] | null; readError: string }
  | (Scope & { kind: 'mode'; name: string; understanding: string; decision: Decision; version: number })
  | (Scope & { kind: 'practice'; cue: string; action: string; version: number })
  | (Scope & { kind: 'record'; payload: RecordPayload; version: number; operationId: string; occurredChosen: boolean })
  | (Scope & { kind: 'path'; entry: PathEntry; explanation: string; feeling: string })
  | (Scope & { kind: 'unlink'; entry: PathEntry });
type Notice = { kind: 'success' | 'error'; text: string } | null;
const CHAT_STORAGE_RESET_NOTICE = '检测到本地演示数据或登录状态变化，当前对话已重置。此 Demo 请只保留一个聊天标签页；需要继续时，请重新输入并明确发送。重置不会自动改写已保存的模式和历史。';
type ReadState<T> = { status: 'idle' | 'loading'; data: null } | { status: 'error'; data: null; error: string } | { status: 'ready'; data: T };
const feelings = [ ['helped', '有帮助'], ['unchanged', '没有变化'], ['worse', '更难受'], ['not_recorded', '暂不记录'] ] as const;
const actions = [ ['agreed', '做了约定动作'], ['other', '做了其他动作'], ['none', '没有行动'] ] as const;
const decisionLabels: Record<Decision, string> = { candidate: '演示候选 · 待确认', confirmed: '已确认', uncertain: '暂不确定', rejected: '不符合' };
const decisionChoices = [ ['confirmed', '符合我的体验'], ['rejected', '不符合'], ['uncertain', '还不确定'] ] as const;
const typeLabels = { event: '事件', correction: '理解修正', practice: '练习记录', exception: '例外' };
const clueLabels = { situation: '情境', thought: '想法', feeling: '感受', behavior: '行为', exception: '例外' };
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function Button({ title, onPress, secondary = false, green = false, disabled = false, testID }: { testID?: string; title: string; onPress: () => void; secondary?: boolean; green?: boolean; disabled?: boolean }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={`rounded-xl px-4 py-3 ${secondary ? 'bg-stone-100' : green ? 'bg-green-800' : 'bg-orange-700'} ${disabled ? 'opacity-40' : ''}`} style={{ minHeight: 44 }}>
    <Text className={`text-center font-medium ${secondary ? 'text-stone-800' : 'text-white'}`}>{title}</Text>
  </Pressable>;
}
function Card({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return <View testID={testID} className="rounded-2xl bg-white p-5 gap-4 border border-stone-200">{children}</View>;
}
function Field({ label, value, onChange, multiline = false, testID, maxLength = 1000 }: { testID?: string; label: string; value: string; onChange: (text: string) => void; multiline?: boolean; maxLength?: number }) {
  return <View className="gap-2"><Text className="text-sm font-medium text-stone-700">{label}</Text>
    <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={maxLength}
      className="rounded-xl border border-stone-300 bg-white p-3 text-base text-stone-900" style={{ minHeight: multiline ? 88 : 48, textAlignVertical: 'top' }} />
  </View>;
}
function Choices<T extends string>({ label, options, value, onChange, testID }: { testID?: string; label: string; options: readonly (readonly [T, string])[]; value: T | null; onChange: (value: T) => void }) {
  return <View className="gap-2"><Text className="font-medium text-stone-800">{label}</Text><View className="flex-row flex-wrap gap-2">
    {options.map(([key, title]) => <Pressable testID={`${testID}-${key}`} key={key} accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ checked: value === key }}
      onPress={() => onChange(key)} className={`rounded-xl border px-3 py-3 ${value === key ? 'bg-orange-50 border-orange-700' : 'bg-white border-stone-300'}`}>
      <Text className="text-stone-800">{value === key ? '● ' : '○ '}{title}</Text>
    </Pressable>)}
  </View></View>;
}
function Choice({ testID, title, selected, onPress }: { testID: string; title: string; selected: boolean; onPress: () => void }) {
  return <Pressable testID={testID} accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ checked: selected }} onPress={onPress}
    className={`rounded-xl border p-3 ${selected ? 'bg-orange-50 border-orange-700' : 'bg-white border-stone-300'}`}>
    <Text className="text-stone-800">{selected ? '● ' : '○ '}{title}</Text>
  </Pressable>;
}

/** DEV only. Local journey state stays separate from explicit real chat transport. */
export default function SyntheticDemoScreen() {
  const router = useRouter();
  const repository = useRef<DemoRepository | null>(null);
  const mounted = useRef(false);
  const navigation = useRef(0);
  const [viewToken, setViewToken] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [initialError, setInitialError] = useState('');
  const [page, setPage] = useState<Page>('chat');
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [list, setList] = useState<ReadState<PatternState[]>>({ status: 'idle', data: null });
  const [detail, setDetail] = useState<ReadState<PatternState>>({ status: 'idle', data: null });
  const [cluesExpanded, setCluesExpanded] = useState(false);
  const [understandingExpanded, setUnderstandingExpanded] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [code, setCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [chatGeneration, setChatGeneration] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const accountSession = useRef<object>({});
  const practiceCard = useRef<PracticeCandidateCardHandle | null>(null);
  const practiceCandidateRef = useRef<DevPracticeCandidate | null>(null);
  const lastPracticeReceipt = useRef<string | null>(null);
  const [practiceCandidate, setPracticeCandidate] = useState<DevPracticeCandidate | null>(null);
  const invalidatePractice = useCallback(() => {
    practiceCard.current?.invalidate();
    practiceCandidateRef.current = null;
    setPracticeCandidate(null);
  }, []);
  // Only the current successful check-in can show the worse follow-up.
  const [savedWorseRecord, setSavedWorseRecord] = useState<Scope | null>(null);
  // Both scope and exact draft identity are checked synchronously. A queued
  // callback cannot revive a dismissed draft, target a newer one, or cross pages.
  const draftRef = useRef<Draft | null>(null);
  const writing = useRef(false);
  const recordSequence = useRef(0);

  const initialize = useCallback(() => {
    if (!mounted.current) return;
    setInitialError('');
    invalidatePractice(); accountSession.current = {};
    try {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        throw new Error('此 DEV 演示仅支持网页浏览器的本地存储。当前环境不可用，不会连接真实聊天。');
      }
      const repo = createDemoRepository(window.localStorage);
      const next = repo.snapshot();
      repository.current = repo;
      setSnapshot(next);
    } catch (error) {
      repository.current = null;
      setSnapshot(null);
      setInitialError(errorText(error, '本地演示无法初始化。'));
    }
  }, [invalidatePractice]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      // StrictMode replays setup after cleanup has invalidated old handlers.
      // Only this setup's microtask may initialize and publish its current epoch.
      setViewToken(navigation.current);
      initialize();
    });
    return () => {
      active = false;
      mounted.current = false;
      practiceCard.current?.invalidate(); practiceCandidateRef.current = null; accountSession.current = {};
      navigation.current += 1;
      repository.current?.cancelCode();
      repository.current = null;
      draftRef.current = null;
    };
  }, [initialize]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) return;
      const identity = (raw: string | null) => {
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { accountId?: unknown; session?: unknown };
        return JSON.stringify([parsed.accountId, parsed.session]);
      };
      try {
        if (event.key !== null && identity(event.oldValue) === identity(event.newValue)) return;
      } catch { /* Corrupt/replaced account data fails closed. */ }
      if (!mounted.current) return;
      repository.current?.cancelCode();
      invalidatePractice(); accountSession.current = {};
      draftRef.current = null; setDraft(null); setNotice(null); setSavedWorseRecord(null);
      navigation.current += 1; setViewToken(navigation.current); setChatGeneration(value => value + 1);
      setCode(''); setEnteredCode(''); setPage('chat');
      setSelectedPatternId(null); setList({ status: 'idle', data: null }); setDetail({ status: 'idle', data: null });
      initialize();
      setNotice({ kind: 'error', text: CHAT_STORAGE_RESET_NOTICE });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [initialize, invalidatePractice]);

  function currentView() { return mounted.current && navigation.current === viewToken; }
  function beforeChatSend() {
    if (!currentView() || !repository.current || !snapshot?.session) return false;
    try {
      const current = repository.current.snapshot();
      if (current.session === snapshot.session && current.revision === snapshot.revision) return true;
    } catch { /* Do not send under an unreadable/stale account. */ }
    changeDraft(null); invalidateView(); setChatGeneration(value => value + 1); initialize();
    setNotice({ kind: 'error', text: CHAT_STORAGE_RESET_NOTICE });
    return false;
  }
  function invalidateView() { invalidatePractice(); navigation.current += 1; setViewToken(navigation.current); }
  function changeDraft(next: Draft | null) {
    setNotice(null);
    draftRef.current = next;
    setDraft(next);
  }
  function editDraft(previous: Draft, next: Draft | null) {
    if (currentView() && draftRef.current === previous) changeDraft(next);
  }
  function loadList() {
    setList({ status: 'loading', data: null });
    try {
      if (!repository.current) throw new Error('本地演示尚未就绪，请重试。');
      const next = repository.current.snapshot();
      if (!next.session || next.session !== snapshot?.session) throw new Error('账户已变化，请退出后重新登录。');
      setSnapshot(next);
      setList({ status: 'ready', data: next.patterns });
    } catch (error) { setList({ status: 'error', data: null, error: errorText(error, '模式列表未能加载。') }); }
  }
  function loadDetail(patternId: string) {
    // Always remove the previous detail before reading the next ID.
    setDetail({ status: 'loading', data: null });
    try {
      if (!repository.current || !snapshot?.session) throw new Error('请先登录演示账号。');
      const next = repository.current.snapshot();
      if (next.session !== snapshot.session) throw new Error('账户已变化，请退出后重新登录。');
      const selected = repository.current.getPattern(next.session, patternId);
      if (selected.pattern.accountId !== next.session || selected.pattern.patternId !== patternId) throw new Error('找不到这条模式，或它不属于当前账户。');
      setSnapshot(next);
      setDetail({ status: 'ready', data: selected });
    } catch (error) { setDetail({ status: 'error', data: null, error: errorText(error, '模式详情未能加载。') }); }
  }
  function navigate(next: Page, patternId: string | null = null) {
    if (!currentView()) return;
    repository.current?.cancelCode();
    changeDraft(null);
    invalidateView();
    setPage(next);
    setSavedWorseRecord(null);
    setSelectedPatternId(patternId);
    setDetail({ status: 'idle', data: null });
    setList({ status: 'idle', data: null });
    setCluesExpanded(false);
    setUnderstandingExpanded(false);
    setChatGeneration(value => value + 1);
    setCode('');
    setEnteredCode('');
    if (next === 'patterns' && snapshot?.session) loadList();
    if (patternId && snapshot?.session) loadDetail(patternId);
  }
  function retryList() { if (currentView()) { changeDraft(null); invalidateView(); loadList(); } }
  function retryDetail() { if (currentView() && selectedPatternId) { changeDraft(null); invalidateView(); loadDetail(selectedPatternId); } }
  function write(operation: (repo: DemoRepository) => Snapshot, message: string, onSuccess?: () => void) {
    if (!currentView() || writing.current || !repository.current) return;
    setNotice(null);
    writing.current = true;
    try {
      const next = operation(repository.current);
      setSnapshot(next);
      changeDraft(null);
      invalidateView();
      if (selectedPatternId) {
        const selected = next.patterns.find(item => item.pattern.patternId === selectedPatternId && item.pattern.accountId === next.session);
        setDetail(selected ? { status: 'ready', data: selected } : { status: 'error', data: null, error: '找不到这条模式，或它不属于当前账户。' });
      }
      if (page === 'patterns') setList({ status: 'ready', data: next.patterns });
      if (next.session !== snapshot?.session) {
        accountSession.current = {}; lastPracticeReceipt.current = null;
        setPage('chat');
        setSelectedPatternId(null);
        setList({ status: 'idle', data: null });
        setDetail({ status: 'idle', data: null });
        setChatGeneration(value => value + 1);
        setCode(''); setEnteredCode('');
      }
      setNotice({ kind: 'success', text: message });
      onSuccess?.();
    } catch (error) {
      // Keep exact scope, versions and operationId for a safe retry, not old success.
      setNotice({ kind: 'error', text: errorText(error, '保存失败，草稿已保留。') });
    } finally { writing.current = false; }
  }
  function saveDraft(expected: Draft) {
    if (!currentView() || draftRef.current !== expected || expected.kind === 'unlink') return;
    const current = expected;
    write(repo => {
      if (current.kind === 'candidate') {
        if (!current.mode || current.choices === null || (current.mode === 'correct' && !current.target)) throw new Error('请明确选择保存为新模式，或选择要修正的模式；不会自动关联。');
        return repo.confirmDevUnderstanding(current.accountId, {
          text: current.text, input: current.input, requestId: current.requestId,
          relation: current.mode === 'new' ? 'create-new' : 'correct-current',
        }, current.mode === 'new' ? 0 : current.target!.version, current.mode === 'new' ? undefined : current.target!.patternId);
      }
      if (current.patternId !== selectedPatternId || current.accountId !== snapshot?.session) throw new Error('模式选择已变化，请重新打开后再编辑。');
      if (current.kind === 'mode') return repo.updatePattern(current.accountId, current.patternId, { name: current.name, currentUnderstanding: current.understanding, decision: current.decision }, current.version);
      if (current.kind === 'practice') return repo.savePractice(current.accountId, current.patternId, { ifCue: current.cue, thenAction: current.action }, current.version);
      if (current.kind === 'record') {
        if (!current.occurredChosen) throw new Error('请先选择触发情境是否发生，草稿尚未保存。');
        return repo.saveRecord(current.accountId, current.patternId, current.payload, current.version, current.operationId);
      }
      return repo.updatePath(current.accountId, current.patternId, current.entry.entryId, { explanation: current.explanation, feeling: current.feeling }, current.entry.version);
    }, '已保存到此浏览器的演示空间。', () => {
      if (current.kind === 'record') setSavedWorseRecord(current.payload.feeling === 'worse'
        ? { accountId: current.accountId, patternId: current.patternId } : null);
    });
  }
  function startRecord() {
    if (!currentView() || detail.status !== 'ready' || !snapshot?.session || !selectedPatternId) return;
    const practice = detail.data.practice;
    if (!practice || practice.paused || snapshot.activePracticePatternId !== selectedPatternId) return;
    navigate('checkin', selectedPatternId);
    recordSequence.current += 1;
    changeDraft({ kind: 'record', accountId: snapshot.session, patternId: selectedPatternId, occurredChosen: false, version: practice.version,
      operationId: `record-${Date.now()}-${recordSequence.current}-${Math.random().toString(36).slice(2)}`,
      payload: { occurred: false, action: null, feeling: null, note: '' } });
  }
  function candidate(result: DevUnderstandingDraft) {
    if (!currentView() || page !== 'chat' || !snapshot?.session) return;
    const next: Draft = { kind: 'candidate', ...result, accountId: snapshot.session, mode: null, target: null, choices: null, readError: '' };
    try {
      if (!repository.current) throw new Error('本地演示尚未就绪。');
      const fresh = repository.current.snapshot();
      if (fresh.session !== next.accountId) throw new Error('账户已变化，请退出后重新登录。');
      next.choices = fresh.patterns.map(item => item.pattern);
      setSnapshot(fresh);
    } catch (error) { next.readError = errorText(error, '未能读取模式，请重试。'); }
    changeDraft(next);
  }
  function retryCandidate(previous: Extract<Draft, { kind: 'candidate' }>) {
    if (!currentView() || draftRef.current !== previous) return;
    candidate({ text: previous.text, input: previous.input, requestId: previous.requestId });
  }
  function receivePracticeCandidate(result: DevPracticeCandidate) {
    if (!currentView() || page !== 'chat' || !snapshot?.session || !repository.current || practiceCandidateRef.current) return;
    const identity = JSON.stringify(result.source);
    if (lastPracticeReceipt.current === identity) return;
    try {
      const fresh = repository.current.snapshot();
      if (fresh.session !== snapshot.session || fresh.revision !== snapshot.revision) return;
      lastPracticeReceipt.current = identity;
      practiceCandidateRef.current = result; setPracticeCandidate(result);
    } catch { invalidatePractice(); }
  }
  function renderPracticeCandidate() {
    if (!practiceCandidate || !repository.current || !snapshot?.session) return null;
    const expected = practiceCandidate;
    return <PracticeCandidateCard key={JSON.stringify(expected.source)} ref={practiceCard} candidate={expected}
      repository={repository.current} accountId={snapshot.session} accountSession={accountSession.current}
      onDismiss={() => { if (practiceCandidateRef.current === expected) invalidatePractice(); }}
      onSaved={next => {
        if (!currentView() || practiceCandidateRef.current !== expected) return;
        invalidatePractice(); setSnapshot(next);
        setNotice({ kind: 'success', text: '已保存到你选择的模式。未自动开启练习。' });
      }} />;
  }
  function discardChatDraft() {
    if (!currentView()) return;
    changeDraft(null);
    invalidateView();
  }
  function saveButtons(current: Exclude<Draft, { kind: 'unlink' }>, label = '保存') {
    const prefix = current.kind === 'mode' ? 'pattern' : current.kind;
    const incomplete = (current.kind === 'candidate' && (!current.mode || current.choices === null || (current.mode === 'correct' && !current.target)))
      || (current.kind === 'record' && (!current.occurredChosen || (current.payload.occurred && (!current.payload.action || (current.payload.action !== 'none' && !current.payload.feeling)))));
    return <View className="gap-2"><Button testID={`${prefix}-save`} disabled={incomplete} title={label} onPress={() => saveDraft(current)} />
      <Button testID={`${prefix}-cancel`} title="取消 · 丢弃草稿" secondary onPress={() => editDraft(current, null)} /></View>;
  }
  const selected = detail.status === 'ready' && detail.data.pattern.patternId === selectedPatternId && detail.data.pattern.accountId === snapshot?.session ? detail.data : null;
  const pattern = selected?.pattern;
  const practice = selected?.practice;
  const signedIn = Boolean(snapshot?.session);

  function renderDraft() {
    if (!draft || draft.kind === 'unlink') return null;
    const current = draft;
    return <Card testID="draft-editor"><Text className="text-lg font-semibold text-stone-900">{current.kind === 'record' ? '记录这一次' : '编辑草稿'}</Text>
      <Text className="text-sm text-stone-600">只有点击保存才会写入；取消、切换页面或退出会丢弃草稿。</Text>
      {current.kind === 'candidate' && <>
        <Field testID="candidate-text" label="我的理解（可修改）" value={current.text} maxLength={2000} multiline onChange={text => editDraft(current, { ...current, text })} />
        <Text className="text-sm text-stone-600">来源：本次 DEV 服务端 Deep 回复，可编辑确认；实际供应商和模型未核验。不是诊断。</Text>
        {current.choices === null ? <><Text className="text-red-800">{current.readError || '未能读取模式。'}</Text><Button testID="candidate-retry" title="重试读取模式" secondary onPress={() => retryCandidate(current)} /></> : <>
          <Text className="font-medium text-stone-800">这次理解要保存在哪里？</Text>
          <Choice testID="candidate-new-choice" title="保存为一个新模式" selected={current.mode === 'new'} onPress={() => editDraft(current, { ...current, mode: current.mode === 'new' ? null : 'new', target: null })} />
          <Text className="text-sm text-stone-600">新模式单独保存，不覆盖已有模式，也不自动开启练习。</Text>
          {current.choices.length > 0 && <>
            <Choice testID="candidate-correction-choice" title="修正一个已有模式，保留它的练习与历史" selected={current.mode === 'correct'} onPress={() => editDraft(current, { ...current, mode: current.mode === 'correct' ? null : 'correct', target: null })} />
            {current.mode === 'correct' && <View className="gap-3"><Text className="text-stone-700">请选择要修正的模式：</Text>
              {current.choices.map(item => <Choice key={item.patternId} testID={`candidate-target-${item.patternId}`} title={`${item.name}：${item.currentUnderstanding}`}
                selected={current.target?.patternId === item.patternId} onPress={() => editDraft(current, { ...current, target: current.target?.patternId === item.patternId ? null : {
                  patternId: item.patternId, version: item.version, name: item.name, understanding: item.currentUnderstanding,
                } })} />)}
              {current.target && <Text testID="candidate-target-summary" className="text-sm text-stone-700">仅修正「{current.target.name}」。原理解：{current.target.understanding}</Text>}
            </View>}
          </>}
        </>}
      </>}
      {current.kind === 'mode' && <>
        <Field testID="pattern-name" label="模式名称" value={current.name} maxLength={80} onChange={name => editDraft(current, { ...current, name })} />
        <Field testID="pattern-understanding" label="当前理解" value={current.understanding} maxLength={2000} multiline onChange={understanding => editDraft(current, { ...current, understanding })} />
        <Choices<Decision> testID="pattern-decision" label="这条模式符合我的体验吗？" options={decisionChoices} value={current.decision}
          onChange={decision => editDraft(current, { ...current, decision })} />
        <Text className="text-sm text-stone-600">判断在保存后生效，之后仍可重新判断。只改文字会保留原判断；尚未判断的候选不会自动确认，也不必填写完整解释。</Text>
      </>}
      {current.kind === 'practice' && <>
        <Field testID="practice-cue" label="如果（触发线索）" value={current.cue} maxLength={200} onChange={cue => editDraft(current, { ...current, cue })} />
        <Field testID="practice-action" label="那么（约定动作）" value={current.action} maxLength={200} multiline onChange={action => editDraft(current, { ...current, action })} />
        <Text className="text-sm text-stone-600">只调整这个模式的练习。新练习保存后需单独开启；不会自动切换正在进行的练习。</Text>
      </>}
      {current.kind === 'record' && <>
        <Choices testID="record-occurred" label="这次触发情境发生了吗？" value={current.occurredChosen ? (current.payload.occurred ? 'yes' : 'no') : null} options={[[ 'yes', '发生了' ], [ 'no', '未发生' ]]}
          onChange={value => editDraft(current, { ...current, occurredChosen: true, payload: { ...current.payload, occurred: value === 'yes', action: null, feeling: null } })} />
        {current.occurredChosen && (current.payload.occurred ? <>
          <Choices testID="record-action" label="行动情况" options={actions} value={current.payload.action} onChange={action => editDraft(current, { ...current, payload: { ...current.payload, action, feeling: null } })} />
          {(current.payload.action === 'agreed' || current.payload.action === 'other') && <Choices testID="record-feeling" label="行动后的感受" options={feelings} value={current.payload.feeling} onChange={feeling => editDraft(current, { ...current, payload: { ...current.payload, feeling } })} />}
        </> : <Text className="text-stone-600">未发生也可以保存，不会被标记为失败或例外。</Text>)}
        {current.payload.feeling === 'worse' && <View testID="record-worse-guidance" className="gap-3 rounded-xl bg-orange-50 p-4">
          <Text className="text-stone-800">如果练习让你更难受，可以先停下来，不必继续重复。保存这次记录后，你可以选择暂停或调整练习；也可以不保存，直接前往练习页。</Text>
          <Button testID="record-worse-leave" title="不保存本次记录，去调整或暂停" secondary onPress={() => { if (draftRef.current === current) navigate('practice', current.patternId); }} />
        </View>}
        <Field testID="record-note" label="补充说明（可选，仅填写虚构内容）" value={current.payload.note ?? ''} maxLength={200} multiline onChange={note => editDraft(current, { ...current, payload: { ...current.payload, note } })} />
      </>}
      {current.kind === 'path' && <>
        <Text className="text-stone-800">不可更改的事实：{current.entry.fact}</Text>
        <Text className="text-sm text-stone-600">来源：{current.entry.source} · 类型：{typeLabels[current.entry.type]}</Text>
        <Field testID="path-explanation" label="我的解释" value={current.explanation} multiline onChange={explanation => editDraft(current, { ...current, explanation })} />
        <Field testID="path-feeling" label="我的感受" value={current.feeling} onChange={feeling => editDraft(current, { ...current, feeling })} />
      </>}
      {saveButtons(current, current.kind === 'record' ? '保存这次记录' : '保存')}
      {current.kind === 'record' && <Button testID="record-skip" title="跳过 · 不保存" secondary onPress={() => { if (draftRef.current === current) navigate('practice', current.patternId); }} />}
    </Card>;
  }

  function renderPath(state: PatternState) {
    return <View testID="path-inline" className="gap-4">
      <Text className="text-xl font-semibold text-stone-900">我的路径</Text>
      <Text className="text-sm text-stone-600">这里只显示这个模式已保存的事实与来源。解释和感受可以修正；解除关联不会删除原始事实。</Text>
      {state.path.length === 0 && <Text className="text-stone-600">这个模式还没有保存的路径记录。</Text>}
      {[...state.path].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(entry => {
        const record = state.records.find(item => item.recordId === entry.recordId);
        const scope = { accountId: state.pattern.accountId, patternId: state.pattern.patternId };
        return <View key={entry.entryId} testID={`path-entry-${entry.entryId}`} className="flex-row gap-3">
          <View className="items-center"><View className="h-3 w-3 rounded-full bg-green-700 mt-1" /><View className="w-px flex-1 bg-green-200 mt-2" /></View>
          <View className="flex-1 gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <Text className="font-semibold text-stone-900">{typeLabels[entry.type]} · {entry.linked ? '已关联' : '已解除关联'}</Text>
            <Text className="text-xs text-stone-500">保存时间：{new Date(entry.createdAt).toLocaleString('zh-CN')}</Text>
            <Text className="text-stone-800">事实（不可改）：{entry.fact}</Text><Text className="text-sm text-stone-600">来源（不可改）：{entry.source}</Text>
            <Text className="text-sm text-stone-600">{entry.demoSource === 'dev-api-test' ? 'DEV 测试流程' : '历史合成示例'} · 用户确认</Text>
            {entry.oldUnderstanding !== undefined && <Text className="text-stone-700">原理解：{entry.oldUnderstanding}</Text>}
            {entry.currentUnderstanding !== undefined && <Text className="text-stone-700">新理解：{entry.currentUnderstanding}</Text>}
            {record && <View className="gap-1"><Text className="text-stone-700">情境发生：{record.occurred ? '是' : '否'}</Text>
              <Text className="text-stone-700">原始行动：{actions.find(([key]) => key === record.action)?.[1] ?? '不适用'}</Text>
              <Text className="text-stone-700">原始感受：{feelings.find(([key]) => key === record.feeling)?.[1] ?? '不适用'}</Text>
              {!!record.note && <Text className="text-stone-700">原始补充：{record.note}</Text>}
            </View>}
            <Text className="text-stone-700">我的解释：{entry.explanation || '未补充'}</Text><Text className="text-stone-700">我的感受：{entry.feeling || '未补充'}</Text>
            <Button testID="path-edit" title="编辑感受与解释" secondary onPress={() => { if (currentView()) changeDraft({ kind: 'path', ...scope, entry, explanation: entry.explanation ?? '', feeling: entry.feeling ?? '' }); }} />
            {entry.linked && <Button testID="path-remove" title="解除关联" secondary onPress={() => { if (currentView()) changeDraft({ kind: 'unlink', ...scope, entry }); }} />}
          </View>
        </View>;
      })}
    </View>;
  }

  function renderBody() {
    if (initialError) return <Card><Text className="text-red-800">{initialError}</Text><Text className="text-stone-600">请检查浏览器本地存储后重试。不会覆盖原数据或回退到真实服务。</Text><Button testID="demo-retry" title="重试加载演示" secondary onPress={() => { if (currentView()) initialize(); }} /></Card>;
    if (!snapshot) return <Text className="text-stone-700">正在准备本地演示…</Text>;
    if (!signedIn) return <Card>
      <Text className="text-2xl font-semibold text-stone-900">进入虚构演示账号</Text>
      <Text className="text-stone-600">不发送短信，不验证真实身份。请勿输入真实手机号或私人内容。</Text>
      <TextInput testID="number" accessibilityLabel="虚构演示号码" editable={false} value={DEMO_NUMBER} className="text-lg text-stone-900" />
      <Button testID="get-code" title={code ? '重新生成演示验证码' : '获取演示验证码'} onPress={() => {
        if (!currentView()) return;
        setNotice(null); setEnteredCode(''); setCode('');
        invalidateView();
        try { setCode(repository.current?.requestCode(DEMO_NUMBER) ?? ''); }
        catch (error) { setNotice({ kind: 'error', text: errorText(error, '生成失败。') }); }
      }} />
      {code !== '' && <><Text testID="displayed-code" selectable className="text-lg font-semibold text-orange-800">本次演示验证码：{code}</Text>
        <Field testID="code" label="输入上方六位演示验证码" value={enteredCode} maxLength={6} onChange={value => { if (currentView()) { setNotice(null); setEnteredCode(value); } }} />
        <Button testID="login" title="登录演示账号" onPress={() => write(repo => repo.login(enteredCode), '已进入虚构演示账号。')} />
      </>}
    </Card>;
    if (page === 'chat') return <DevConversation beforeSend={beforeChatSend} resetKey={chatGeneration} onConfirm={candidate} onDraftDiscard={discardChatDraft} onPracticeCandidate={receivePracticeCandidate} onPracticeInvalidate={invalidatePractice} footer={<>{renderPracticeCandidate()}{renderDraft()}</>} />;
    if (page === 'me') return <>
      <Text className="text-2xl font-semibold text-stone-900">我的</Text>
      <Card><Text className="text-lg font-semibold text-stone-900">我的模式</Text><Text className="text-stone-600">查看自己确认的理解、各自的练习和路径。</Text>
        <Button testID="mode-open" title="我的模式" secondary onPress={() => navigate('patterns')} /></Card>
      <Card><Text className="text-lg font-semibold text-stone-900">账户信息</Text><Text className="text-stone-600">虚构账号 · {DEMO_NUMBER}</Text><Text className="text-sm text-stone-600">仅保存在这个浏览器。退出后重新登录同一个演示账号可以继续查看已保存内容。</Text>
        <Button testID="logout" title="退出演示账号" secondary onPress={() => {
          if (!currentView()) return;
          invalidatePractice(); accountSession.current = {}; changeDraft(null); repository.current?.cancelCode(); setChatGeneration(value => value + 1); setCode(''); setEnteredCode('');
          write(repo => repo.logout(), '已退出，未保存草稿已丢弃。');
        }} /></Card>
    </>;
    if (page === 'patterns') return <View testID="patterns-list" className="gap-4">
      <Button testID="patterns-back" title="返回我的" secondary onPress={() => navigate('me')} />
      <Text className="text-2xl font-semibold text-stone-900">我的模式</Text>
      <Text className="text-stone-600">选择一条，查看它的理解、练习和路径。这里只保留你明确保存的内容。</Text>
      {list.status === 'error' ? <Card><Text className="text-red-800">模式列表未能加载：{list.error}</Text><Button testID="list-retry" title="重试读取列表" secondary onPress={retryList} /></Card>
        : list.status !== 'ready' ? <Text className="text-stone-600">正在读取模式…</Text>
          : list.data.length === 0 ? <Card testID="patterns-empty"><Text className="text-stone-700">还没有已确认的模式。先在聊天中确认理解，再明确保存为新模式。</Text><Button title="去聊天" onPress={() => navigate('chat')} /></Card>
            : list.data.map(({ pattern: item }) => <Pressable key={item.patternId} testID={`pattern-open-${item.patternId}`} accessibilityRole="button" accessibilityLabel={`查看模式：${item.name}`}
              onPress={() => navigate('detail', item.patternId)} className="rounded-2xl border border-stone-200 bg-white p-5 gap-2" style={{ minHeight: 80 }}>
              <View className="flex-row items-center gap-3"><Text className="flex-1 text-lg font-semibold text-orange-800">{item.name}</Text><Text className="text-xl text-orange-700">›</Text></View>
              <Text className="text-stone-700" numberOfLines={2}>{item.currentUnderstanding || '尚未填写当前理解'}</Text>
              <Text className="text-xs text-stone-500">{decisionLabels[item.decision]} · {item.demoSource === 'dev-api-test' ? 'DEV 回复 · 用户确认' : '合成演示内容'}</Text>
            </Pressable>)}
    </View>;
    if (!selected || !pattern || !selectedPatternId) return <>
      <Button testID="pattern-back" title="返回模式列表" secondary onPress={() => navigate('patterns')} />
      <Card testID="pattern-error"><Text className="text-red-800">{detail.status === 'error' ? `模式详情未能加载：${detail.error}` : '未能加载所选模式。'}</Text>
        <Button testID="pattern-retry" title="重试读取详情" secondary onPress={retryDetail} /></Card>
    </>;
    const scope = { accountId: pattern.accountId, patternId: pattern.patternId };
    if (page === 'detail') return <View testID="pattern-detail" className="gap-5">
      <Button testID="pattern-back" title="返回模式列表" secondary onPress={() => navigate('patterns')} />
      <View className="gap-2"><Text className="text-sm text-stone-600">模式详情</Text><Text className="text-2xl font-semibold text-orange-800">{pattern.name}</Text>
        <Text className="text-sm text-stone-600">{decisionLabels[pattern.decision]} · {pattern.demoSource === 'dev-api-test' ? 'DEV 回复 · 用户确认' : '历史合成示例'} · 不是诊断</Text></View>
      <Card><Text className="text-lg font-semibold text-stone-900">我的当前理解</Text>
        <Text testID="pattern-understanding-current" className="text-base text-stone-800">{!understandingExpanded && pattern.currentUnderstanding.length > 180 ? `${pattern.currentUnderstanding.slice(0, 180)}…` : pattern.currentUnderstanding || '尚未填写当前理解。'}</Text>
        {pattern.currentUnderstanding.length > 180 && <Button testID="understanding-toggle" title={understandingExpanded ? '收起理解' : '展开完整理解'} secondary onPress={() => { if (currentView()) setUnderstandingExpanded(value => !value); }} />}
        <Button testID="pattern-edit" title="编辑理解与重新判断" secondary onPress={() => { if (currentView()) changeDraft({ kind: 'mode', ...scope, name: pattern.name, understanding: pattern.currentUnderstanding, decision: pattern.decision, version: pattern.version }); }} />
        <Pressable testID="clues-toggle" accessibilityRole="button" accessibilityState={{ expanded: cluesExpanded }} onPress={() => { if (currentView()) setCluesExpanded(value => !value); }} className="py-3" style={{ minHeight: 44 }}>
          <Text className="font-medium text-green-800">{cluesExpanded ? '收起线索' : `了解更多 · 已有线索（${pattern.clues.length}）`}</Text>
        </Pressable>
        {cluesExpanded && <View testID="pattern-clues" className="gap-3">{pattern.clues.length === 0 ? <Text className="text-sm text-stone-600">暂无单独保存的线索。下方路径仅呈现已保存的事实，不补充推测。</Text>
          : pattern.clues.map(clue => <View key={clue.clueId} className="gap-1"><Text className="font-medium text-stone-800">{clueLabels[clue.kind]}</Text><Text className="text-stone-700">{clue.fact}</Text>
            <Text className="text-xs text-stone-500">来源：{clue.source?.trim() || '未提供'} · {clue.userConfirmed === true ? '用户已确认' : clue.userConfirmed === false ? '用户未确认' : '确认状态未知'}</Text></View>)}</View>}
      </Card>
      <Card><Text className="text-lg font-semibold text-stone-900">我的练习</Text>
        {practice ? <><Text className="text-stone-800">如果：{practice.ifCue}</Text><Text className="text-stone-800">那么：{practice.thenAction}</Text><Text className="text-sm text-green-800">{practice.paused ? '尚未开始或已暂停' : '进行中'}</Text></> : <Text className="text-stone-600">还没有为这个模式保存练习。</Text>}
        <Button testID="practice-open" title="调整这个模式的练习" green onPress={() => navigate('practice', pattern.patternId)} />
      </Card>
      {renderDraft()}
      {renderPath(selected)}
    </View>;
    if (page === 'practice') return <>
      <Button testID="practice-back" title="返回模式详情" secondary onPress={() => navigate('detail', pattern.patternId)} />
      <Card><Text className="text-sm text-orange-800">{pattern.name}</Text><Text className="text-2xl font-semibold text-stone-900">我的练习</Text>
        {practice ? <><Text className="text-stone-800">如果：{practice.ifCue}</Text><Text className="text-stone-800">那么：{practice.thenAction}</Text></> : <Text className="text-stone-700">请自行填写一个触发线索与动作。</Text>}
        {practice?.candidateOrigin && <Text testID="practice-suggestion-source" className="text-sm text-stone-600">来源：AI 建议 · 经你编辑或核对后明确保存</Text>}
        <Text className="text-sm text-stone-600">{!practice ? '尚未保存' : practice.paused ? '已保存 · 尚未开始或已暂停' : '已确认 · 进行中'}</Text>
        <Button testID="practice-edit" title={practice ? '编辑练习' : '填写这个模式的练习'} green onPress={() => { if (currentView()) changeDraft({ kind: 'practice', ...scope, cue: practice?.ifCue ?? '', action: practice?.thenAction ?? '', version: practice?.version ?? 0 }); }} />
        {practice && <><Button testID="record-open" title="记录这一次" green disabled={practice.paused || snapshot.activePracticePatternId !== pattern.patternId} onPress={startRecord} />
          {!practice.paused ? <Button testID="practice-pause" title="暂停练习" secondary onPress={() => { if (currentView()) { changeDraft(null); write(repo => repo.pausePractice(scope.accountId, scope.patternId, practice.version), '这个模式的练习已暂停。'); } }} />
            : <><Text className="text-sm text-stone-600">同一账户最多开启一个练习。开启这一个不会自动暂停或更改其他模式。</Text>
              {snapshot.activePracticePatternId && snapshot.activePracticePatternId !== pattern.patternId && <Text testID="practice-active-conflict" className="text-sm text-orange-800">另一个模式的练习正在进行。请返回列表，主动暂停它后再开启这里的练习。</Text>}
              <Button testID="practice-activate" title="开启这个练习" green onPress={() => { if (currentView()) { changeDraft(null); write(repo => repo.activatePractice(scope.accountId, scope.patternId, practice.version), '这个模式的练习已开启。'); } }} /></>}
        </>}
      </Card>{renderDraft()}
    </>;
    const showWorseFollowup = savedWorseRecord?.accountId === scope.accountId && savedWorseRecord.patternId === scope.patternId;
    return <><Button testID="record-back" title={draft ? '返回练习 · 丢弃草稿' : '返回练习'} secondary onPress={() => navigate('practice', pattern.patternId)} />
      {draft ? renderDraft() : <Card>
        {showWorseFollowup ? <View testID="record-worse-followup" className="gap-3">
          <Text className="text-stone-800">这次记录已保存。如果练习让你更难受，可以先暂停，或调整动作，不必继续重复。</Text>
          {practice && <>
            {!practice.paused ? <Button testID="record-worse-pause" title="暂停这个练习" secondary onPress={() => {
              if (currentView()) write(repo => repo.pausePractice(scope.accountId, scope.patternId, practice.version), '这个模式的练习已暂停。');
            }} /> : <Text testID="record-worse-paused" className="text-stone-700">这个模式的练习已暂停。</Text>}
            <Button testID="record-worse-edit" title="调整这个练习" secondary onPress={() => {
              if (!currentView()) return;
              navigate('practice', pattern.patternId);
              changeDraft({ kind: 'practice', ...scope, cue: practice.ifCue, action: practice.thenAction, version: practice.version });
            }} />
          </>}
        </View> : <><Text className="text-stone-800">本次编辑已结束。</Text><Button testID="record-new" title="记录新的一次" green onPress={startRecord} /></>}
        <Button testID="path-open" title="查看这个模式的路径" secondary onPress={() => navigate('detail', pattern.patternId)} />
      </Card>}
    </>;
  }

  return <Screen backgroundColor="#fafaf9" statusBarStyle="dark">
    <View className="flex-1 bg-stone-50">
      <View className="border-b border-orange-200 bg-orange-50 px-5 py-3"><Text className="font-semibold text-orange-900">DEV · 真实聊天与本地体验流程</Text>
        <Text className="text-xs text-orange-900">虚构账号，无短信；聊天仅在点击发送后调用现有 DEV API。模式、练习和路径只保存在本浏览器。</Text>
        <Button testID="return-live-chat" title="返回原聊天与历史" secondary onPress={() => { if (currentView()) { navigate('chat'); router.replace('/'); } }} />
      </View>
      {notice && <View accessibilityLiveRegion="polite" className={`rounded-xl p-4 ${notice.kind === 'error' ? 'bg-red-50' : 'bg-green-50'}`}><Text className={notice.kind === 'error' ? 'text-red-800' : 'text-green-800'}>{notice.text}</Text></View>}
      {signedIn && page === 'chat' && !initialError ? renderBody() : <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center', paddingBottom: 32 }}>
        {renderBody()}
      </ScrollView>}
      <View className="flex-row border-t border-stone-200 bg-white px-5 py-3 gap-4">
        <View className="flex-1"><Button testID="nav-chat" title="聊天" green secondary={page !== 'chat'} onPress={() => navigate('chat')} /></View>
        <View className="flex-1"><Button testID="nav-me" title="我的" green secondary={page === 'chat'} onPress={() => navigate('me')} /></View>
      </View>
      <Modal visible={draft?.kind === 'unlink'} transparent animationType="fade" onRequestClose={() => { if (draft) editDraft(draft, null); }}>
        <View className="flex-1 items-center justify-center bg-black/40 p-6"><View className="w-full max-w-lg"><Card>
          <Text className="text-xl font-semibold text-stone-900">解除这条路径的关联？</Text><Text className="text-stone-700">只解除这个模式中这一条路径的关联。原始事实、来源和类型仍保留，不会改动其他模式。</Text>
          {notice?.kind === 'error' && <Text accessibilityLiveRegion="polite" className="text-red-800">{notice.text}</Text>}
          <Button testID="path-remove-confirm" title="确认解除关联" onPress={() => {
            if (!currentView() || !draft || draft.kind !== 'unlink' || draftRef.current !== draft || draft.patternId !== selectedPatternId || draft.accountId !== snapshot?.session) return;
            write(repo => repo.updatePath(draft.accountId, draft.patternId, draft.entry.entryId, { linked: false }, draft.entry.version), '已解除关联，原始事实仍保留。');
          }} /><Button testID="path-remove-cancel" title="取消 · 保留关联" secondary onPress={() => { if (draft) editDraft(draft, null); }} />
        </Card></View></View>
      </Modal>
    </View>
  </Screen>;
}
