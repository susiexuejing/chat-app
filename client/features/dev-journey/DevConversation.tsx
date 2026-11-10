import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MessageListView } from '@/screens/chat/components/MessageListView';
import { MultimodalInputView } from '@/screens/chat/components/MultimodalInputView';
import type { ChatMessage } from '@/screens/chat/types';
import { createDevRealRequestControllerForRuntime } from '@/features/dev-journey/realRequestAdapter';
import {
  DEV_REAL_REQUEST_NOTICE, DEV_REAL_REQUEST_RETRY_NOTICE, DEV_REAL_REQUEST_SOURCE_NOTICE, DEV_REAL_REQUEST_STOP_NOTICE,
  type DevPracticeCandidate, type DevRealRequestController, type DevRealRequestSnapshot, type DevSyntheticSafetyKind,
} from '@/features/dev-journey/realRequestController';

export interface DevUnderstandingDraft { text: string; input: string; requestId: string }
const initial: DevRealRequestSnapshot = {
  status: 'idle', inputText: '', requestId: null, sentAt: 0, reactionText: '', companionText: '',
  deepText: '', completedTurns: [], error: null, canSend: false, source: null,
};
const role = { avatar: null, name: '小狐狸', shortDesc: 'DEV · 仅用虚构场景体验', themeColor: '#D97706' };
function Action({ id, title, onPress }: { id: string; title: string; onPress: () => void }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    className="rounded-xl border border-stone-300 px-4 py-3"><Text className="text-stone-800">{title}</Text></Pressable>;
}

