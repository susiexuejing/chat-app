/**
 * 消息列表组件
 * 包含欢迎消息和消息气泡列表
 */

import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, Image, ActivityIndicator, TouchableOpacity } from 'react-native';
import { MessageBubble } from './MessageBubble';
import { DeepAnalysisCard } from './DeepAnalysisCard';
import { useChat } from '../contexts/ChatContext';
import { ChatMessage } from '../types';
import { FontAwesome6 } from '@expo/vector-icons';

interface MessageListProps {
  onShowIntro: () => void;
}

export function MessageList({ onShowIntro }: MessageListProps) {
  const { messages, currentRole, lightAnalysis, isLoading, setInputText, turnStatus, retryLastMessage } = useChat();
  const scrollViewRef = useRef<ScrollView>(null);
  const [isAITyping, setIsAITyping] = React.useState(false);
  

  // 自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  // 欢迎消息
  if (messages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        {/* AI 头像 */}
        <Image
          source={{ uri: currentRole?.avatar }}
          className="w-20 h-20 rounded-full mb-6"
        />
        
        {/* 欢迎语 */}
        <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {currentRole?.name}
        </Text>
        <View
          className="px-3 py-1 rounded-full mb-6"
          style={{ backgroundColor: currentRole?.themeColor + '15' }}
        >
          <Text
            className="text-sm font-medium"
            style={{ color: currentRole?.themeColor }}
          >
            {currentRole?.shortDesc}
          </Text>
        </View>
        
        {/* 简介提示 */}
        <TouchableOpacity
          onPress={onShowIntro}
          className="bg-gray-100 dark:bg-gray-800 rounded-2xl p-4 mb-6 w-full"
        >
          <View className="flex-row items-center">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: currentRole?.themeColor + '15' }}
            >
              <FontAwesome6
                name="circle-info"
                size={18}
                color={currentRole?.themeColor}
              />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-200">
                了解 {currentRole?.name}的陪伴方式
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                点击查看{currentRole?.name}如何陪你
              </Text>
            </View>
            <FontAwesome6 name="chevron-right" size={14} color="#9CA3AF" />
          </View>
        </TouchableOpacity>
        
        {/* 输入提示 */}
        <Text className="text-gray-500 dark:text-gray-400 text-center text-base mb-1">
          你不需要整理好语言。
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-center text-sm mb-4">
          只需要把此刻最真实的一句话放在这里。
        </Text>

        {/* 状态入口按钮 */}
        <View className="flex-row flex-wrap justify-center gap-2 px-2">
          {['我很累', '我很乱', '我很烦', '我很空', '我说不清'].map((text) => (
            <TouchableOpacity
              key={text}
              onPress={() => setInputText('我感觉' + text)}
              className="px-4 py-2 rounded-full"
              style={{ backgroundColor: (currentRole?.themeColor || '#4F46E5') + '12' }}
              activeOpacity={0.6}
            >
              <Text 
                className="text-sm font-medium"
                style={{ color: currentRole?.themeColor || '#4F46E5' }}
              >
                {text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // 消息列表
  return (
    <ScrollView
      ref={scrollViewRef}
      className="flex-1 py-4"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
      onContentSizeChange={() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }}
    >
      {/* 遍历消息 */}
      {messages.map((message: ChatMessage, index: number) => {
        const isCurrentUserMessage = message.role === 'user';
        const isNextMessageAI = index < messages.length - 1 && messages[index + 1]?.role === 'assistant';
        
        return (
          <React.Fragment key={message.id}>
            <MessageBubble message={message} />

            {/* AI 消息后显示深度分析卡片 */}
            {!isCurrentUserMessage && message.deepAnalysis && (
              <DeepAnalysisCard analysis={message.deepAnalysis} />
            )}
          </React.Fragment>
        );
      })}
      
      {/* AI 正在输入指示器（当最后一条是用户消息时显示，且不在中断状态） */}
      {messages.length > 0 && messages[messages.length - 1].role === 'user' && turnStatus !== 'interrupted' && (
        <View className="flex-row items-center mb-4 px-4">
          <Image
            source={{ uri: currentRole?.avatar }}
            className="w-8 h-8 rounded-full mr-2"
          />
          <View className="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-md flex-row items-center">
            <ActivityIndicator size="small" color={currentRole?.themeColor} className="mr-2" />
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {currentRole?.name} 正在思考中...
            </Text>
          </View>
        </View>
      )}

      {/* EF-38: 中断状态提示和重试按钮 */}
      {turnStatus === 'interrupted' && (
        <View className="flex-row items-center mb-4 px-4">
          <Image
            source={{ uri: currentRole?.avatar }}
            className="w-8 h-8 rounded-full mr-2"
          />
          <View className="flex-1 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 rounded-2xl rounded-bl-md">
            <Text className="text-orange-700 dark:text-orange-300 text-sm mb-3">
              刚才的回复因页面刷新而中断，你可以重新生成。
            </Text>
            <TouchableOpacity
              onPress={retryLastMessage}
              className="bg-orange-500 dark:bg-orange-600 px-4 py-2 rounded-xl self-start"
              activeOpacity={0.8}
            >
              <Text className="text-white font-medium text-sm">
                重新生成
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
