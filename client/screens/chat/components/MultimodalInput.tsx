/**
 * 文本输入组件
 * 支持文本输入、语音输入
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Text,
} from 'react-native';
import { Audio } from 'expo-av';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';
import { speechToText } from '../api/cozeApi';

interface MultimodalInputProps {
  onSendMessage: (text: string, options?: { audioUri?: string }) => void;
  disabled?: boolean;
}

export function MultimodalInput({ onSendMessage, disabled }: MultimodalInputProps) {
  const { inputText, setInputText } = useChat();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  // 请求录音权限
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // 处理文本发送
  const handleSend = () => {
    if (disabled) return;
    
    const text = inputText.trim();
    if (!text) return;

    onSendMessage(text);
    setInputText('');
  };

  // 语音输入
  const startRecording = async () => {
    if (!hasPermission) {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要权限', '请授予录音权限');
        return;
      }
      setHasPermission(true);
    }

    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (error) {
      console.error('录音失败:', error);
      Alert.alert('错误', '录音启动失败');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        setIsTranscribing(true);
        
        try {
          // 调用语音转文字 API
          const text = await speechToText(uri);
          
          if (text && text.trim()) {
            // 将识别文字填充到输入框
            setInputText(text.trim());
          } else {
            Alert.alert('提示', '未能识别到语音内容，请重试');
          }
        } catch (error) {
          console.error('语音转文字失败:', error);
          Alert.alert('识别失败', '语音转文字失败，请重试');
        } finally {
          setIsTranscribing(false);
        }
      }
    } catch (error) {
      console.error('停止录音失败:', error);
      setIsRecording(false);
      setIsTranscribing(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* 输入框和按钮 */}
        <View className="flex-row items-end">
          {/* 语音按钮 */}
          <TouchableOpacity
            onPressIn={startRecording}
            onPressOut={stopRecording}
            disabled={disabled || isTranscribing}
            className={`w-10 h-10 items-center justify-center mr-2 rounded-full ${
              isRecording ? 'bg-red-500' : ''
            }`}
          >
            {isTranscribing ? (
              <ActivityIndicator size="small" color="#6B7280" />
            ) : (
              <FontAwesome6
                name="microphone"
                size={20}
                color={isRecording ? 'white' : (disabled ? '#9CA3AF' : '#6B7280')}
              />
            )}
          </TouchableOpacity>

          {/* 输入框 */}
          <View className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-2 mr-2">
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="输入你的问题..."
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={1000}
              style={styles.input}
              editable={!disabled}
            />
          </View>

          {/* 发送按钮 */}
          <TouchableOpacity
            onPress={handleSend}
            disabled={disabled || !inputText.trim()}
            className={`w-10 h-10 items-center justify-center rounded-full ${
              inputText.trim()
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
