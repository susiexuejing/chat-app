import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface RoleHeaderProps {
  onShowRolePicker: () => void;
  onShowRoleDetail: () => void;
  onShowHistory: () => void;
  onNewChat: () => void;
  hasHistory: boolean;
}

export function RoleHeader({
  onShowHistory,
  onNewChat,
}: RoleHeaderProps) {
  return (
    <View className="px-4 pt-3 pb-2 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <View className="flex-row items-center">
        {/* 产品标识：聊天顶部始终显示同一产品身份。 */}
        <View className="flex-1">
          <Text className="text-sm font-bold text-gray-900 dark:text-white">
            EmotionFlow
          </Text>
        </View>
      </View>

      {/* 操作栏 */}
      <View className="flex-row justify-end mt-2 space-x-2 gap-2">
        <TouchableOpacity
          onPress={onShowHistory}
          className="flex-row items-center bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1"
        >
          <Ionicons name="time-outline" size={14} color="#6B7280" />
          <Text className="text-xs text-gray-500 dark:text-gray-400 ml-1">历史聊天</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onNewChat}
          className="flex-row items-center bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1"
        >
          <Ionicons name="add-circle-outline" size={14} color="#6B7280" />
          <Text className="text-xs text-gray-500 dark:text-gray-400 ml-1">新对话</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
