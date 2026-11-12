import { canSavePracticeSuggestionTarget } from '@/features/synthetic-demo/repository';
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { DemoRepository, PatternState, Snapshot } from '@/features/synthetic-demo/repository';
import type { DevPracticeCandidate } from '@/features/dev-journey/realRequestController';
import { createPracticeCandidateDraftController, type PracticeCandidateScope, type PracticeCandidateDraft } from '@/features/dev-journey/practiceCandidateDraft';

export interface PracticeCandidateCardHandle { invalidate(): void; refreshTargets(snapshot: Snapshot): void }
type Editor = { content: { ifCue: string; thenAction: string }; target: PatternState | null; draft: PracticeCandidateDraft | null; confirmed: boolean };
/** Local-only explicit target selection. This component never sends patterns or parses chat text. */
export const PracticeCandidateCard = forwardRef<PracticeCandidateCardHandle, {
  candidate: DevPracticeCandidate; repository: DemoRepository; accountId: string; accountSession: object;
  onDismiss(): void; onSaved(snapshot: Snapshot): void;
}>(function PracticeCandidateCard({ candidate, repository, accountId, accountSession, onDismiss, onSaved }, ref) {
  const scope = useRef<PracticeCandidateScope | null>(null);
  const alive = useRef(true);
  const editorRef = useRef<Editor>({ content: { ifCue: candidate.ifCue, thenAction: candidate.thenAction }, target: null, draft: null, confirmed: false });
  const [editor, setEditor] = useState(editorRef.current);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<PatternState[]>([]);
  const [boundary] = useState(() => createPracticeCandidateDraftController({ repository, getCurrentScope: () => scope.current }));
  function invalidate() { alive.current = false; scope.current = null; boundary.invalidate(); }
  function refreshTargets(snapshot: Snapshot) {
    if (!alive.current) return;
    boundary.invalidate(); scope.current = null;
    change({ ...editorRef.current, target: null, draft: null, confirmed: false });
    setChoices(snapshot.session === accountId
      ? snapshot.patterns.filter(item => item.pattern.accountId === accountId && canSavePracticeSuggestionTarget(item.pattern)) : []);
  }
  useImperativeHandle(ref, () => ({ invalidate, refreshTargets }));
  useLayoutEffect(() => {
    alive.current = true;
    try { setChoices(repository.snapshot().patterns.filter(item => item.pattern.accountId === accountId && canSavePracticeSuggestionTarget(item.pattern))); }
    catch { setError('未能读取本地模式。建议尚未保存，可继续聊天或不保存。'); }
    return invalidate;
  }, [repository, accountId, accountSession, candidate, boundary]);
  function current(expected: Editor) { return alive.current && editorRef.current === expected; }
  function change(next: Editor) { editorRef.current = next; setEditor(next); setError(''); }
  function choose(expected: Editor, patternId: string) {
    if (!current(expected)) return;
    boundary.invalidate(); scope.current = null;
    try {
      const target = repository.getPattern(accountId, patternId);
      scope.current = { accountSession, accountId, patternId, ...candidate.source };
      const ticket = boundary.begin(scope.current);
      if (!ticket || !boundary.receive(ticket, expected.content)) throw Error('stale');
      change({ ...expected, target, draft: boundary.getDraft(), confirmed: false });
    } catch {
      change({ ...expected, target: null, draft: null, confirmed: false });
      setError('这个模式已变化或暂不可用，请重新选择并核对。草稿尚未保存。');
    }
  }
  function edit(expected: Editor, key: 'ifCue' | 'thenAction', value: string) {
    if (!current(expected)) return;
    const content = { ...expected.content, [key]: value.slice(0, 200) };
    if (expected.draft && !boundary.edit(expected.draft, content)) return;
    change({ ...expected, content, draft: expected.draft ? boundary.getDraft() : null });
  }
  function dismiss(expected: Editor) { if (!current(expected)) return; invalidate(); onDismiss(); }
  function save(expected: Editor) {
    if (!current(expected) || !expected.confirmed || !expected.draft) return;
    const result = boundary.save(expected.draft);
    if (result.status === 'saved') { invalidate(); onSaved(result.snapshot); }
    else setError('未能保存：内容、模式或练习版本可能已变化，或本地存储不可用。草稿已保留；请核对后重试或重新选择模式。');
  }
  const button = (id: string, title: string, onPress: () => void, disabled = false) => <Pressable key={id} testID={id} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className="rounded-xl border border-stone-300 p-3"><Text className="text-stone-800">{title}</Text></Pressable>;
  return <View testID="practice-candidate-card" className="rounded-2xl border border-orange-200 bg-white p-4 gap-3">
    <Text className="font-semibold text-stone-900">AI 建议 · 可改写的小练习</Text>
    <Text className="text-sm text-stone-600">这是可选择的建议，不是已发生的事实。无需先保存理解就能查看、改写或自行选择尝试，也可以拒绝或不保存。继续聊天或离开会收起未保存建议。</Text>
    <Text className="text-stone-700">如果</Text><TextInput testID="practice-candidate-cue" accessibilityLabel="建议的触发线索" value={editor.content.ifCue} maxLength={200} onChangeText={value => edit(editor, 'ifCue', value)} className="border border-stone-300 rounded-xl p-3" />
    <Text className="text-stone-700">那么</Text><TextInput testID="practice-candidate-action" accessibilityLabel="建议的小动作" value={editor.content.thenAction} maxLength={200} onChangeText={value => edit(editor, 'thenAction', value)} className="border border-stone-300 rounded-xl p-3" />
    <Text className="text-stone-700">如果想保存，请选择保存位置（已保存发现或已确认模式），核对内容；这不表示认可其中推断：</Text>
    {choices.length === 0 && <Text className="text-stone-600">目前没有可选的已保存发现或已确认模式；仍可查看、改写或自行选择尝试，这条建议尚未保存。</Text>}
    {choices.map(item => button(`practice-candidate-target-${item.pattern.patternId}`, `${editor.target?.pattern.patternId === item.pattern.patternId ? '● ' : '○ '}${item.pattern.name}`, () => choose(editor, item.pattern.patternId)))}
    {editor.target && <View testID="practice-candidate-target-review" className="gap-2">
      <Text className="font-semibold text-stone-900">保存目标：{editor.target.pattern.name}</Text>
      <Text className="text-stone-700">本地当前理解：{editor.target.pattern.currentUnderstanding}</Text>
      {editor.target.practice && <Text className="text-orange-800">保存将替换这个模式的现有练习：如果 {editor.target.practice.ifCue}，那么 {editor.target.practice.thenAction}。其他模式不会改变。</Text>}
      {button('practice-candidate-confirm-target', editor.confirmed ? '已核对保存位置' : '我已核对，选择此保存位置', () => { if (current(editor)) change({ ...editor, confirmed: true }); })}
    </View>}
    {!!error && <Text testID="practice-candidate-error" accessibilityLiveRegion="polite" className="text-red-800">{error}</Text>}
    {button('practice-candidate-save', editor.target?.practice ? '明确保存到此模式 · 替换现有练习' : '明确保存到此模式', () => save(editor), !editor.confirmed || !editor.draft || !editor.content.ifCue.trim() || !editor.content.thenAction.trim())}
    <Text className="text-xs text-stone-600">保存不会自动开启练习；已有练习的开启或暂停状态保持不变。</Text>
    {button('practice-candidate-skip', '暂不保存', () => dismiss(editor))}
    {button('practice-candidate-cancel', '不符合 · 丢弃建议', () => dismiss(editor))}
  </View>;
});
