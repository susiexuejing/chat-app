/** Shared text composer presentation. No live state, recording, permissions or I/O. */
import React from 'react';
import {
  View, TextInput, TouchableOpacity, Text, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import type { ChatSession } from '@/screens/chat/types';

export interface MultimodalInputViewProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void | Promise<void>;
  disabled?: boolean;
  phase?: ChatSession['chatPhase'];
  inputTestID?: string;
  sendTestID?: string;
  inputAccessibilityLabel?: string;
  sendAccessibilityLabel?: string;
}

export function MultimodalInputView({
  value, onChangeText, onSend, disabled, phase = 'idle',
  inputTestID, sendTestID, inputAccessibilityLabel, sendAccessibilityLabel,
}: MultimodalInputViewProps) {
  // Preserve the original behavior: typing stays available while sending is blocked.
  const isSendDisabled = disabled || !value.trim();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        
        {/* 输入框和按钮 */}
        <View className="flex-row items-end">
          {/* 输入框 */}
          <View className={`flex-1 rounded-2xl px-4 py-2 mr-2 ${
            disabled ? 'bg-gray-200 dark:bg-gray-700' : 'bg-gray-100 dark:bg-gray-800'
          }`}>
            <TextInput
              testID={inputTestID}
              accessibilityLabel={inputAccessibilityLabel}
              value={value}
              onChangeText={onChangeText}
              placeholder={phase === 'responding' ? '' : "把此刻最真实的一句话放在这里"}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={1000}
              style={styles.input}
              editable={true}
            />
          </View>

          {/* 发送按钮 */}
          <TouchableOpacity
            testID={sendTestID}
            accessibilityLabel={sendAccessibilityLabel}
            onPress={() => { if (!isSendDisabled) return onSend(); }}
            disabled={isSendDisabled}
            className={`w-10 h-10 items-center justify-center rounded-full ${
              !isSendDisabled
                ? 'bg-emerald-500'
                : 'bg-gray-300 dark:bg-gray-700'
            }`}
          >
            <FontAwesome6
              name="paper-plane"
              size={18}
              color="white"
            />
          </TouchableOpacity>
        </View>

        {/* 底部提示 — phase 活跃时状态条已显示，输入框只保持干净 */}
        <Text className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          {phase === 'done'
            ? '◎ 轮到你了'
            : phase !== 'idle'
              ? '　'
              : '直接说，不用整理语言'
          }
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    maxHeight: 100,
    minHeight: 24,
    color: '#374151',
  },
});

