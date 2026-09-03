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
  onShowRolePicker,
  onShowRoleDetail,
  onNewChat,
  hasHistory,
}: RoleHeaderProps) {
  // Phase 1 keeps the companion-picker implementation available, but does not
  // expose it in the chat header.
  const shouldShowRolePicker = false;

  return (
    <View className="px-4 pt-3 pb-2 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-base font-bold text-gray-900 dark:text-white">
            EmotionFlow
          </Text>
        </View>

        {shouldShowRolePicker && (
          <TouchableOpacity
            onPress={onShowRolePicker}
            className="flex-row items-center bg-amber-50 dark:bg-amber-900/20 rounded-full px-3 py-1.5 ml-2"
          >
            <Ionicons name="swap-horizontal" size={14} color="#D97706" />
            <Text className="text-xs text-amber-600 dark:text-amber-400 ml-1 font-medium">
              切换陪伴者
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 操作栏 */}
      <View className="flex-row justify-end mt-2 space-x-2 gap-2">
        {hasHistory && (
          <TouchableOpacity onPress={onNewChat}
            className="flex-row items-center bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1"
          >
            <Ionicons name="add-circle-outline" size={14} color="#6B7280" />
            <Text className="text-xs text-gray-500 dark:text-gray-400 ml-1">新建</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
