/**
 * 角色详情弹框组件
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { PsychologistRole } from '../constants/roles';

interface RoleDetailModalProps {
  visible: boolean;
  role: PsychologistRole | null;
  onClose: () => void;
}

const { width } = Dimensions.get('window');

export function RoleDetailModal({ visible, role, onClose }: RoleDetailModalProps) {
  if (!role) return null;

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
            <View
              className="bg-white dark:bg-gray-800 rounded-t-3xl"
              style={{ maxHeight: '85%' }}
            >
              {/* 顶部装饰条 */}
              <View className="items-center pt-3 pb-2">
                <View className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
              </View>

              <ScrollView
                className="px-5 pb-10"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40 }}
              >
                {/* 角色头部 */}
                <View className="items-center mb-6">
                  <Image
                    source={{ uri: role.avatar }}
                    className="w-24 h-24 rounded-full border-4"
                    style={{ borderColor: role.themeColor }}
                  />
                  <Text className="text-2xl font-bold text-gray-900 dark:text-white mt-4">
                    {role.name}
                  </Text>
                  <Text className="text-base mt-1" style={{ color: role.themeColor }}>
                    {role.title}
                  </Text>
                  <View
                    className="px-4 py-1.5 rounded-full mt-3"
                    style={{ backgroundColor: role.themeColor + '15' }}
                  >
                    <Text className="text-sm font-medium" style={{ color: role.themeColor }}>
                      {role.therapyType}
                    </Text>
                  </View>
                </View>

                {/* 简介 */}
                <View className="mb-6">
                  <Text className="text-base text-gray-700 dark:text-gray-300 text-center leading-relaxed">
                    {role.description}
                  </Text>
                </View>

                {/* 免责声明 */}
                <View
                  className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 mb-6"
                >
                  <View className="flex-row items-center mb-2">
                    <FontAwesome6 name="triangle-exclamation" size={16} color="#F59E0B" />
                    <Text className="ml-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                      免责声明
                    </Text>
                  </View>
                  <Text className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                    请注意：以上角色设定仅为模拟，所有信息均由人工智能模型生成，准确性和完整性无法保证。
                    这些角色的行为和回应仅代表模拟的AI风格，并不代表真实的心理咨询或医学建议。
                    如果需要心理咨询服务，请咨询专业医师。
                  </Text>
                </View>

                {/* 职业背景 */}
                <View className="mb-5">
                  <SectionTitle icon="graduation-cap" title="职业背景" color={role.themeColor} />
                  <View className="mt-3 space-y-3">
                    <InfoItem label="教育背景" value={role.professionalBackground?.education} />
                    <InfoItem label="工作经历" value={role.professionalBackground?.workExperience} />
                    <InfoItem
                      label="专业领域"
                      values={role.professionalBackground?.specialties}
                    />
                  </View>
                </View>

                {/* 个人背景 */}
                <View className="mb-5">
                  <SectionTitle icon="user" title="个人背景" color={role.themeColor} />
                  <View className="mt-3 space-y-3">
                    <InfoItem
                      label="生活经历"
                      value={role.personalBackground?.lifeExperience}
                    />
                    <InfoItem
                      label="个性特点"
                      values={role.personalBackground?.personalityTraits}
                    />
                  </View>
                </View>

                {/* 核心价值观 */}
                <View className="mb-5">
                  <SectionTitle icon="heart" title="核心价值观" color={role.themeColor} />
                  <View className="mt-3 space-y-3">
                    <InfoItem
                      label="心理学理念"
                      value={role.coreValues?.psychologyConcept}
                    />
                    <InfoItem
                      label="情感处理方式"
                      value={role.coreValues?.emotionalApproach}
                    />
                  </View>
                </View>

                {/* 情感反应设定 */}
                <View className="mb-5">
                  <SectionTitle icon="comment" title="情感反应设定" color={role.themeColor} />
                  <View className="mt-3">
                    <InfoItem
                      label="反应模式"
                      value={role.emotionalResponse?.reactionPattern}
                    />
                  </View>
                </View>

                {/* 经典语录 */}
                {role.classicQuotes && role.classicQuotes.length > 0 && (
                  <View className="mb-5">
                    <SectionTitle icon="quote-left" title="经典语录" color={role.themeColor} />
                    <View className="mt-3 space-y-3">
                      {role.classicQuotes.map((quote, index) => (
                        <View
                          key={index}
                          className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4"
                        >
                          <Text className="text-sm text-gray-600 dark:text-gray-300 italic">
                            &ldquo;{quote}&rdquo;
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* 开始咨询按钮 */}
                <TouchableOpacity
                  className="rounded-full py-4 items-center mt-4"
                  style={{ backgroundColor: role.themeColor }}
                  onPress={onClose}
                >
                  <Text className="text-white font-semibold text-base">开始咨询</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// 章节标题组件
function SectionTitle({
  icon,
  title,
  color,
}: {
  icon: string;
  title: string;
  color: string;
}) {
  return (
    <View className="flex-row items-center">
      <View className="w-1 h-5 rounded-full" style={{ backgroundColor: color }} />
      <Text className="ml-3 text-base font-semibold text-gray-900 dark:text-white">
        {title}
      </Text>
    </View>
  );
}

// 信息项组件
function InfoItem({
  label,
  value,
  values,
}: {
  label: string;
  value?: string;
  values?: string[];
}) {
  return (
    <View>
      <Text className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </Text>
      {value && (
        <Text className="text-sm text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">
          {value}
        </Text>
      )}
      {values && (
        <View className="flex-row flex-wrap mt-2">
          {values.map((item, index) => (
            <View
              key={index}
              className="px-3 py-1 rounded-full mr-2 mb-1"
              style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}
            >
              <Text className="text-xs text-gray-600 dark:text-gray-400">{item}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
