import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { roles, type PsychologistRole } from '@/screens/chat/constants/roles';

interface RolePickerModalProps {
  visible: boolean;
  onSelect: (role: PsychologistRole) => void;
  onClose: () => void;
}

const ROLE_INITIALS: Record<string, string> = {
  'clever-fox': '狐',
  'warm-bear': '熊',
  'wise-owl': '猫',
  'emotion-elf': '精',
  'philosophical-dolphin': '海',
  'family-elephant': '象',
};

const ROLE_SUITABLE: Record<string, string> = {
  'clever-fox': '想理清、想行动、脑子很乱',
  'warm-bear': '很累、很委屈、需要被接住',
  'wise-owl': '反复卡住、想看清模式',
  'emotion-elf': '麻木、空、感受不到自己',
  'philosophical-dolphin': '迷茫、意义感下降、人生困惑',
  'family-elephant': '关系冲突、孤独、缺少支持',
};

const ROLE_BRIEF: Record<string, string> = {
  'clever-fox': '帮你把卡住的念头拆开一点',
  'warm-bear': '先陪你安稳下来，不急着解决',
  'wise-owl': '陪你看见事情背后的深层结构',
  'emotion-elf': '陪你慢慢找回真实感受',
  'philosophical-dolphin': '陪你重新看见方向和意义',
  'family-elephant': '陪你重新连接人和关系',
};

export function RolePickerModal({ visible, onSelect, onClose }: RolePickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        className="flex-1 bg-black/40 justify-end"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="bg-white dark:bg-gray-900 rounded-t-3xl max-h-[80%]">
              {/* 标题 */}
              <View className="px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
                <Text className="text-lg font-bold text-gray-900 dark:text-white text-center">
                  切换陪伴方式
                </Text>
                <Text className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
                  如果当前方式不适合你，可以换一种陪伴方式。
                </Text>
              </View>

              {/* 列表 */}
              <ScrollView className="px-4 py-3" showsVerticalScrollIndicator={false}>
                {roles.map((role) => (
                  <TouchableOpacity
                    key={role.id}
                    onPress={() => onSelect(role)}
                    className="flex-row items-center py-3.5 border-b border-gray-50 dark:border-gray-800"
                  >
                    {/* 头像 */}
                    <View className="w-12 h-12 rounded-full items-center justify-center mr-3 overflow-hidden">
                      <View className="absolute inset-0 opacity-20" style={{ backgroundColor: role.themeColor }} />
                      <Text className="text-lg font-bold" style={{ color: role.themeColor }}>
                        {ROLE_INITIALS[role.id] || role.name[0]}
                    </Text>
                    </View>

                    {/* 内容 */}
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-gray-900 dark:text-white">
                        {role.name}
                      </Text>
                      <Text className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        适合：{ROLE_SUITABLE[role.id] || ''}
                      </Text>
                      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-4">
                        {ROLE_BRIEF[role.id] || role.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* 底部 */}
              <View className="px-5 py-4">
                <TouchableOpacity
                  onPress={onClose}
                  className="bg-gray-100 dark:bg-gray-800 rounded-xl py-3 items-center"
                >
                  <Text className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    取消
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}