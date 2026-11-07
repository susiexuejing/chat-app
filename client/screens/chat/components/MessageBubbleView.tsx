/**
 * 纯展示消息气泡组件（不读取聊天上下文）
 * 显示用户和 AI 助手的消息
 */

import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage } from '@/screens/chat/types';
import { ChatAvatarView } from '@/screens/chat/components/ChatAvatarView';

export interface MessageBubbleViewProps {
  message: ChatMessage;
  thinking?: string; // 思考内容
  /** null opts into a local avatar; undefined preserves the live UI fallback. */
  assistantAvatar?: string | null;
}

function MessageBubbleViewComponent({ message, thinking, assistantAvatar }: MessageBubbleViewProps) {
  const isUser = message.role === 'user';
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    // EM-51: 明确使用本地时区，避免时区转换问题
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false, // 使用24小时制，避免AM/PM问题
    });
  };

  return (
    <View
      className={`flex-row mb-4 px-4 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* AI 头像 */}
      {!isUser && (
        <ChatAvatarView
          uri={assistantAvatar}
          className="w-8 h-8 rounded-full mr-2 self-end"
        />
      )}
      
      {/* 消息内容 */}
      <View
        className={`max-w-[75%] ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        {/* 消息气泡 */}
        <View
          className={`px-4 py-3 rounded-2xl ${
            isUser
              ? 'rounded-br-md'
              : 'rounded-bl-md'
          }`}
          style={{
            backgroundColor: isUser ? '#10B981' : '#F3F4F6',
          }}
        >
          <Text
            className={`text-base leading-relaxed ${
              isUser
                ? 'text-white'
                : 'text-gray-800 dark:text-gray-100'
            }`}
          >
            {message.content}
          </Text>
        </View>
        
        {/* 思考过程（可折叠显示） */}
        {thinking && (
          <View className="mt-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700/30">
            <View className="flex-row items-center mb-1">
              <Ionicons name="bulb-outline" size={12} className="text-amber-600 dark:text-amber-400 mr-1" />
              <Text className="text-xs text-amber-600 dark:text-amber-400">
                正在思考...
              </Text>
            </View>
            <Text className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed">
              {thinking.slice(-200)} {/* 显示最后200字 */}
            </Text>
          </View>
        )}
        
        {/* 时间戳 */}
        <Text className="text-xs text-gray-400 mt-1 px-1">
          {formatTime(message.timestamp)}
        </Text>
      </View>
      
      {/* 用户头像（占位） */}
      {isUser && (
        <View className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 ml-2 self-end items-center justify-center">
          <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
            我
          </Text>
        </View>
      )}
    </View>
  );
}

// 使用 memo 优化，避免不必要的重渲染
export const MessageBubbleView = memo(MessageBubbleViewComponent);

