/**
 * 咨询师选择首页
 * 让用户选择合适的心理咨询师
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { PsychologistRole, DEFAULT_ROLES } from './constants/roles';
import { useChat } from './contexts/ChatContext';
import { FontAwesome6 } from '@expo/vector-icons';

export default function SelectCounselorScreen() {
  const insets = useSafeAreaInsets();
  const { setCurrentRole, createNewChat } = useChat();
  const [selectedRole, setSelectedRole] = useState<PsychologistRole | null>(null);

  const handleSelectCounselor = (role: PsychologistRole) => {
    setSelectedRole(role);
    // 设置当前角色
    setCurrentRole(role);
    // 创建新对话
    createNewChat(role);
    // 跳转到聊天页面
    router.push('/chat');
  };

  return (
    <Screen>
      <View className="flex-1 bg-white dark:bg-gray-900">
        {/* 顶部区域 */}
        <View 
          className="pt-16 pb-8 px-6 rounded-b-3xl"
          style={{ backgroundColor: '#F9FAFB' }}
        >
          <Text className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            找到你的倾听者
          </Text>
          <Text className="text-base text-gray-500 dark:text-gray-400">
            选择一位信任的心理咨询师，开始你的心灵之旅
          </Text>
        </View>

        {/* 咨询师列表 */}
        <ScrollView 
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          {DEFAULT_ROLES.map((role: PsychologistRole) => (
            <TouchableOpacity
              key={role.id}
              onPress={() => handleSelectCounselor(role)}
              className={`flex-row items-center p-4 rounded-2xl mb-4 ${
                selectedRole?.id === role.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/20'
                  : 'bg-gray-50 dark:bg-gray-800/50'
              }`}
              style={{
                borderWidth: 2,
                borderColor: selectedRole?.id === role.id ? role.themeColor : 'transparent',
              }}
            >
              {/* 头像 */}
              <Image
                source={{ uri: role.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${role.id}` }}
                className="w-16 h-16 rounded-full"
              />

              {/* 信息 */}
              <View className="flex-1 ml-4">
                <View className="flex-row items-center">
                  <Text className="text-lg font-semibold text-gray-900 dark:text-white">
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
                      {role.therapyType}
                    </Text>
                  </View>
                </View>

                <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {role.title}
                </Text>

                <Text
                  className="text-sm text-gray-600 dark:text-gray-300 mt-2"
                  numberOfLines={2}
                >
                  {role.shortDesc}
                </Text>

                {/* 专长标签 */}
                <View className="flex-row flex-wrap mt-2">
                  {role.expertise?.slice(0, 3).map((tag: string, index: number) => (
                    <View
                      key={index}
                      className="mr-2 mb-1 px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: role.themeColor + '15' }}
                    >
                      <Text
                        className="text-xs"
                        style={{ color: role.themeColor }}
                      >
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* 箭头 */}
              <FontAwesome6 name="chevron-right" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 底部安全区 */}
        <View style={{ height: insets.bottom + 20 }} />
      </View>
    </Screen>
  );
}
