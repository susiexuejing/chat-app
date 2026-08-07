/**
 * EF-58 Phase 2: Queue Status Bar
 * 
 * Displays queue state above the input area when messages are waiting.
 * Uses existing ChatContext APIs: messageQueue, queueCount, isLoading.
 */

import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

export function QueueStatusBar() {
  const { messageQueue, queueCount, isLoading } = useChat();

  // Only show when there are queued messages
  if (queueCount === 0 || messageQueue.length === 0) {
    return null;
  }

  // Find queued messages (status === 'queued')
  const queuedMessages = messageQueue.filter(m => m.status === 'queued');

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <View
      className="px-4 pt-2"
      testID="queue-status-bar"
    >
      <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3">
        {/* Header: AI is responding + queue count */}
        <View className="flex-row items-center mb-2">
          {isLoading ? (
            <ActivityIndicator size="small" color="#D97706" />
          ) : (
            <Ionicons name="time-outline" size={16} color="#D97706" />
          )}
          <Text className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-300 flex-1">
            {isLoading
              ? `AI 正在回复中 · ${queuedMessages.length} 条消息等待`
              : `${queuedMessages.length} 条消息等待中`}
          </Text>
        </View>

        {/* Queued messages list */}
        {queuedMessages.map((msg, index) => (
          <View
            key={msg.id}
            className="flex-row items-center mt-1.5"
            testID={`queue-item-${index}`}
          >
            {/* Position badge */}
            <View className="w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 items-center justify-center mr-2">
              <Text className="text-[10px] font-bold text-amber-800 dark:text-amber-200">
                {index + 1}
              </Text>
            </View>
            {/* Message preview (truncated) */}
            <Text
              className="text-xs text-amber-600 dark:text-amber-400 flex-1"
              numberOfLines={1}
              testID={`queue-item-text-${index}`}
            >
              {msg.text.length > 30 ? `${msg.text.substring(0, 30)}...` : msg.text}
            </Text>
            {/* Status indicator */}
            {index === 0 && isLoading ? (
              <View className="flex-row items-center ml-1">
                <View className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 mr-1" />
                <Text className="text-[10px] text-amber-500 dark:text-amber-400">
                  等待中
                </Text>
              </View>
            ) : (
              <View className="flex-row items-center ml-1">
                <Text className="text-[10px] text-amber-400 dark:text-amber-500">
                  #{index + 1}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
