/**
 * 角色头部组件
 * 显示当前选择的咨询师信息和操作按钮
 * 左上角：角色头像+名称，点击弹出角色选择
 * 中间：了解+角色名称，点击弹出角色详情
 */

import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

interface RoleHeaderProps {
  onShowRolePicker: () => void;
  onShowRoleDetail: () => void;
  onShowHistory: () => void;
  onNewChat: () => void;
  hasHistory?: boolean;
}

export function RoleHeader({
  onShowRolePicker,
  onShowRoleDetail,
  onShowHistory,
  onNewChat,
  hasHistory = false,
}: RoleHeaderProps) {
  const { currentRole } = useChat();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="px-4 py-3 border-b border-gray-200 dark:border-gray-700"
      style={{
        paddingTop: insets.top + 8,
        backgroundColor: currentRole?.themeColor ? currentRole.themeColor + '08' : '#FFFFFF',
      }}
    >
      <View className="flex-row items-center">
        {/* 左侧：角色头像+名称，点击弹出角色选择 */}
        <TouchableOpacity
          onPress={onShowRolePicker}
          className="flex-row items-center"
        >
          <Image
            source={{ uri: currentRole?.avatar }}
            className="w-11 h-11 rounded-full border-2"
            style={{ borderColor: currentRole?.themeColor || '#E5E7EB' }}
          />
          <View className="ml-2.5">
            <View className="flex-row items-center">
              <Text className="text-base font-semibold text-gray-900 dark:text-white">
                {currentRole?.name}
              </Text>
              <FontAwesome6
                name="chevron-down"
                size={12}
                color="#9CA3AF"
                className="ml-1"
              />
            </View>
            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              点击切换咨询师
            </Text>
          </View>
        </TouchableOpacity>

        {/* 中间：了解+角色名称，点击弹出角色详情 */}
        <TouchableOpacity
          onPress={onShowRoleDetail}
          className="flex-1 items-center px-3"
        >
          <View
            className="px-4 py-1.5 rounded-full"
            style={{ backgroundColor: currentRole?.themeColor + '15' }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: currentRole?.themeColor }}
            >
              了解 {currentRole?.name}
            </Text>
          </View>
        </TouchableOpacity>

        {/* 右侧按钮组 */}
        <View className="flex-row items-center">
          {/* 历史按钮 */}
          {hasHistory && (
            <TouchableOpacity
              onPress={onShowHistory}
              className="w-10 h-10 items-center justify-center"
            >
              <FontAwesome6 name="clock-rotate-left" size={18} color="#6B7280" />
            </TouchableOpacity>
          )}

          {/* 新建对话按钮 */}
          <TouchableOpacity
            onPress={onNewChat}
            className="ml-1 px-3 py-2 rounded-full"
            style={{ backgroundColor: currentRole?.themeColor + '15' }}
          >
            <View className="flex-row items-center">
              <FontAwesome6
                name="plus"
                size={12}
                color={currentRole?.themeColor}
              />
              <Text
                className="ml-1.5 text-xs font-medium"
                style={{ color: currentRole?.themeColor }}
              >
                新建
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
