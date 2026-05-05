/**
 * 消息气泡组件
 * 显示用户和 AI 助手的消息
 */

import React, { memo } from 'react';
import { View, Text, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatMessage } from '../types';
import { useChat } from '../contexts/ChatContext';

interface MessageBubbleProps {
  message: ChatMessage;
  thinking?: string; // 思考内容
}

function MessageBubbleComponent({ message, thinking }: MessageBubbleProps) {
  const { currentRole } = useChat();
  const isUser = message.role === 'user';
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
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
        <Image
          source={{ uri: currentRole.avatar }}
          className="w-8 h-8 rounded-full mr-2 self-end"
        />
      )}
      
      {/* 消息内容 */}
      <View
        className={`max-w-[75%] ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        {/* 附加图片 */}
        {message.imageUri && (
          <Image
            source={{ uri: message.imageUri }}
            className="w-48 h-48 rounded-2xl mb-2"
            resizeMode="cover"
          />
        )}
        
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
export const MessageBubble = memo(MessageBubbleComponent);
