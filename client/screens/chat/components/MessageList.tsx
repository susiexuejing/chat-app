/**
 * 消息列表组件
 * 包含欢迎消息和消息气泡列表
 */

import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, Image, ActivityIndicator } from 'react-native';
import { MessageBubble } from './MessageBubble';
import { LightAnalysisCard } from './LightAnalysisCard';
import { useChat } from '../contexts/ChatContext';
import { ChatMessage, AnalysisResult } from '../types';
import { FontAwesome6 } from '@expo/vector-icons';

interface MessageListProps {
  onShowIntro: () => void;
}

export function MessageList({ onShowIntro }: MessageListProps) {
  const { messages, currentRole, lightAnalysis } = useChat();
  const scrollViewRef = useRef<ScrollView>(null);
  const [isAITyping, setIsAITyping] = React.useState(false);
  const [currentAnalysis, setCurrentAnalysis] = React.useState<AnalysisResult | null>(null);
  
  // 监听 lightAnalysis 变化，显示分析结果
  React.useEffect(() => {
    if (lightAnalysis) {
      setCurrentAnalysis(lightAnalysis);
    }
  }, [lightAnalysis]);

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
          source={{ uri: currentRole.avatar }}
          className="w-20 h-20 rounded-full mb-6"
        />
        
        {/* 欢迎语 */}
        <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {currentRole.name}
        </Text>
        <View
          className="px-3 py-1 rounded-full mb-6"
          style={{ backgroundColor: currentRole.themeColor + '15' }}
        >
          <Text
            className="text-sm font-medium"
            style={{ color: currentRole.themeColor }}
          >
            {currentRole.shortDesc}
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
              style={{ backgroundColor: currentRole.themeColor + '15' }}
            >
              <FontAwesome6
                name="circle-info"
                size={18}
                color={currentRole.themeColor}
              />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-200">
                了解 {currentRole.name}
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                点击查看咨询师简介和风格
              </Text>
            </View>
            <FontAwesome6 name="chevron-right" size={14} color="#9CA3AF" />
          </View>
        </TouchableOpacity>
        
        {/* 输入提示 */}
        <Text className="text-gray-500 dark:text-gray-400 text-center text-sm mb-2">
          欢迎来到这里，我是 {currentRole.name}
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-center text-sm">
          告诉我你想聊些什么，或者有什么困扰着你
        </Text>
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
      {messages.map((message: ChatMessage) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      
      {/* 轻量分析卡片 */}
      {currentAnalysis && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
        <LightAnalysisCard analysis={currentAnalysis} />
      )}
      
      {/* AI 正在输入指示器 */}
      {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
        <View className="flex-row items-center mb-4 px-4">
          <Image
            source={{ uri: currentRole.avatar }}
            className="w-8 h-8 rounded-full mr-2"
          />
          <View className="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-md flex-row items-center">
            <ActivityIndicator size="small" color={currentRole.themeColor} className="mr-2" />
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {currentRole.name} 正在思考中...
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// 导入 TouchableOpacity
import { TouchableOpacity } from 'react-native';
