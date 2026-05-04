/**
 * 文本输入组件
 * 支持文本输入
 */

import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

interface MultimodalInputProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

export function MultimodalInput({ onSendMessage, disabled }: MultimodalInputProps) {
  const [text, setText] = useState('');

  const handleSend = () => {
    const trimmedText = text.trim();
    if (trimmedText && !disabled) {
      onSendMessage(trimmedText);
      setText('');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.container}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="输入消息..."
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={2000}
            editable={!disabled}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!text.trim() || disabled) && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!text.trim() || disabled}
          >
            <FontAwesome6 name="paper-plane" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    paddingVertical: 4,
    paddingHorizontal: 0,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
});
