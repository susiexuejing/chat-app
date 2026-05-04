/**
 * 角色头部组件
 * 显示当前选择的咨询师信息和操作按钮
 */

import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

interface RoleHeaderProps {
  onSelectRole: () => void;
  onShowIntro: () => void;
  onShowHistory: () => void;
  hasHistory?: boolean;
}

export function RoleHeader({ 
  onSelectRole, 
  onShowIntro, 
  onShowHistory,
  hasHistory = false,
}: RoleHeaderProps) {
  const { currentRole } = useChat();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="px-4 py-3 border-b border-gray-200 dark:border-gray-700"
      style={{
        paddingTop: insets.top + 8,
        backgroundColor: currentRole.themeColor + '08',
      }}
    >
      <View className="flex-row items-center">
        {/* 头像 */}
        <TouchableOpacity onPress={onShowIntro} className="relative">
          <Image
            source={{ uri: currentRole.avatar }}
            className="w-12 h-12 rounded-full border-2"
            style={{ borderColor: currentRole.themeColor }}
          />
          <View
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full items-center justify-center"
            style={{ backgroundColor: currentRole.themeColor }}
          >
            <FontAwesome6 name="heart" size={10} color="white" />
          </View>
        </TouchableOpacity>

        {/* 名称和简介 */}
        <TouchableOpacity
          onPress={onShowIntro}
          className="flex-1 ml-3"
        >
          <Text className="text-base font-semibold text-gray-900 dark:text-white">
            {currentRole.name}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {currentRole.shortDesc}
          </Text>
        </TouchableOpacity>

        {/* 历史按钮 */}
        {hasHistory && (
          <TouchableOpacity
            onPress={onShowHistory}
            className="w-10 h-10 items-center justify-center mr-2"
          >
            <FontAwesome6 name="clock-rotate-left" size={20} color="#6B7280" />
          </TouchableOpacity>
        )}

        {/* 切换按钮 */}
        <TouchableOpacity
          onPress={onSelectRole}
          className="px-3 py-2 rounded-full"
          style={{ backgroundColor: currentRole.themeColor + '15' }}
        >
          <View className="flex-row items-center">
            <FontAwesome6
              name="right-left"
              size={14}
              color={currentRole.themeColor}
            />
            <Text
              className="ml-1.5 text-sm font-medium"
              style={{ color: currentRole.themeColor }}
            >
              切换
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}
