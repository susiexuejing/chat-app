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
import { ChatRole, PsychologistRole, roles } from './constants/roles';
import { useChat } from './contexts/ChatContext';
import { FontAwesome6 } from '@expo/vector-icons';

export default function SelectCounselorScreen() {
  const insets = useSafeAreaInsets();
  const { setCurrentRole, createNewChat } = useChat();
  const [selectedRole, setSelectedRole] = useState<PsychologistRole | null>(null);

  const handleSelectCounselor = async (role: PsychologistRole) => {
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
          {roles.map((role: PsychologistRole) => (
            <TouchableOpacity
              key={role.id}
              onPress={() => handleSelectCounselor(role)}
              activeOpacity={0.7}
              className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4"
              style={[
                { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 }
              ]}
            >
              <View className="flex-row items-center">
                {/* 头像 */}
                <View className="relative">
                  <Image
                    source={{ uri: role.avatar }}
                    className="w-16 h-16 rounded-full"
                  />
                  <View 
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full items-center justify-center"
                    style={{ backgroundColor: role.themeColor }}
                  >
                    <FontAwesome6 name="heart" size={12} color="white" />
                  </View>
                </View>

                {/* 信息 */}
                <View className="flex-1 ml-4">
                  <View className="flex-row items-center">
                    <Text className="text-lg font-semibold text-gray-900 dark:text-white">
                      {role.name}
                    </Text>
                    <View 
                      className="ml-2 px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: role.themeColor + '15' }}
                    >
                      <Text 
                        className="text-xs font-medium"
                        style={{ color: role.themeColor }}
                      >
                        {role.category}
                      </Text>
                    </View>
                  </View>
                  
                  <Text 
                    className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-2"
                    numberOfLines={1}
                  >
                    {role.shortDesc}
                  </Text>

                  {/* 专长标签 */}
                  <View className="flex-row flex-wrap">
                    {role.expertise.slice(0, 3).map((tag: string, index: number) => (
                      <View 
                        key={index}
                        className="mr-2 mb-1 px-2 py-1 rounded-full"
                        style={{ backgroundColor: '#F3F4F6' }}
                      >
                        <Text className="text-xs text-gray-600 dark:text-gray-300">
                          {tag}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* 箭头 */}
                <FontAwesome6 
                  name="chevron-right" 
                  size={18} 
                  color="#9CA3AF" 
                />
              </View>

              {/* 简介 */}
              <Text 
                className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300"
                numberOfLines={2}
              >
                {role.briefIntro}
              </Text>
            </TouchableOpacity>
          ))}

          {/* 底部留白 */}
          <View className="h-20" />
        </ScrollView>
      </View>
    </Screen>
  );
}
