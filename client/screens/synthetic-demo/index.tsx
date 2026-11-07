import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useRouter } from 'expo-router';
import {
  DEMO_NUMBER, PRACTICE_TEXT, createDemoRepository,
  type Decision, type DemoRepository, type PathEntry, type RecordPayload, type Snapshot,
} from '@/features/synthetic-demo/repository';

import { DevConversation, type DevUnderstandingDraft } from '@/features/dev-journey/DevConversation';

type Page = 'chat' | 'me' | 'mode' | 'practice' | 'checkin' | 'path';
type Draft =
  | { kind: 'candidate'; text: string; input: string; requestId: string; decision: Decision; version: number }
  | { kind: 'mode'; name: string; understanding: string; version: number }
  | { kind: 'practice'; cue: string; action: string; version: number }
  | { kind: 'record'; payload: RecordPayload; version: number; operationId: string; occurredChosen: boolean }
  | { kind: 'path'; entry: PathEntry; explanation: string; feeling: string }
  | { kind: 'unlink'; entry: PathEntry };
type Notice = { kind: 'success' | 'error'; text: string } | null;
const feelings = [ ['helped', '有帮助'], ['unchanged', '没有变化'], ['worse', '更难受'], ['not_recorded', '暂不记录'] ] as const;
const actions = [ ['agreed', '做了约定动作'], ['other', '做了其他动作'], ['none', '没有行动'] ] as const;
const decisionLabels: Record<Decision, string> = { candidate: '候选 · 未确认', confirmed: '已确认', uncertain: '暂不确定', rejected: '不符合' };
const typeLabels = { event: '事件', correction: '修正', practice: '练习记录', exception: '例外' };

function Button({ title, onPress, secondary = false, disabled = false, testID }: { testID?: string; title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={`rounded-2xl px-4 py-3 ${secondary ? 'bg-stone-100' : 'bg-amber-700'} ${disabled ? 'opacity-40' : ''}`} style={{ minHeight: 44 }}>
    <Text className={`text-center font-medium ${secondary ? 'text-stone-800' : 'text-white'}`}>{title}</Text>
  </Pressable>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <View className="rounded-3xl bg-white p-5 gap-4 border border-stone-200">{children}</View>;
}
function Field({ label, value, onChange, multiline = false, testID }: { testID?: string; label: string; value: string; onChange: (text: string) => void; multiline?: boolean }) {
  return <View className="gap-2"><Text className="text-sm font-medium text-stone-700">{label}</Text>
    <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={1000}
      className="rounded-xl border border-stone-300 bg-white p-3 text-base text-stone-900" style={{ minHeight: multiline ? 88 : 48, textAlignVertical: 'top' }} />
  </View>;
}
function Choices<T extends string>({ label, options, value, onChange, testID }: { testID?: string; label: string; options: readonly (readonly [T, string])[]; value: T | null; onChange: (value: T) => void }) {
  return <View className="gap-2"><Text className="font-medium text-stone-800">{label}</Text><View className="flex-row flex-wrap gap-2">
    {options.map(([key, title]) => <Pressable testID={`${testID}-${key}`} key={key} accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ checked: value === key }}
      onPress={() => onChange(key)} className={`rounded-xl border px-3 py-3 ${value === key ? 'bg-amber-100 border-amber-700' : 'bg-white border-stone-300'}`}>
      <Text className="text-stone-800">{value === key ? '● ' : '○ '}{title}</Text>
    </Pressable>)}
  </View></View>;
}

