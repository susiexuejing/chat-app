/**
 * 角色头部组件
 * 显示当前选择的陪伴者和操作按钮
 * 左上角：角色图标+名称，点击弹出角色选择
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

// 角色图标映射（FontAwesome6 Free Solid 有效图标）
const ROLE_ICONS: Record<string, string> = {
  'clever-fox': 'brain',               // 机智聪明 → 大脑
  'warm-bear': 'hand-holding-heart',   // 温暖治愈 → 暖心
  'wise-owl': 'graduation-cap',        // 深思智慧 → 学识帽
  'emotion-elf': 'sparkles',           // 情感精灵 → 闪光
  'philosophical-dolphin': 'fish',     // 哲思海豚 → 鱼
  'family-elephant': 'people-group',   // 团结大象 → 人群
};

// 获取角色对应的图标名
function getRoleIcon(roleId?: string): string {
  if (!roleId) return 'user';
  return ROLE_ICONS[roleId] || 'user';
}

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
  const themeColor = currentRole?.themeColor || '#6B7280';

  return (
    <View
      className="px-4 py-3 border-b border-gray-200 dark:border-gray-700"
      style={{
        paddingTop: insets.top + 8,
        backgroundColor: themeColor + '08',
      }}
    >
      <View className="flex-row items-center justify-between">
        {/* 左侧：角色图标+名称，点击弹出角色选择 */}
        <TouchableOpacity
          onPress={onShowRolePicker}
          className="flex-row items-center flex-shrink-0"
        >
          <View
            className="w-11 h-11 rounded-full items-center justify-center"
            style={{ backgroundColor: themeColor + '20' }}
          >
            <FontAwesome6
              name={getRoleIcon(currentRole?.id) as any}
              size={22}
              color={themeColor}
            />
          </View>
          <View className="ml-2.5 mr-3">
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
              切换陪伴方式
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
            className="px-3 py-2 rounded-full"
            style={{ backgroundColor: themeColor + '15' }}
          >
            <View className="flex-row items-center">
              <FontAwesome6
                name="plus"
                size={12}
                color={themeColor}
              />
              <Text
                className="ml-1.5 text-xs font-medium"
                style={{ color: themeColor }}
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
