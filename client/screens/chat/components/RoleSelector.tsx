/**
 * 角色选择器组件
 * 底部弹出选择不同心理咨询师角色
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
} from 'react-native';
import { ChatRole, PsychologistRole } from '../constants/roles';
import { useChat } from '../contexts/ChatContext';
import { FontAwesome6 } from '@expo/vector-icons';

interface RoleSelectorProps {
  visible: boolean;
  onClose: () => void;
}

export function RoleSelector({ visible, onClose }: RoleSelectorProps) {
  const { currentRole, roles, setCurrentRole, createNewChat } = useChat();

  const handleSelectRole = async (role: ChatRole) => {
    // 先设置当前角色
    setCurrentRole(role);
    // 切换角色时创建新对话
    await createNewChat();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-end">
        <TouchableWithoutFeedback onPress={onClose}>
          <View className="flex-1" />
        </TouchableWithoutFeedback>
        
        <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6 max-h-[70vh]">
          {/* 拖动条 */}
          <View className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4" />
          
          {/* 标题 */}
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-xl font-bold text-gray-900 dark:text-white">
              选择咨询师
            </Text>
            <TouchableOpacity onPress={onClose} className="p-2">
              <FontAwesome6 name="xmark" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          
          {/* 角色列表 */}
          <ScrollView showsVerticalScrollIndicator={false}>
            {roles.map((role: PsychologistRole) => (
              <TouchableOpacity
                key={role.id}
                onPress={() => handleSelectRole(role)}
                className={`flex-row items-center p-4 rounded-2xl mb-3 ${
                  currentRole.id === role.id
                    ? 'bg-gray-100 dark:bg-gray-800 border-2'
                    : 'bg-gray-50 dark:bg-gray-800/50'
                }`}
                style={{
                  borderColor: currentRole.id === role.id ? role.themeColor : 'transparent',
                }}
              >
                <Image
                  source={{ uri: role.avatar }}
                  className="w-14 h-14 rounded-full"
                />
                <View className="flex-1 ml-4">
                  <View className="flex-row items-center">
                    <Text className="text-base font-semibold text-gray-900 dark:text-white">
                      {role.name}
                    </Text>
                    {currentRole.id === role.id && (
                      <View
                        className="ml-2 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: role.themeColor + '20' }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: role.themeColor }}
                        >
                          当前
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {role.shortDesc}
                  </Text>
                </View>
                <FontAwesome6
                  name="chevron-right"
                  size={16}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// 辅助组件
import { TouchableWithoutFeedback } from 'react-native';
