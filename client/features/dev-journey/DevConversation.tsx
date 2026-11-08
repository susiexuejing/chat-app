import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MessageListView } from '@/screens/chat/components/MessageListView';
import { MultimodalInputView } from '@/screens/chat/components/MultimodalInputView';
import type { ChatMessage } from '@/screens/chat/types';
import { createDevRealRequestControllerForRuntime } from '@/features/dev-journey/realRequestAdapter';
import {
  DEV_REAL_REQUEST_NOTICE, DEV_REAL_REQUEST_SOURCE_NOTICE, DEV_REAL_REQUEST_STOP_NOTICE,
  type DevRealRequestController, type DevRealRequestSnapshot,
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
export function DevConversation({ onConfirm, onDraftDiscard, footer, resetKey, beforeSend }: {
  onConfirm: (draft: DevUnderstandingDraft) => void;
  onDraftDiscard: () => void;
  footer?: React.ReactNode;
  resetKey: number;
  beforeSend?: () => boolean;
}) {
  const controller = useRef<DevRealRequestController | null>(null);
  const [state, setState] = useState(initial);
  const [input, setInput] = useState('');
  const [showIntro, setShowIntro] = useState(false);
  const discard = useRef(onDraftDiscard);
  useLayoutEffect(() => { discard.current = onDraftDiscard; }, [onDraftDiscard]);
  const leave = useCallback(() => {
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
    });
    const unsubscribe = instance.subscribe(() => {
      if (controller.current !== instance) return;
      const next = instance.getSnapshot();
      if (next.status === 'starting' || next.status === 'failed' || next.status === 'stopped') {
        discard.current(); setInput('');
      }
      setState(next);
    });
    return () => { unsubscribe(); instance.dispose(); controller.current = null; };
  }, [resetKey]);

  const busy = state.status === 'starting' || state.status === 'streaming';
  function reset() { onDraftDiscard(); controller.current?.reset(); setInput(''); }
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
    if (turn.inputText) messages.push({ id: `${turn.requestId}-user`, role: 'user', content: turn.inputText, timestamp: turn.sentAt });
    for (const [layer, content] of [['reaction', turn.reactionText], ['companion', turn.companionText], ['deep', turn.deepText]] as const) {
      if (content) messages.push({ id: `${turn.requestId}-${layer}`, role: 'assistant', content, responseLayer: layer, timestamp: turn.sentAt });
    }
  }
  const confirm = () => {
    if (controller.current?.getSnapshot() === state && state.status === 'success' && state.source === 'backend-deep' && state.requestId) {
      onConfirm({ text: state.deepText, input: state.inputText, requestId: state.requestId });
    }
  };
  const statusText = state.error ?? {
    idle: '仅点击发送才会请求。同一对话可连续发送，不加载原聊天历史。',
    starting: '正在向 DEV 服务端发送当前输入…',
    streaming: '等待完整的后端 Deep 回复，前层回应不代表上游模型成功。',
    success: `${DEV_REAL_REQUEST_SOURCE_NOTICE} 本轮已完成。可继续明确发送下一条，或结束对话。`,
    failed: state.error ?? '本次请求未完成。',
    stopped: '本次会话已结束，上下文已清除；未自动保存理解。',
  }[state.status];
  return <View className="flex-1 bg-white dark:bg-gray-900">
    <View className="px-4 py-3 border-b border-stone-200 gap-2">
      <View className="flex-row items-center justify-between"><Text className="text-xl font-semibold text-stone-900">EmotionFlow</Text>
        <View className="flex-row gap-2"><Action id="dev-end-chat" title="结束对话" onPress={leave} />
        <Action id="dev-new-chat" title="新对话" onPress={reset} /></View></View>
      <Text className="text-xs text-stone-700">{DEV_REAL_REQUEST_NOTICE} 超限时丢弃最早的完整轮次，单轮超限则不纳入前文。不发送本地模式、练习或路径；请只输入虚构内容。</Text>
      <Text testID="dev-request-status" accessibilityLiveRegion="polite" className="text-xs text-stone-700">{statusText}</Text>
      {showIntro && <Text className="text-sm text-stone-700">回复可供你阅读和修改，不是诊断。只有你确认保存的理解才进入本地模式与路径。</Text>}
      {busy && <Action id="dev-stop" title="停止等待" onPress={leave} />}
      <Text className="text-xs text-stone-600">{DEV_REAL_REQUEST_STOP_NOTICE}</Text>
    </View>
    <MessageListView messages={messages} currentRole={role} setInputText={text => setInput(`虚构场景：${text}`)}
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
  </View>;
}
