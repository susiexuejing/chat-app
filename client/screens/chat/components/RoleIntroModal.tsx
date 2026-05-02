/**
 * 角色简介弹窗组件
 * 显示选中角色的详细信息：简介、成长背景、教育背景、工作背景、咨询风格、经典语录
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  ScrollView,
} from 'react-native';
import { ChatRole } from '../constants/roles';
import { FontAwesome6 } from '@expo/vector-icons';

interface RoleIntroModalProps {
  visible: boolean;
  role: ChatRole | null;
  onClose: () => void;
  onStartChat: () => void;
}

type TabType = 'intro' | 'story' | 'style';

export function RoleIntroModal({
  visible,
  role,
  onClose,
  onStartChat,
}: RoleIntroModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('intro');

  if (!role) return null;

  const themeColor = role.themeColor || role.themeColor || '#10B981';
  const avatarUri = role.avatar?.startsWith('http') 
    ? role.avatar 
    : 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&h=200&fit=crop';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-end">
        <TouchableOpacity
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
          activeOpacity={1}
        />
        
        <View className="bg-white dark:bg-gray-900 rounded-t-3xl max-h-[85%]">
          {/* 拖动条 */}
          <View className="items-center py-3">
            <View className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
          </View>

          {/* 头部信息 */}
          <View className="px-6 pb-4 flex-row items-center">
            <Image
              source={{ uri: avatarUri }}
              className="w-20 h-20 rounded-full border-4"
              style={{ borderColor: themeColor }}
            />
            <View className="ml-4 flex-1">
              <Text className="text-xl font-bold text-gray-900 dark:text-white">
                {role.name}
              </Text>
              <View
                className="px-3 py-1 rounded-full self-start mt-1"
                style={{ backgroundColor: themeColor + '15' }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: themeColor }}
                >
                  {role.shortDesc}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <FontAwesome6 name="xmark" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Tab 切换 */}
          <View className="flex-row border-b border-gray-200 dark:border-gray-700 px-6">
            <TabButton
              title="简介"
              active={activeTab === 'intro'}
              onPress={() => setActiveTab('intro')}
              themeColor={themeColor}
            />
            <TabButton
              title="人物"
              active={activeTab === 'story'}
              onPress={() => setActiveTab('story')}
              themeColor={themeColor}
            />
            <TabButton
              title="风格"
              active={activeTab === 'style'}
              onPress={() => setActiveTab('style')}
              themeColor={themeColor}
            />
          </View>

          {/* Tab 内容 */}
          <ScrollView className="px-6 py-4 max-h-[300px]" showsVerticalScrollIndicator={false}>
            {activeTab === 'intro' && (
              <View>
                <SectionTitle title="关于我" themeColor={themeColor} />
                <Text className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                  {role.fullDesc}
                </Text>
              </View>
            )}

            {activeTab === 'story' && (
              <View>
                {role.growthBackground && (
                  <>
                    <SectionTitle title="成长背景" themeColor={themeColor} />
                    <Text className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                      {role.growthBackground}
                    </Text>
                  </>
                )}
                
                {role.educationBackground && (
                  <>
                    <SectionTitle title="教育背景" themeColor={themeColor} />
                    <Text className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                      {role.educationBackground}
                    </Text>
                  </>
                )}
                
                {role.workBackground && (
                  <>
                    <SectionTitle title="工作背景" themeColor={themeColor} />
                    <Text className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                      {role.workBackground}
                    </Text>
                  </>
                )}

                {!role.growthBackground && !role.educationBackground && !role.workBackground && (
                  <Text className="text-gray-500 dark:text-gray-400 text-center py-4">
                    暂无详细信息
                  </Text>
                )}
              </View>
            )}

            {activeTab === 'style' && (
              <View>
                {role.counselingStyle && (
                  <>
                    <SectionTitle title="咨询风格" themeColor={themeColor} />
                    <InfoRow label="核心理念" value={role.counselingStyle.approach} />
                    <InfoRow 
                      label="常用技术" 
                      value={role.counselingStyle.techniques.join('、')} 
                    />
                    <InfoRow 
                      label="性格特质" 
                      value={role.counselingStyle.personalityTraits.join('、')} 
                    />
                    <InfoRow 
                      label="语言风格" 
                      value={role.counselingStyle.languageStyle} 
                    />
                  </>
                )}

                {role.classicQuotes && role.classicQuotes.length > 0 && (
                  <>
                    <SectionTitle title="经典语录" themeColor={themeColor} />
                    {role.classicQuotes.map((quote: string, index: number) => (
                      <View 
                        key={index}
                        className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-2"
                      >
                        <Text className="text-gray-600 dark:text-gray-300 italic">
                          {`“${quote}”`}
                        </Text>
                      </View>
                    ))}
                  </>
                )}

                {!role.counselingStyle && (!role.classicQuotes || role.classicQuotes.length === 0) && (
                  <Text className="text-gray-500 dark:text-gray-400 text-center py-4">
                    暂无风格信息
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          {/* 开始对话按钮 */}
          <View className="px-6 pb-8 pt-4">
            <TouchableOpacity
              onPress={onStartChat}
              className="w-full py-4 rounded-2xl items-center"
              style={{ backgroundColor: themeColor }}
            >
              <Text className="text-white font-semibold text-base">
                开始对话
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Tab 按钮组件
function TabButton({
  title,
  active,
  onPress,
  themeColor,
}: {
  title: string;
  active: boolean;
  onPress: () => void;
  themeColor: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 py-3 items-center border-b-2"
      style={{
        borderBottomColor: active ? themeColor : 'transparent',
      }}
    >
      <Text
        className={`text-base font-medium ${
          active ? '' : 'text-gray-500 dark:text-gray-400'
        }`}
        style={{
          color: active ? themeColor : undefined,
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

// 分节标题组件
function SectionTitle({ title, themeColor }: { title: string; themeColor: string }) {
  return (
    <View className="flex-row items-center mb-2">
      <View
        className="w-1 h-5 rounded-full mr-2"
        style={{ backgroundColor: themeColor }}
      />
      <Text className="text-lg font-bold text-gray-900 dark:text-white">
        {title}
      </Text>
    </View>
  );
}

// 信息行组件
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="mb-3">
      <Text className="text-sm text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </Text>
      <Text className="text-gray-700 dark:text-gray-200">
        {value}
      </Text>
    </View>
  );
}
