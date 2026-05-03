/**
 * 多角色心理咨询对话主页
 * 支持角色切换、文本/语音/图片多模态输入、历史对话管理
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  Modal,
} from 'react-native';
import { Screen } from '@/components/Screen';
import {
  RoleSelector,
  RoleIntroModal,
  RoleHeader,
  MessageList,
  MultimodalInput,
  HistoryList,
} from './components';
import { ChatProvider, useChat } from './contexts/ChatContext';

function ChatContent() {
  const {
    currentRole,
    messages,
    sendMessage,
    isLoading,
    createNewChat,
    currentSession,
    sessions,
  } = useChat();

  const [roleSelectorVisible, setRoleSelectorVisible] = useState(false);
  const [introModalVisible, setIntroModalVisible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // 处理发送消息（由 ChatContext 统一处理 API 调用）
  const handleSendMessage = useCallback(
    async (text: string, options?: { imageUri?: string; audioUri?: string }) => {
      await sendMessage(text, options);
    },
    [sendMessage]
  );

  // 显示角色简介（首次进入或无历史时）
  useEffect(() => {
    if (messages.length === 0 && sessions.length === 0) {
      const timer = setTimeout(() => {
        setIntroModalVisible(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

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

      {/* 角色头部 */}
      <RoleHeader
        onSelectRole={() => setRoleSelectorVisible(true)}
        onShowIntro={() => setIntroModalVisible(true)}
        onShowHistory={() => setShowHistory(true)}
        hasHistory={sessions.length > 0}
      />

      {/* 消息列表 */}
      <View className="flex-1">
        <MessageList onSelectRole={() => setRoleSelectorVisible(true)} />
        
        {/* 加载指示器 */}
        {isLoading && (
          <View className="absolute bottom-24 left-0 right-0 items-center">
            <View className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full flex-row items-center">
              <ActivityIndicator size="small" color={currentRole.themeColor} />
              <Text className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                {currentRole.name} 正在思考...
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* 输入区域 */}
      <MultimodalInput
        onSendMessage={handleSendMessage}
        disabled={isLoading}
      />

      {/* 角色选择器 */}
      <RoleSelector
        visible={roleSelectorVisible}
        onClose={() => setRoleSelectorVisible(false)}
      />

      {/* 角色简介弹窗 */}
      <RoleIntroModal
        visible={introModalVisible}
        role={currentRole}
        onClose={() => setIntroModalVisible(false)}
      />
    </Screen>
  );
}

export default function ChatScreen() {
  return (
    <ChatProvider>
      <ChatContent />
    </ChatProvider>
  );
}
