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
          source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentRole?.id || 'default'}` }}
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
        
        {/* 时间戳 */}
        <Text className="text-xs text-gray-400 mt-1 px-1">
          {formatTime(message.timestamp)}
        </Text>
      </View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
