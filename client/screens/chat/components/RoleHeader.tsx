import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '@/screens/chat/contexts/ChatContext';
import { roles } from '@/screens/chat/constants/roles';

const ROLE_INITIALS: Record<string, string> = {
  'clever-fox': '狐',
  'warm-bear': '熊',
  'wise-owl': '猫',
  'emotion-elf': '精',
  'philosophical-dolphin': '海',
  'family-elephant': '象',
};

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
  const { currentRole } = useChat();
  const role = currentRole || roles[0];
  if (!role) return null;

  return (
    <View className="px-4 pt-3 pb-2 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <View className="flex-row items-center">
        {/* 头像 - 彩色文字圆圈 */}
        <TouchableOpacity onPress={onShowRoleDetail} className="mr-3">
          <View className="w-10 h-10 rounded-full items-center justify-center overflow-hidden">
            <View className="absolute inset-0 opacity-20" style={{ backgroundColor: role.themeColor }} />
            <Text className="text-base font-bold" style={{ color: role.themeColor }}>
              {ROLE_INITIALS[role.id] || role.name[0]}
            </Text>
          </View>
        </TouchableOpacity>

        {/* 名称 + 描述 */}
        <TouchableOpacity onPress={onShowRoleDetail} className="flex-1">
          <Text className="text-sm font-bold text-gray-900 dark:text-white">
            {role.name}
            <Text className="text-xs font-normal text-gray-400 dark:text-gray-500"> 正在陪你</Text>
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {role.shortDesc}
          </Text>
        </TouchableOpacity>

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
