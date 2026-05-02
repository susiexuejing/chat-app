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
    addAssistantMessage,
    isLoading,
    setIsLoading,
    showHistory,
    setShowHistory,
    createNewChat,
    currentSession,
    sessions,
  } = useChat();

  const [roleSelectorVisible, setRoleSelectorVisible] = useState(false);
  const [introModalVisible, setIntroModalVisible] = useState(false);

  // 处理发送消息
  const handleSendMessage = useCallback(
    async (text: string, options?: { imageUri?: string; audioUri?: string }) => {
      // 发送用户消息
      sendMessage(text, options);
      
      // 构建消息历史用于API调用
      const historyMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      // 添加当前用户消息
      historyMessages.push({
        role: 'user',
        content: text,
      });

      // 调用后端API
      setIsLoading(true);

      try {
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              role: currentRole.id,
              systemPrompt: currentRole.systemPrompt,
              messages: historyMessages,
            }),
          }
        );

        if (!response.ok) {
          throw new Error('API request failed');
        }

        const data = await response.json();
        addAssistantMessage(data.content);
      } catch (error) {
        console.error('发送消息失败:', error);
        // 如果API调用失败，发送错误消息
        addAssistantMessage('抱歉，服务器暂时无法回应。请稍后再试。');
      } finally {
        setIsLoading(false);
      }
    },
    [messages, sendMessage, currentRole, addAssistantMessage, setIsLoading]
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
              <ActivityIndicator size="small" color={currentRole.accentColor} />
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
        onStartChat={() => {
          setIntroModalVisible(false);
          // 如果是首次进入且没有会话，创建新会话
          if (!currentSession) {
            createNewChat();
          }
        }}
      />
    </Screen>
  );
}

export default function ChatPage() {
  return (
    <ChatProvider>
      <ChatContent />
    </ChatProvider>
  );
}
