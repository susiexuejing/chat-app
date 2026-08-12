/**
 * EmotionFlow 主页面
 * V3.1: 状态驱动入口 → 陪伴对话 → 状态变化感知
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { getFlowTypeLabel, getFlowStageLabel } from '@/screens/chat/utils/flowTypeMapping';
import {
  RoleIntroModal,
  RoleDetailModal,
  RolePickerModal,
  RoleHeader,
  MessageList,
  MultimodalInput,
  HistoryList,
  ChangeSystemCard,
  QueueStatusBar,
} from './components';
import { useChat } from './contexts/ChatContext';
import { DEFAULT_ROLES } from './constants/roles';
import { shouldRenderChangeSystemCard } from './utils/debugMode';

const STATE_ENTRIES = ['我很累', '我很乱', '我很烦', '我很空', '说不清'];

function ChatContent() {
  const {
    currentRole,
    messages,
    sessions,
    sendMessage,
    isLoading,
    createNewChat,
    setCurrentRole,
    error,
    clearError,
    chatPhase,
    flowContext,
    currentSessionId,
    isHydrated,
  } = useChat();

  const [showHome, setShowHome] = useState(true);
  const [homeInput, setHomeInput] = useState('');
  const inputRef = useRef<TextInput>(null);

  const [introModalVisible, setIntroModalVisible] = useState(false);
  const [roleDetailVisible, setRoleDetailVisible] = useState(false);
  const [rolePickerVisible, setRolePickerVisible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // FlowContext 状态卡：从实时 flowContext 计算
  const buildChangeSystemData = useCallback(() => {
    if (!flowContext || !flowContext.flowType || (flowContext.flowConfidence !== null && flowContext.flowConfidence < 0.4)) {
      return {
        currentState: '还在理解中',
        shift: '尚不明确',
        flowType: null,
        flowStage: null,
        flowStrength: null,
        flowConfidence: flowContext?.flowConfidence ?? null,
      };
    }
    // EF-24: 使用安全回退，不直接回显内部枚举值
    const flowTypeLabel = getFlowTypeLabel(flowContext.flowType);
    const flowStageLabel = getFlowStageLabel(flowContext.flowStage);
    const confidenceLabel = flowContext.flowConfidence !== null
      ? Math.round(flowContext.flowConfidence * 100) + '%'
      : '--';
    return {
      currentState: flowTypeLabel,
      shift: flowStageLabel,
      source: `置信度 ${confidenceLabel}`,
      flowType: flowContext.flowType,
      flowStage: flowContext.flowStage,
      flowStrength: flowContext.flowStrength,
      flowConfidence: flowContext.flowConfidence,
    };
  }, [flowContext]);

  const changeSystemData = buildChangeSystemData();

  // 切换提示消息
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);

  // Deep 等待计时（超过15秒显示不同文案）
  const [deepWaitingElapsed, setDeepWaitingElapsed] = useState(0);
  const deepStartRef = useRef<number | null>(null);
  const deepTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (chatPhase === 'waiting_deep') {
      if (!deepTickRef.current) {
        deepStartRef.current = Date.now();
        deepTickRef.current = setInterval(() => {
          setDeepWaitingElapsed(prev => prev + 1);
        }, 1000);
      }
    } else {
      if (deepTickRef.current) {
        clearInterval(deepTickRef.current);
        deepTickRef.current = null;
        deepStartRef.current = null;
      }
    }
    return () => {
      if (deepTickRef.current) {
        clearInterval(deepTickRef.current);
        deepTickRef.current = null;
      }
    };
  }, [chatPhase]);

  // EF-59 Fix: 水合完成后，根据 currentSessionId 恢复 showHome 状态
  // 使用 ref 避免在 effect 中直接调用 setState
  const hasRestoredShowHomeRef = useRef(false);
  useEffect(() => {
    if (!isHydrated || hasRestoredShowHomeRef.current) return;
    
    console.log('[EF59_HYDRATION] Restoring showHome', {
      currentSessionId,
      messagesCount: messages.length,
    });
    
    // 如果有活跃的会话，直接显示聊天视图
    if (currentSessionId && messages.length > 0) {
      hasRestoredShowHomeRef.current = true;
      // 使用 queueMicrotask 避免在 effect 中直接调用 setState
      queueMicrotask(() => setShowHome(false));
    }
  }, [isHydrated, currentSessionId, messages.length]);

  // 开始对话：从首页进入聊天
  const handleStartChat = useCallback(async () => {
    const text = homeInput.trim();
    if (!text) return;

    // 设置默认陪伴者（聪明狐狸）
    const defaultRole = DEFAULT_ROLES.find(r => r.id === 'clever-fox') || DEFAULT_ROLES[0];
    setCurrentRole(defaultRole);
    // EM-43: createNewChat 返回新的 conversationId，显式传给 sendMessage
    const newConversationId = createNewChat(defaultRole);

    // EM-50: 清空输入框，防止新建会话后残留文本
    setHomeInput('');

    // 切换到聊天视图
    setShowHome(false);

    // 发送用户消息，显式传入新 conversationId
    await sendMessage(text, { conversationId: newConversationId });
  }, [homeInput, setCurrentRole, createNewChat, sendMessage]);

  // 状态入口按钮点击
  const handleStateEntry = useCallback((text: string) => {
    setHomeInput(text);
    inputRef.current?.focus();
  }, []);

  // 切换陪伴者
  const handleRoleSwitch = useCallback((role: typeof DEFAULT_ROLES[0]) => {
    setCurrentRole(role);
    setRolePickerVisible(false);
    // 添加切换提示
    setSwitchNotice(`已切换为${role.name}继续陪你。`);
    setTimeout(() => setSwitchNotice(null), 4000);
  }, [setCurrentRole]);

  // 如果是首页模式且消息列表为空 → 显示首页
  if (showHome && messages.length === 0) {
    return (
      <Screen className="bg-white dark:bg-gray-900">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* 标题 */}
          <View className="items-center mb-8">
            <Text className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
              EmotionFlow
            </Text>
            <View className="w-12 h-0.5 bg-amber-200 dark:bg-amber-800 rounded-full mb-4" />
            <Text className="text-base text-gray-600 dark:text-gray-400 text-center leading-6">
              你不用先搞清楚自己怎么了。{'\n'}
              把此刻最真实的一句话放在这里，{'\n'}
              我们一起看见它正在发生什么。
            </Text>
          </View>

          {/* 大输入框 */}
          <View className="mb-6">
            <View className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 px-5 py-4">
              <TextInput
                ref={inputRef}
                value={homeInput}
                onChangeText={setHomeInput}
                placeholder="今天真的好累"
                placeholderTextColor="#9CA3AF"
                multiline
                className="text-base text-gray-900 dark:text-white min-h-[60px] leading-6"
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* 开始按钮 */}
          <TouchableOpacity
            onPress={handleStartChat}
            disabled={!homeInput.trim() || isLoading}
            className={`rounded-2xl py-4 items-center mb-8 ${
              homeInput.trim() && !isLoading
                ? 'bg-amber-500 active:bg-amber-600'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <Text className={`text-base font-bold ${
              homeInput.trim() && !isLoading
                ? 'text-white'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {isLoading ? '正在连接...' : '开始'}
            </Text>
          </TouchableOpacity>

          {/* 状态入口 */}
          <View className="items-center">
            <Text className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              不知道怎么开始？
            </Text>
            <View className="flex-row flex-wrap justify-center gap-2">
              {STATE_ENTRIES.map((text) => (
                <TouchableOpacity
                  key={text}
                  onPress={() => handleStateEntry(text)}
                  className="px-4 py-2 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                >
                  <Text className="text-sm text-amber-700 dark:text-amber-300">{text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // ═══ 聊天视图 ═══
  return (
    <Screen className="bg-white dark:bg-gray-900">
      {/* 历史对话列表（Modal 形式） */}
      <Modal
        visible={showHistory}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <HistoryList onClose={() => setShowHistory(false)} />
      </Modal>

      {/* 当前陪伴者头部 */}
      <RoleHeader
        onShowRolePicker={() => setRolePickerVisible(true)}
        onShowRoleDetail={() => setRoleDetailVisible(true)}
        onShowHistory={() => setShowHistory(true)}
        onNewChat={() => {
          createNewChat();
          // EM-50: 清空首页输入框，防止残留上一轮文本
          setHomeInput('');
          setShowHome(true);
        }}
        hasHistory={sessions.length > 0}
      />

      {/* FlowContext 状态变化卡片 - 仅在 Debug 模式显示 */}
      {shouldRenderChangeSystemCard(Platform.OS, typeof window !== 'undefined' ? window.location.search : '', !!changeSystemData) && <ChangeSystemCard data={changeSystemData} />}

      {/* 切换提示 */}
      {switchNotice && (
        <View className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <Text className="text-xs text-amber-700 dark:text-amber-300 text-center">
            {switchNotice}
          </Text>
        </View>
      )}

      {/* 消息列表 */}
      <View className="flex-1">
        <MessageList onShowIntro={() => setIntroModalVisible(true)} />
      </View>

      {/* 阶段状态条 */}
      {chatPhase !== 'idle' && !error && (
        <View className="px-4 pb-0">
          <View className="flex-row items-center py-2 px-2">
            {chatPhase !== 'done' ? (
              <ActivityIndicator size="small" color="#D97706" />
            ) : (
              <View className="w-3 h-3 rounded-full bg-green-500 items-center justify-center">
                <Text className="text-white text-[8px] font-bold">✓</Text>
              </View>
            )}
            <Text className="ml-2 text-xs font-medium text-gray-500 dark:text-gray-400 flex-1">
              {chatPhase === 'waiting_deep'
                ? (deepWaitingElapsed >= 15 ? '这部分理解需要一点时间，你可以先继续说，我不会打断你。' : '我还在慢慢理解，这里可能需要一点时间。')
                : chatPhase === 'deep_arriving'
                  ? `我整理到了一些更深的东西。`
                  : chatPhase === 'companion' || chatPhase === 'responding'
                    ? `我在听。`
                    : chatPhase === 'done'
                      ? `轮到你了。`
                      : `我在听。`}
            </Text>
          </View>
        </View>
      )}

      {/* 错误提示 */}
      {error && !isLoading && (
        <View className="px-4 pb-1">
          <View className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl p-4">
            <View className="flex-row items-start">
              <View className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 items-center justify-center mr-3">
                <Ionicons name="alert-circle" size={18} color="#dc2626" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">
                  {error || '请求超时'}
                </Text>
                <Text className="text-xs text-red-600 dark:text-red-300 mb-2">
                  请检查网络后重试，或点击「重试」重新发送
                </Text>
                <View className="flex-row">
                  <TouchableOpacity
                    className="bg-red-500 px-3 py-1.5 rounded-lg mr-2"
                    onPress={() => {
                      clearError();
                      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
                      if (lastUserMessage) {
                        sendMessage(lastUserMessage.content);
                      }
                    }}
                  >
                    <Text className="text-xs text-white font-medium">重试</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-lg"
                    onPress={clearError}
                  >
                    <Text className="text-xs text-gray-600 dark:text-gray-300">忽略</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* EF-58: Queue status bar - shows queued messages during AI generation */}
      <QueueStatusBar />

      {/* 免责声明 */}
      <View className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 flex-row items-center justify-center">
        <Ionicons name="warning-outline" size={12} color="#b45309" className="mr-1" />
        <Text className="text-xs text-amber-700 dark:text-amber-400">
          本产品为 AI 模拟对话，不代表真实咨询。如有严重困扰，请寻求专业帮助。
        </Text>
      </View>

      {/* 输入区域 */}
      <MultimodalInput
        onSendMessage={sendMessage}
        disabled={isLoading}
        isThinking={isLoading && messages.some(m => m.role === 'assistant' && m.content.startsWith('【思考中'))}
      />

      {/* 角色简介弹窗 */}
      <RoleIntroModal
        visible={introModalVisible}
        role={currentRole}
        onClose={() => setIntroModalVisible(false)}
      />

      {/* 角色详情弹窗 */}
      <RoleDetailModal
        visible={roleDetailVisible}
        role={currentRole}
        onClose={() => setRoleDetailVisible(false)}
      />

      {/* 切换陪伴者弹窗 */}
      <RolePickerModal
        visible={rolePickerVisible}
        onSelect={handleRoleSwitch}
        onClose={() => setRolePickerVisible(false)}
      />

      {/* 版本号标识 */}
      <View className="absolute bottom-2 right-3">
        <View className="bg-gray-100/80 dark:bg-gray-800/80 px-2 py-0.5 rounded-md">
          <Text className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
            {process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD')} - v3.1.0
          </Text>
        </View>
      </View>
    </Screen>
  );
}

// 用于生成唯一的屏幕实例 ID
let screenInstanceCounter = 0;

export default function ChatScreen() {
  // EF-59 ROUTE TRACE: 追踪 ChatScreen 实例和路由
  const screenInstanceId = useRef(`screen_${++screenInstanceCounter}`);
  const pathname = usePathname();
  
  useEffect(() => {
    console.log('[EF59_ROUTE_TRACE] ChatScreen mounted ' + JSON.stringify({
      screenInstanceId: screenInstanceId.current,
      route: pathname,
      timestamp: Date.now()
    }));
    return () => {
      console.log('[EF59_ROUTE_TRACE] ChatScreen unmounted ' + JSON.stringify({
        screenInstanceId: screenInstanceId.current,
        route: pathname,
        timestamp: Date.now()
      }));
    };
  }, [pathname]);

  return <ChatContent />;
}