/** DEV only. Local journey state stays separate from explicit real chat transport. */
export default function SyntheticDemoScreen() {
  const router = useRouter();
  const repository = useRef<DemoRepository | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [initialError, setInitialError] = useState('');
  const [page, setPage] = useState<Page>('chat');
  const [notice, setNotice] = useState<Notice>(null);
  const [code, setCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [chatGeneration, setChatGeneration] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Ref is updated synchronously: a second queued press cannot save a dismissed draft.
  const draftRef = useRef<Draft | null>(null);
  const writing = useRef(false);
  const recordSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        if (Platform.OS !== 'web' || typeof window === 'undefined') {
          throw new Error('此 DEV 演示仅支持网页浏览器的本地存储。当前环境不可用，不会连接真实聊天。');
        }
        const repo = createDemoRepository(window.localStorage);
        repository.current = repo;
        setSnapshot(repo.snapshot());
      } catch (error) {
        setInitialError(error instanceof Error ? error.message : '本地演示无法初始化。');
      }
    });
    return () => { active = false; repository.current?.cancelCode(); repository.current = null; draftRef.current = null; };
  }, []);

  function changeDraft(next: Draft | null) {
    setNotice(null);
    draftRef.current = next;
    setDraft(next);
  }
  function navigate(next: Page) {
    repository.current?.cancelCode();
    changeDraft(null);
    setPage(next);
    setChatGeneration(value => value + 1);
    setCode('');
    setEnteredCode('');
  }
  function write(operation: (repo: DemoRepository) => Snapshot, message: string, dismiss = true) {
    setNotice(null);
    if (writing.current || !repository.current) return;
    writing.current = true;
    try {
      const next = operation(repository.current);
      setSnapshot(next);
      if (dismiss) { draftRef.current = null; setDraft(null); }
      setNotice({ kind: 'success', text: message });
    } catch (error) {
      // Keep the current draft and operationId intact; never retain earlier success.
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存失败，草稿已保留。' });
    } finally { writing.current = false; }
  }
  function saveDraft() {
    const current = draftRef.current;
    if (!current || current.kind === 'unlink') return;
    write(repo => {
      if (current.kind === 'candidate') {
        return current.decision === 'confirmed'
          ? repo.confirmDevUnderstanding({ text: current.text, input: current.input, requestId: current.requestId }, current.version)
          : repo.updatePattern({ decision: current.decision }, current.version);
      }
      if (current.kind === 'mode') return repo.updatePattern({ name: current.name, currentUnderstanding: current.understanding }, current.version);
      if (current.kind === 'practice') return repo.savePractice({ ifCue: current.cue, thenAction: current.action }, current.version);
      if (current.kind === 'record') {
        if (!current.occurredChosen) throw new Error('请先选择触发情境是否发生，草稿尚未保存。');
        return repo.saveRecord(current.payload, current.version, current.operationId);
      }
      return repo.updatePath(current.entry.entryId, { explanation: current.explanation, feeling: current.feeling }, current.entry.version);
    }, '已保存到此浏览器的演示空间。');
  }
  function startRecord() {
    setPage('checkin');
    const practice = snapshot?.practice;
    if (!practice) return;
    recordSequence.current += 1;
    changeDraft({ kind: 'record', occurredChosen: false, version: practice.version, operationId: `record-${Date.now()}-${recordSequence.current}-${Math.random().toString(36).slice(2)}`,
      payload: { occurred: false, action: null, feeling: null, note: '' } });
  }
  function candidate(result: DevUnderstandingDraft) {
    changeDraft({ kind: 'candidate', ...result, decision: 'confirmed', version: snapshot?.pattern?.version ?? 0 });
  }
  function saveButtons(label = '保存') {
    const prefix = draft?.kind === 'mode' ? 'pattern' : draft?.kind;
    const incomplete = draft?.kind === 'record' && (!draft.occurredChosen || (draft.payload.occurred && (!draft.payload.action || (draft.payload.action !== 'none' && !draft.payload.feeling))));
    return <View className="gap-2"><Button testID={`${prefix}-save`} disabled={incomplete} title={label} onPress={saveDraft} /><Button testID={`${prefix}-cancel`} title="取消 · 丢弃草稿" secondary onPress={() => changeDraft(null)} /></View>;
  }
  const pattern = snapshot?.pattern;
  const practice = snapshot?.practice;
  const signedIn = Boolean(snapshot?.session);

  function renderDraft() {
    if (!draft || draft.kind === 'unlink') return null;
    return <Card><Text className="text-lg font-semibold text-stone-900">{draft.kind === 'record' ? '记录这一次' : '编辑草稿'}</Text>
      <Text className="text-sm text-stone-600">只有点击保存才会写入；取消、切换页面或退出会丢弃草稿。</Text>
      {draft.kind === 'candidate' && <>
        <Text className="text-stone-800">你的选择：{decisionLabels[draft.decision]}</Text>
        {draft.decision === 'confirmed' && <Field testID="candidate-text" label="我的理解（可修改）" value={draft.text} multiline onChange={text => changeDraft({ ...draft, text })} />}
        <Text className="text-sm text-stone-600">来源：本次 DEV 服务端 Deep 回复，可编辑确认；实际供应商和模型未核验。不是诊断。</Text>
      </>}
      {draft.kind === 'mode' && <>
        <Field testID="pattern-name" label="模式名称" value={draft.name} onChange={name => changeDraft({ ...draft, name })} />
        <Field testID="pattern-understanding" label="当前理解" value={draft.understanding} multiline onChange={understanding => changeDraft({ ...draft, understanding })} />
      </>}
      {draft.kind === 'practice' && <>
        <Field testID="practice-cue" label="如果（触发线索）" value={draft.cue} onChange={cue => changeDraft({ ...draft, cue })} />
        <Field testID="practice-action" label="那么（约定动作）" value={draft.action} multiline onChange={action => changeDraft({ ...draft, action })} />
      </>}
      {draft.kind === 'record' && <>
        <Choices testID="record-occurred" label="这次触发情境发生了吗？" value={draft.occurredChosen ? (draft.payload.occurred ? 'yes' : 'no') : null} options={[[ 'yes', '发生了' ], [ 'no', '未发生' ]]}
          onChange={v => changeDraft({ ...draft, occurredChosen: true, payload: { ...draft.payload, occurred: v === 'yes', action: null, feeling: null } })} />
        {draft.occurredChosen && (draft.payload.occurred ? <>
          <Choices testID="record-action" label="行动情况" options={actions} value={draft.payload.action} onChange={action => changeDraft({ ...draft, payload: { ...draft.payload, action, feeling: null } })} />
          {(draft.payload.action === 'agreed' || draft.payload.action === 'other') && <Choices testID="record-feeling" label="行动后的感受" options={feelings} value={draft.payload.feeling} onChange={feeling => changeDraft({ ...draft, payload: { ...draft.payload, feeling } })} />}
        </> : <Text className="text-stone-600">未发生也可以保存，不会被标记为失败或例外。</Text>)}
        <Field testID="record-note" label="补充说明（可选，仅填写虚构内容）" value={draft.payload.note ?? ''} multiline onChange={note => changeDraft({ ...draft, payload: { ...draft.payload, note } })} />
      </>}
      {draft.kind === 'path' && <>
        <Text className="text-stone-800">不可更改的事实：{draft.entry.fact}</Text>
        <Text className="text-sm text-stone-600">来源：{draft.entry.source} · 类型：{typeLabels[draft.entry.type]}</Text>
        <Field testID="path-explanation" label="我的解释" value={draft.explanation} multiline onChange={explanation => changeDraft({ ...draft, explanation })} />
        <Field testID="path-feeling" label="我的感受" value={draft.feeling} onChange={feeling => changeDraft({ ...draft, feeling })} />
      </>}
      {saveButtons(draft.kind === 'record' ? '保存这次记录' : '保存')}
      {draft.kind === 'record' && <Button testID="record-skip" title="跳过 · 不保存" secondary onPress={() => { navigate('practice'); }} />}
    </Card>;
  }

  function renderBody() {
    if (initialError) return <Card><Text className="text-red-800">{initialError}</Text><Text className="text-stone-600">请在支持本地存储的网页浏览器中重新打开。不会回退到真实服务。</Text></Card>;
    if (!snapshot) return <Text className="text-stone-700">正在准备本地演示…</Text>;
    if (!signedIn) return <Card>
      <Text className="text-2xl font-semibold text-stone-900">进入虚构演示账号</Text>
      <Text className="text-stone-600">不发送短信，不验证真实身份。请勿输入真实手机号或私人内容。</Text>
      <TextInput testID="number" accessibilityLabel="虚构演示号码" editable={false} value={DEMO_NUMBER} className="text-lg text-stone-900" />
      <Button testID="get-code" title={code ? '重新生成演示验证码' : '获取演示验证码'} onPress={() => {
        setNotice(null); setEnteredCode(''); setCode('');
        try { setCode(repository.current?.requestCode(DEMO_NUMBER) ?? ''); }
        catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : '生成失败。' }); }
      }} />
      {code !== '' && <><Text testID="displayed-code" selectable className="text-lg font-semibold text-amber-800">本次演示验证码：{code}</Text>
        <Field testID="code" label="输入上方六位演示验证码" value={enteredCode} onChange={value => { setNotice(null); setEnteredCode(value); }} />
        <Button testID="login" title="登录演示账号" onPress={() => write(repo => repo.login(enteredCode), '已进入虚构演示账号。')} />
      </>}
    </Card>;
    if (page === 'chat') return <DevConversation resetKey={chatGeneration} onConfirm={candidate}
      onDraftDiscard={() => changeDraft(null)} footer={renderDraft()} />;
    if (page === 'me') return <>
      <Card><Text className="text-2xl font-semibold text-stone-900">我的</Text><Button testID="mode-open" title="我的模式" secondary onPress={() => navigate('mode')} /></Card>
      <Card><Text className="text-lg font-semibold text-stone-900">账号</Text><Text className="text-stone-600">虚构账号 · {DEMO_NUMBER}</Text><Text className="text-sm text-stone-600">仅保存在这个浏览器。退出后重新登录同一个演示账号可以继续查看已保存内容。</Text>
        <Button testID="logout" title="退出演示账号" secondary onPress={() => {
          changeDraft(null); setChatGeneration(value => value + 1); setCode(''); setEnteredCode('');
          write(repo => repo.logout(), '已退出，未保存草稿已丢弃。');
        }} /></Card>
    </>;
    if (page === 'mode') return <>
      <Button title="返回我的" secondary onPress={() => navigate('me')} />
      {pattern && <Card><Text className="text-2xl font-semibold text-stone-900">{pattern.name}</Text>
        <Text className="text-sm text-amber-800">{decisionLabels[pattern.decision]} · {pattern.demoSource === 'dev-api-test' ? 'DEV 回复 · 用户确认' : '历史合成示例'}</Text><Text className="text-lg text-stone-800">{pattern.currentUnderstanding}</Text>
        <Button testID="pattern-edit" title="编辑名称与当前理解" onPress={() => changeDraft({ kind: 'mode', name: pattern.name, understanding: pattern.currentUnderstanding, version: pattern.version })} />
        <Button testID="practice-open" title="我的小练习" secondary onPress={() => navigate('practice')} /><Button testID="path-open" title="查看我的路径" secondary onPress={() => navigate('path')} />
        <Text className="text-sm text-stone-500">这里只演示一个模式。不推断人格，不自动生成例外或成长结论。</Text>
      </Card>}
      {!pattern && <Card><Text className="text-stone-700">还没有已确认的模式。先在聊天中确认并保存一个理解。</Text><Button title="去聊天" onPress={() => navigate('chat')} /></Card>}
      {renderDraft()}
    </>;
    if (page === 'practice') return <>
      <Button title="返回我的模式" secondary onPress={() => navigate('mode')} />
      <Card><Text className="text-2xl font-semibold text-stone-900">一个小练习</Text>
        <Text className="text-stone-800">如果：{practice?.ifCue ?? (pattern?.demoSource === 'dev-api-test' ? '' : '听到自责时')}</Text><Text className="text-stone-800">那么：{practice?.thenAction ?? (pattern?.demoSource === 'dev-api-test' ? '' : PRACTICE_TEXT)}</Text>
        <Text className="text-sm text-stone-600">{!practice ? '请自行填写一个触发线索与动作 · 尚未保存' : practice.paused ? '已暂停' : '已确认 · 进行中'}</Text>
        <Button testID="practice-edit" title={practice ? '编辑练习' : '确认或修改这个练习'} onPress={() => changeDraft({ kind: 'practice', cue: practice?.ifCue ?? (pattern?.demoSource === 'dev-api-test' ? '' : '听到自责时'), action: practice?.thenAction ?? (pattern?.demoSource === 'dev-api-test' ? '' : PRACTICE_TEXT), version: practice?.version ?? 0 })} />
        {practice && <><Button testID="record-open" title="记录这一次" disabled={practice.paused} onPress={startRecord} />
          {!practice.paused && <Button testID="practice-pause" title="暂停练习" secondary onPress={() => { changeDraft(null); write(repo => repo.pausePractice(practice.version), '练习已暂停。'); }} />}
          {practice.paused && <Text className="text-sm text-stone-600">此演示中的暂停不会自动恢复；已保存的记录仍保留。</Text>}
        </>}
      </Card>{renderDraft()}
    </>;
    if (page === 'checkin') return <><Button title="返回练习 · 丢弃草稿" secondary onPress={() => navigate('practice')} />
      {draft ? renderDraft() : <Card><Text className="text-stone-800">本次编辑已结束。</Text><Button title="记录新的一次" onPress={startRecord} /><Button testID="path-open" title="查看我的路径" secondary onPress={() => navigate('path')} /></Card>}
    </>;
    return <><Button title="返回我的模式" secondary onPress={() => navigate('mode')} />
      <Text className="text-2xl font-semibold text-stone-900">我的路径</Text><Text className="text-sm text-stone-600">保留已保存的事实与来源。解释和感受可以修正；解除关联不会删除原始事实。</Text>
      {renderDraft()}
      {snapshot.path.length === 0 && <Card><Text className="text-stone-600">还没有保存的路径记录。</Text></Card>}
      {[...snapshot.path].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(entry => {
        const record = snapshot.records.find(item => item.recordId === entry.recordId);
        return <Card key={entry.entryId}>
          <Text className="font-semibold text-stone-900">{typeLabels[entry.type]} · {entry.linked ? '已关联' : '已解除关联'}</Text>
          <Text className="text-xs text-stone-500">保存时间：{new Date(entry.createdAt).toLocaleString('zh-CN')}</Text>
          <Text className="text-stone-800">事实（不可改）：{entry.fact}</Text><Text className="text-sm text-stone-600">来源（不可改）：{entry.source}</Text>
          <Text className="text-sm text-stone-600">类型（不可改）：{typeLabels[entry.type]} · {entry.demoSource === 'dev-api-test' ? 'DEV 测试流程' : '历史合成示例'} · 用户确认</Text>
          {entry.oldUnderstanding !== undefined && <Text className="text-stone-700">原理解：{entry.oldUnderstanding}</Text>}
          {entry.currentUnderstanding !== undefined && <Text className="text-stone-700">新理解：{entry.currentUnderstanding}</Text>}
          {record && <View className="gap-1"><Text className="text-stone-700">情境发生：{record.occurred ? '是' : '否'}</Text>
            <Text className="text-stone-700">原始行动：{actions.find(([key]) => key === record.action)?.[1] ?? '不适用'}</Text>
            <Text className="text-stone-700">原始感受：{feelings.find(([key]) => key === record.feeling)?.[1] ?? '不适用'}</Text>
            {!!record.note && <Text className="text-stone-700">原始补充：{record.note}</Text>}
          </View>}
          <Text className="text-stone-700">我的解释：{entry.explanation || '未补充'}</Text><Text className="text-stone-700">我的感受：{entry.feeling || '未补充'}</Text>
          <Button testID="path-edit" title="编辑感受与解释" secondary onPress={() => changeDraft({ kind: 'path', entry, explanation: entry.explanation ?? '', feeling: entry.feeling ?? '' })} />
          {entry.linked && <Button testID="path-remove" title="解除关联" secondary onPress={() => changeDraft({ kind: 'unlink', entry })} />}
        </Card>;
      })}
    </>;
  }

  return <Screen backgroundColor="#fafaf9" statusBarStyle="dark">
    <View className="flex-1 bg-stone-50">
      <View className="border-b border-amber-200 bg-amber-50 px-5 py-3"><Text className="font-semibold text-amber-900">DEV · 真实聊天与本地体验流程</Text>
        <Text className="text-xs text-amber-900">虚构账号，无短信；聊天仅在点击发送后调用现有 DEV API。模式、练习和路径只保存在本浏览器。</Text>
        <Button testID="return-live-chat" title="返回原聊天与历史" secondary onPress={() => {
          navigate('chat');
          router.replace('/');
        }} />
      </View>
      {notice && <View accessibilityLiveRegion="polite" className={`rounded-xl p-4 ${notice.kind === 'error' ? 'bg-red-50' : 'bg-green-50'}`}><Text className={notice.kind === 'error' ? 'text-red-800' : 'text-green-800'}>{notice.text}</Text></View>}
      {signedIn && page === 'chat' && !initialError ? renderBody() : <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center', paddingBottom: 32 }}>
        {renderBody()}
      </ScrollView>}
      <View className="flex-row border-t border-stone-200 bg-white px-5 py-3 gap-4">
        <View className="flex-1"><Button testID="nav-chat" title="聊天" secondary={page !== 'chat'} onPress={() => navigate('chat')} /></View>
        <View className="flex-1"><Button testID="nav-me" title="我的" secondary={page === 'chat'} onPress={() => navigate('me')} /></View>
      </View>
      <Modal visible={draft?.kind === 'unlink'} transparent animationType="fade" onRequestClose={() => changeDraft(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 p-6"><View className="w-full max-w-lg"><Card>
          <Text className="text-xl font-semibold text-stone-900">解除这条路径的关联？</Text><Text className="text-stone-700">只解除关联，原始事实、来源和类型仍保留。此操作不会自动产生新的解释。</Text>
          {notice?.kind === 'error' && <Text accessibilityLiveRegion="polite" className="text-red-800">{notice.text}</Text>}
          <Button testID="path-remove-confirm" title="确认解除关联" onPress={() => {
            const current = draftRef.current;
            if (current?.kind !== 'unlink') return;
            write(repo => repo.updatePath(current.entry.entryId, { linked: false }, current.entry.version), '已解除关联，原始事实仍保留。');
          }} /><Button testID="path-remove-cancel" title="取消 · 保留关联" secondary onPress={() => changeDraft(null)} />
        </Card></View></View>
      </Modal>
    </View>
  </Screen>;
}
