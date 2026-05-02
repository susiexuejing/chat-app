/**
 * 角色简介弹窗组件
 * 显示选中角色的详细介绍
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
} from 'react-native';
import { ChatRole } from '../constants/roles';
import { FontAwesome6 } from '@expo/vector-icons';

interface RoleIntroModalProps {
  visible: boolean;
  role: ChatRole | null;
  onClose: () => void;
  onStartChat: () => void;
}

export function RoleIntroModal({
  visible,
  role,
  onClose,
  onStartChat,
}: RoleIntroModalProps) {
  if (!role) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-center items-center p-6">
        <TouchableOpacity
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
          activeOpacity={1}
        />
        
        <View className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-sm">
          {/* 关闭按钮 */}
          <TouchableOpacity
            onPress={onClose}
            className="absolute top-4 right-4 p-2 z-10"
          >
            <FontAwesome6 name="xmark" size={18} color="#6B7280" />
          </TouchableOpacity>
          
          {/* 头像 */}
          <View className="items-center mb-4">
            <Image
              source={{ uri: role.avatar }}
              className="w-24 h-24 rounded-full border-4"
              style={{ borderColor: role.accentColor }}
            />
          </View>
          
          {/* 名称和简介 */}
          <Text className="text-xl font-bold text-center text-gray-900 dark:text-white mb-1">
            {role.name}
          </Text>
          <View className="items-center mb-4">
            <View
              className="px-3 py-1 rounded-full"
              style={{ backgroundColor: role.accentColor + '15' }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: role.accentColor }}
              >
                {role.shortDesc}
              </Text>
            </View>
          </View>
          
          {/* 详细介绍 */}
          <Text className="text-gray-600 dark:text-gray-300 text-base leading-relaxed mb-6">
            {role.fullDesc}
          </Text>
          
          {/* 开始对话按钮 */}
          <TouchableOpacity
            onPress={onStartChat}
            className="w-full py-4 rounded-2xl items-center"
            style={{ backgroundColor: role.accentColor }}
          >
            <Text className="text-white font-semibold text-base">
              开始对话
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
