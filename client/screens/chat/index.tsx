/**
 * 多角色心理咨询对话主页
 * 支持角色切换、文本/语音/图片多模态输入、历史对话管理
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
    sessions,
    sendMessage,
    isLoading,
    createNewChat,
    error,
    clearError,
  } = useChat();

  const [roleSelectorVisible, setRoleSelectorVisible] = useState(false);
  const [introModalVisible, setIntroModalVisible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // 处理发送消息（由 ChatContext 统一处理 API 调用）
  const handleSendMessage = useCallback(
    async (text: string) => {
      await sendMessage(text);
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
        onNewChat={createNewChat}
        hasHistory={sessions.length > 0}
      />

      {/* 消息列表 */}
      <View className="flex-1">
        <MessageList />
        
        {/* 加载指示器 */}
        {isLoading && (
          <View className="absolute bottom-24 left-0 right-0 items-center">
            <View className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full flex-row items-center">
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                {currentRole?.name || '咨询师'} 正在思考...
              </Text>
            </View>
          </View>
        )}
        
        {/* 错误提示 */}
        {error && !isLoading && (
          <View className="absolute bottom-24 left-4 right-4">
            <View className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl p-4">
              <View className="flex-row items-start">
                <View className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 items-center justify-center mr-3">
                  <Ionicons name="alert-circle" size={18} color="#dc2626" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">
                    请求超时
                  </Text>
                  <Text className="text-xs text-red-600 dark:text-red-300 mb-2">
                    网络连接不稳定，请检查网络后重试
                  </Text>
                  <View className="flex-row">
                    <TouchableOpacity
                      className="bg-red-500 px-3 py-1.5 rounded-lg mr-2"
                      onPress={() => {
                        clearError();
                        // 重试上一条消息
                        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
                        if (lastUserMessage) {
                          handleSendMessage(lastUserMessage.content);
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
      </View>

      {/* 免责声明 */}
      <View className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 flex-row items-center justify-center">
        <Ionicons name="warning-outline" size={12} color="#b45309" className="mr-1" />
        <Text className="text-xs text-amber-700 dark:text-amber-400">
          本产品为 AI 模拟对话，不代表真实心理咨询服务。如有严重心理困扰，请寻求专业帮助。
        </Text>
      </View>

      {/* 输入区域 */}
      <MultimodalInput
        onSendMessage={handleSendMessage}
        disabled={isLoading}
        isThinking={isLoading && messages.some(m => m.role === 'assistant' && m.content.startsWith('【思考中'))}
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
