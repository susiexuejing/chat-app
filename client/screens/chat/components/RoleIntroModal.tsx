import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { PsychologistRole } from '../constants/roles';

interface RoleIntroModalProps {
  visible: boolean;
  role: PsychologistRole | null;
  onClose: () => void;
  onStartChat?: () => void;
}

type TabType = 'intro' | 'story' | 'style';

const SectionTitle: React.FC<{ title: string; color: string }> = ({ title, color }) => (
  <Text className="text-base font-semibold mb-2" style={{ color }}>
    {title}
  </Text>
);

const InfoItem: React.FC<{ icon: string; label: string; content: string }> = ({
  icon,
  label,
  content,
}) => (
  <View className="flex-row items-start mb-3">
    <Text className="text-lg mr-2">{icon}</Text>
    <View className="flex-1">
      <Text className="text-xs text-gray-500 mb-0.5">{label}</Text>
      <Text className="text-sm text-gray-700 leading-5">{content}</Text>
    </View>
  </View>
);

export const RoleIntroModal: React.FC<RoleIntroModalProps> = ({
  visible,
  role,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('intro');

  if (!role) return null;

  const tabs: { key: TabType; label: string }[] = [
    { key: 'intro', label: '简介' },
    { key: 'story', label: '故事' },
    { key: 'style', label: '风格' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/40 justify-end">
        <TouchableWithoutFeedback onPress={onClose}>
          <View className="absolute inset-0" />
        </TouchableWithoutFeedback>

        <View className="bg-white rounded-t-3xl max-h-[85%]">
          {/* Header */}
          <View className="items-center pt-5 pb-4 px-5 border-b border-gray-100">
            <View className="flex-row items-center mb-2">
              <Text className="text-4xl mr-3">{role.avatar}</Text>
              <View>
                <Text className="text-xl font-bold text-gray-900">{role.name}</Text>
                <Text className="text-sm" style={{ color: role.themeColor }}>
                  {role.title}
                </Text>
              </View>
            </View>
            <View className="px-3 py-1 rounded-full" style={{ backgroundColor: `${role.themeColor}15` }}>
              <Text className="text-xs font-medium" style={{ color: role.themeColor }}>
                {role.therapyType}
              </Text>
            </View>
          </View>

          {/* Tab Bar */}
          <View className="flex-row border-b border-gray-100 px-5">
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                className="flex-1 py-3 items-center"
                onPress={() => setActiveTab(tab.key)}
              >
                <Text
                  className={`text-sm font-medium ${
                    activeTab === tab.key ? '' : 'text-gray-400'
                  }`}
                  style={
                    activeTab === tab.key
                      ? { color: role.themeColor }
                      : undefined
                  }
                >
                  {tab.label}
                </Text>
                {activeTab === tab.key && (
                  <View
                    className="absolute bottom-0 w-8 h-0.5 rounded-full"
                    style={{ backgroundColor: role.themeColor }}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Content */}
          <ScrollView className="px-5 py-4" showsVerticalScrollIndicator={false}>
            {activeTab === 'intro' && (
              <View>
                <SectionTitle title="关于我" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.description}
                </Text>

                <SectionTitle title="专业领域" color={role.themeColor} />
                <View className="flex-row flex-wrap mb-4">
                  {role.professionalBackground.specialties.map((specialty, index) => (
                    <View
                      key={index}
                      className="px-3 py-1.5 rounded-full mr-2 mb-2"
                      style={{ backgroundColor: `${role.themeColor}15` }}
                    >
                      <Text className="text-xs font-medium" style={{ color: role.themeColor }}>
                        {specialty}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* AI生成提示 */}
                <View className="bg-amber-50 rounded-xl p-3 mt-2">
                  <Text className="text-xs text-amber-700">
                    * 这是一位由AI模拟的心理咨询师角色，不代表真实的心理咨询或医学建议。如有严重心理问题，请寻求专业帮助。
                  </Text>
                </View>
              </View>
            )}

            {activeTab === 'story' && (
              <View>
                <SectionTitle title="成长背景" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.personalBackground.lifeExperience}
                </Text>

                <SectionTitle title="教育背景" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.professionalBackground.education}
                </Text>

                <SectionTitle title="工作背景" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.professionalBackground.workExperience}
                </Text>

                <SectionTitle title="个性特点" color={role.themeColor} />
                <View className="flex-row flex-wrap mb-4">
                  {role.personalBackground.personalityTraits.map((trait, index) => (
                    <View
                      key={index}
                      className="px-3 py-1.5 rounded-full mr-2 mb-2"
                      style={{ backgroundColor: `${role.themeColor}15` }}
                    >
                      <Text className="text-xs font-medium" style={{ color: role.themeColor }}>
                        {trait}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* AI生成提示 */}
                <View className="bg-amber-50 rounded-xl p-3 mt-2">
                  <Text className="text-xs text-amber-700">
                    * 这是一位由AI模拟的心理咨询师角色，不代表真实的心理咨询或医学建议。如有严重心理问题，请寻求专业帮助。
                  </Text>
                </View>
              </View>
            )}

            {activeTab === 'style' && (
              <View>
                <SectionTitle title="心理学理念" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.coreValues.psychologyConcept}
                </Text>

                <SectionTitle title="处理情感的方式" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.coreValues.emotionalApproach}
                </Text>

                <SectionTitle title="情感反应设定" color={role.themeColor} />
                <Text className="text-sm text-gray-600 leading-6 mb-4">
                  {role.emotionalResponse.reactionPattern}
                </Text>

                <SectionTitle title="经典语录" color={role.themeColor} />
                {role.classicQuotes.map((quote, index) => (
                  <View
                    key={index}
                    className="bg-gray-50 rounded-xl p-3 mb-2"
                  >
                    <Text className="text-sm text-gray-600 italic">
                      {`"${quote}"`}
                    </Text>
                  </View>
                ))}

                {/* AI生成提示 */}
                <View className="bg-amber-50 rounded-xl p-3 mt-4">
                  <Text className="text-xs text-amber-700">
                    * 这是一位由AI模拟的心理咨询师角色，不代表真实的心理咨询或医学建议。如有严重心理问题，请寻求专业帮助。
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View className="p-5 border-t border-gray-100">
            <TouchableOpacity
              className="py-3 rounded-xl items-center"
              style={{ backgroundColor: role.themeColor }}
              onPress={onClose}
            >
              <Text className="text-white font-semibold">开始对话</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// 需要导入这个
import { TouchableWithoutFeedback } from 'react-native';

const styles = StyleSheet.create({
  // 可以添加自定义样式
});
