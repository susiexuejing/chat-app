/**
 * 角色头部组件
 * 显示当前选择的咨询师信息和操作按钮
 */

import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';
import { PsychologistRole } from '../constants/roles';

interface RoleHeaderProps {
  onSelectRole: () => void;
  onShowIntro: () => void;
  onShowHistory: () => void;
  onNewChat: (role: PsychologistRole) => void;
  hasHistory?: boolean;
}

export function RoleHeader({ 
  onSelectRole, 
  onShowIntro, 
  onShowHistory,
  onNewChat,
  hasHistory = false,
}: RoleHeaderProps) {
  const { currentRole } = useChat();
  const insets = useSafeAreaInsets();

  if (!currentRole) {
    return null;
  }

  return (
    <View
      className="px-4 py-3 border-b border-gray-200 dark:border-gray-700"
      style={{
        paddingTop: insets.top + 8,
        backgroundColor: (currentRole.themeColor || '#10B981') + '08',
      }}
    >
      <View className="flex-row items-center">
        {/* 头像 */}
        <TouchableOpacity onPress={onShowIntro} className="relative">
          <Image
            source={{ uri: currentRole.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentRole.id}` }}
            className="w-12 h-12 rounded-full border-2"
            style={{ borderColor: currentRole.themeColor || '#10B981' }}
          />
          <View
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full items-center justify-center"
            style={{ backgroundColor: currentRole.themeColor || '#10B981' }}
          >
            <FontAwesome6 name="heart" size={10} color="white" />
          </View>
        </TouchableOpacity>

        {/* 名称和简介 */}
        <TouchableOpacity
          onPress={onSelectRole}
          className="flex-1 ml-3"
        >
          <Text className="text-base font-semibold text-gray-900 dark:text-white">
            {currentRole.name}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {currentRole.title}
          </Text>
        </TouchableOpacity>

        {/* 历史记录按钮 */}
        {hasHistory && (
          <TouchableOpacity
            onPress={onShowHistory}
            className="p-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <FontAwesome6 name="clock-rotate-left" size={18} color="#6B7280" />
          </TouchableOpacity>
        )}

        {/* 新建对话按钮 */}
        <TouchableOpacity
          onPress={() => onNewChat(currentRole)}
          className="p-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <FontAwesome6 name="plus" size={18} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {/* 简介提示 */}
      <TouchableOpacity onPress={onShowIntro} className="mt-2">
        <Text className="text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {currentRole.briefIntro || '点击查看咨询师详细介绍'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