/** Reuses the live presentation, without mounting the live provider/history/audio effects. */
export function DevConversation({ onConfirm, onDraftDiscard, footer, resetKey, beforeSend, onPracticeCandidate, onPracticeInvalidate }: {
  onConfirm: (draft: DevUnderstandingDraft) => void;
  onDraftDiscard: () => void;
  footer?: React.ReactNode;
  resetKey: number;
  beforeSend?: () => boolean;
  onPracticeCandidate?: (candidate: DevPracticeCandidate) => void;
  onPracticeInvalidate?: () => void;
}) {
  const controller = useRef<DevRealRequestController | null>(null);
  const [state, setState] = useState(initial);
  const [input, setInput] = useState('');
  const [showIntro, setShowIntro] = useState(false);
  const [showSafetyControls, setShowSafetyControls] = useState(false);
  const discard = useRef(onDraftDiscard);
  const practiceCallbacks = useRef({ onPracticeCandidate, onPracticeInvalidate });
  useLayoutEffect(() => { practiceCallbacks.current = { onPracticeCandidate, onPracticeInvalidate }; }, [onPracticeCandidate, onPracticeInvalidate]);
  useLayoutEffect(() => { discard.current = onDraftDiscard; }, [onDraftDiscard]);
  const leave = useCallback(() => {
    practiceCallbacks.current.onPracticeInvalidate?.();
    const instance = controller.current;
    const before = instance?.getSnapshot();
    instance?.stop();
    if (!instance || instance.getSnapshot() === before) discard.current();
    setInput('');
  }, []);
  useFocusEffect(useCallback(() => leave, [leave]));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return;
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [leave]);
  useEffect(() => {
    const instance = createDevRealRequestControllerForRuntime();
    controller.current = instance;
    void Promise.resolve().then(() => {
      if (controller.current !== instance) return;
      setState(instance.getSnapshot());
      setInput('');
      setShowSafetyControls(false);
    });
    const unsubscribe = instance.subscribe(() => {
      if (controller.current !== instance) return;
      const next = instance.getSnapshot();
      if (next.status === 'safety') {
        // Clear the visible conversation even if an editor's cleanup fails.
        // The safety publisher isolates observers and still aborts/ends.
        setInput(''); setState(next);
        try { practiceCallbacks.current.onPracticeInvalidate?.(); } finally { discard.current(); }
        return;
      }
      if (next.status === 'starting' || next.status === 'recoverable' || next.status === 'failed' || next.status === 'stopped') {
        practiceCallbacks.current.onPracticeInvalidate?.(); discard.current();
        // A manual retry must not consume a separate draft typed while waiting.
        if ((next.status === 'starting' && next.logicalRequestId === next.requestId)
          || (next.status === 'failed' && !next.preserveDraft) || next.status === 'stopped') setInput('');
      }
      setState(next);
    });
    return () => { practiceCallbacks.current.onPracticeInvalidate?.(); unsubscribe(); instance.dispose(); controller.current = null; };
  }, [resetKey]);

  useLayoutEffect(() => {
    if (controller.current?.getSnapshot() === state && state.status === 'success' && state.practiceCandidate) {
      practiceCallbacks.current.onPracticeCandidate?.(state.practiceCandidate);
    }
  }, [state]);

  const busy = state.status === 'starting' || state.status === 'streaming';
  function safety(kind: DevSyntheticSafetyKind) {
    if (controller.current?.getSnapshot() === state) controller.current.safety(kind);
  }
  function reset() { practiceCallbacks.current.onPracticeInvalidate?.(); onDraftDiscard(); controller.current?.reset(); setInput(''); setShowSafetyControls(false); }
  function send() {
    if (!input.trim() || controller.current?.getSnapshot() !== state || !state.canSend) return;
    if (beforeSend && !beforeSend()) { leave(); return; }
    // Preflight can fail before a turn is accepted. Keep the unsent draft in
    // that case; the synchronous starting notification clears accepted input.
    void controller.current.send(input);
  }
  const messages: ChatMessage[] = [];
  for (const turn of [...state.completedTurns, state]) {
    if (!turn.requestId) continue;
    if (turn.inputText) messages.push({ id: `${'logicalRequestId' in turn ? turn.logicalRequestId ?? turn.requestId : turn.requestId}-user`, role: 'user', content: turn.inputText, timestamp: turn.sentAt });
    // Only a completed, server-validated answer belongs in the conversation.
    // Never render front templates or an in-flight partial candidate.
    if (turn.deepText) messages.push({ id: `${turn.requestId}-deep`, role: 'assistant', content: turn.deepText, responseLayer: 'deep', timestamp: turn.sentAt });
  }
  const confirm = () => {
    if (controller.current?.getSnapshot() === state && state.status === 'success' && state.source === 'backend-deep' && state.requestId) {
      onConfirm({ text: state.deepText, input: state.inputText, requestId: state.requestId });
    }
  };
  const statusText = state.error ?? {
    idle: '仅点击发送才会请求。同一对话可连续发送，不加载原聊天历史。',
    starting: '正在思考',
    streaming: '正在思考',
    success: `${DEV_REAL_REQUEST_SOURCE_NOTICE} 本轮已完成。可继续明确发送下一条，或结束对话。`,
    recoverable: '刚才的回复没有完成，可以重试',
    failed: state.error ?? '本次请求未完成。',
    stopped: '本次会话已结束，上下文已清除；未自动保存理解。',
    safety: '已中断普通回复、分析与幽默；可以停止或离开。',
  }[state.status];
  return <View className="flex-1 bg-white dark:bg-gray-900">
    <View className="px-4 py-3 border-b border-stone-200 gap-2">
      <View className="flex-row items-center justify-between"><Text className="text-xl font-semibold text-stone-900">EmotionFlow</Text>
        <View className="flex-row gap-2"><Action id="dev-end-chat" title="结束对话" onPress={leave} />
        <Action id="dev-new-chat" title="新对话" onPress={reset} /></View></View>
      <Text className="text-xs text-stone-700">小狐狸是 AI 陪伴者，不是人类或治疗师，不提供诊断或治疗。{DEV_REAL_REQUEST_NOTICE} 超限时丢弃最早的完整轮次，单轮超限则不纳入前文。不发送本地模式、练习或路径；请只输入虚构内容。</Text>
      <Text testID="dev-request-status" accessibilityLiveRegion="polite" className="text-xs text-stone-700">{statusText}</Text>
      {showIntro && <Text className="text-sm text-stone-700">回复可供你阅读和修改，不是诊断。只有你确认保存的理解才进入本地模式与路径。</Text>}
      {state.canRetry && <><Action id="dev-retry" title="重试" onPress={() => {
        if (controller.current?.getSnapshot() !== state) return;
        if (beforeSend && !beforeSend()) { leave(); return; }
        void controller.current.retry();
      }} /><Text className="text-xs text-stone-600">{DEV_REAL_REQUEST_RETRY_NOTICE}</Text></>}
      {busy && <Action id="dev-stop" title="停止等待" onPress={leave} />}
      <Text className="text-xs text-stone-600">{DEV_REAL_REQUEST_STOP_NOTICE}</Text>
    </View>
    {state.status !== 'safety' && state.status !== 'failed' && state.status !== 'stopped' && <View className="px-4 py-2 border-b border-stone-200 gap-2">
      <Action id="dev-safety-controls" title="合成安全控制" onPress={() => setShowSafetyControls(value => !value)} />
      {showSafetyControls && <>
        <Text className="text-xs text-stone-600">以下是显式合成控制，不代表自动识别真实风险。</Text>
        <Action id="dev-safety-help" title="主动寻求现实帮助（合成）" onPress={() => safety('help')} />
        <Action id="dev-safety-emergency" title="触发已覆盖紧急样例（合成 H01）" onPress={() => safety('emergency')} />
        <Action id="dev-safety-unknown" title="风险或支持范围无法判断（合成 U01）" onPress={() => safety('unknown')} />
      </>}
    </View>}
    {state.status === 'safety' ? <View testID="dev-safety-support" accessibilityLiveRegion="polite" className="flex-1 p-4 gap-3">
      <Text className="text-base font-semibold text-stone-900">固定合成安全支持</Text>
      <Text className="text-sm text-stone-700">以下是显式合成控制，不代表自动识别真实风险。</Text>
      <Text className="text-base text-stone-900">{state.safetySupport}</Text>
      <Text className="text-sm text-stone-700">AI 不能替代紧急或专业支持。地区、语言适用性与现实支持来源尚未核验；不提供当地号码、机构或可达性承诺。</Text>
    </View> : <>
    <MessageListView messages={messages} currentRole={role} setInputText={text => setInput(`虚构场景：${text}`)}
      generatingLabel="正在思考"
      turnStatus={busy ? 'generating' : state.status === 'success' ? 'completed' : 'idle'}
      retryLastMessage={() => undefined} onShowIntro={() => setShowIntro(value => !value)}
      footer={<View className="px-4 pb-4 gap-3">
        {state.status === 'success' && <>
          <Text className="text-sm text-stone-700">这段回复可能参考本次对话前文。可编辑后确认保存；只带入选中的当前输入和理解，不保存整段对话，也不自动判断心理模式。</Text>
          <Action id="candidate-confirm" title="确认这个理解" onPress={confirm} />
          <Action id="candidate-edit" title="修改后再确认" onPress={confirm} />
          <View className="flex-row flex-wrap gap-2"><Action id="candidate-reject" title="不符合 · 不保存" onPress={reset} />
            <Action id="candidate-unsure" title="不确定 · 不保存" onPress={reset} /></View>
          <Action id="candidate-stop" title="停止讨论 · 不保存" onPress={reset} />
        </>}
        {footer}
      </View>} />
    <MultimodalInputView value={input} onChangeText={text => setInput(text.slice(0, 1000))} onSend={send}
      disabled={!state.canSend || !input.trim()} phase={busy ? 'responding' : state.status === 'success' ? 'done' : 'idle'}
      inputTestID="chat-input" sendTestID="chat-send" inputAccessibilityLabel="虚构场景输入" sendAccessibilityLabel="发送真实 DEV 请求" />
    </>}
  </View>;
}
