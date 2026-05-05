/**
 * 角色选择弹框组件
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { PsychologistRole } from '../constants/roles';

interface RolePickerModalProps {
  visible: boolean;
  roles: PsychologistRole[];
  currentRole: PsychologistRole | null;
  onSelectRole: (role: PsychologistRole) => void;
  onClose: () => void;
}

export function RolePickerModal({
  visible,
  roles,
  currentRole,
  onSelectRole,
  onClose,
}: RolePickerModalProps) {
  const handleSelect = (role: PsychologistRole) => {
    onSelectRole(role);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        className="flex-1 bg-black/50"
        activeOpacity={1}
        onPress={onClose}
      >
        <View className="flex-1 justify-end">
          <View className="bg-white dark:bg-gray-800 rounded-t-3xl">
              {/* 顶部装饰条 */}
              <View className="items-center pt-3 pb-2">
                <View className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
              </View>

              {/* 标题 */}
              <View className="px-5 pb-3">
                <Text className="text-lg font-semibold text-gray-900 dark:text-white text-center">
                  选择你的咨询师
                </Text>
                <Text className="text-sm text-gray-500 dark:text-gray-400 text-center mt-1">
                  每个角色都有独特的咨询风格
                </Text>
              </View>

              {/* 角色列表 */}
              <ScrollView
                className="px-5 pb-8"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 450 }}
              >
                {roles.map((role) => {
                  const isSelected = currentRole?.id === role.id;
                  return (
                    <TouchableOpacity
                      key={role.id}
                      className={`flex-row items-center p-4 rounded-2xl mb-3 ${
                        isSelected
                          ? 'border-2'
                          : 'bg-gray-50 dark:bg-gray-700/50'
                      }`}
                      style={
                        isSelected
                          ? { borderColor: role.themeColor, backgroundColor: role.themeColor + '08' }
                          : undefined
                      }
                      onPress={() => handleSelect(role)}
                    >
                      {/* 头像 */}
                      <View className="relative">
                        <Image
                          source={{ uri: role.avatar }}
                          className="w-14 h-14 rounded-full"
                        />
                        {isSelected && (
                          <View
                            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full items-center justify-center"
                            style={{ backgroundColor: role.themeColor }}
                          >
                            <FontAwesome6 name="check" size={12} color="white" />
                          </View>
                        )}
                      </View>

                      {/* 信息 */}
                      <View className="flex-1 ml-4">
                        <View className="flex-row items-center">
                          <Text className="text-base font-semibold text-gray-900 dark:text-white">
                            {role.name}
                          </Text>
                          <View
                            className="ml-2 px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: role.themeColor + '20' }}
                          >
                            <Text
                              className="text-xs font-medium"
                              style={{ color: role.themeColor }}
                            >
                              {role.therapyType.split('(')[0].trim()}
                            </Text>
                          </View>
                        </View>
                        <Text
                          className="text-sm text-gray-500 dark:text-gray-400 mt-1"
                          numberOfLines={2}
                        >
                          {role.description}
                        </Text>
                      </View>

                      {/* 箭头 */}
                      <FontAwesome6
                        name="chevron-right"
                        size={16}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  );
                })}

                {/* 底部提示 */}
                <View className="mt-4 mb-4">
                  <Text className="text-xs text-gray-400 dark:text-gray-500 text-center">
                    点击任意角色即可切换咨询师
                  </Text>
                </View>
              </ScrollView>
            </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
