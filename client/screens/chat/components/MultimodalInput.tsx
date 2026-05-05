/**
 * 文本输入组件 v2
 * 支持情绪标签、补充信息、有意义的等待提示
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Audio } from 'expo-av';
import { FontAwesome6 } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

// 情绪标签选项
const EMOTION_TAGS = [
  { id: 'anxious', label: '焦虑', icon: 'cloudy-outline' },
  { id: 'sad', label: '难过', icon: 'water-outline' },
  { id: 'angry', label: '愤怒', icon: 'flame-outline' },
  { id: 'confused', label: '迷茫', icon: 'help-circle-outline' },
  { id: 'lonely', label: '孤独', icon: 'person-outline' },
  { id: 'tired', label: '疲惫', icon: 'moon-outline' },
];

// 有意义的等待提示
const THINKING_TIPS = [
  '正在感受你的情绪...',
  '理解中...',
  '共情中...',
  '思考中...',
  '分析中...',
];

interface MultimodalInputProps {
  onSendMessage: (text: string, options?: { audioUri?: string; emotion?: string }) => void;
  disabled?: boolean;
  isThinking?: boolean;
}

export function MultimodalInput({ onSendMessage, disabled, isThinking }: MultimodalInputProps) {
  const { inputText, setInputText } = useChat();
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [selectedEmotion, setSelectedEmotion] = useState<string | null>(null);
  const [showSupplement, setShowSupplement] = useState(false);
  const [supplementText, setSupplementText] = useState('');
  const [tipIndex, setTipIndex] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const tipIndexRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  // 轮换等待提示
  useEffect(() => {
    if (!isThinking) {
      tipIndexRef.current = 0;
      startTimeRef.current = null;
      // 使用 requestAnimationFrame 或 setTimeout 延迟更新 state
      setTimeout(() => setTipIndex(0), 0);
      return;
    }
    
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current || Date.now());
      const newIndex = Math.floor(elapsed / 2000) % THINKING_TIPS.length;
      if (newIndex !== tipIndexRef.current) {
        tipIndexRef.current = newIndex;
        setTipIndex(newIndex);
      }
    }, 500);
    
    return () => clearInterval(interval);
  }, [isThinking]);

  // 请求录音权限
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // 处理情绪标签点击
  const handleEmotionSelect = (emotionId: string) => {
    if (disabled) return;
    
    if (selectedEmotion === emotionId) {
      setSelectedEmotion(null);
    } else {
      setSelectedEmotion(emotionId);
      // 自动添加到输入框
      const emotionTag = EMOTION_TAGS.find(e => e.id === emotionId);
      if (emotionTag && !inputText.includes(emotionTag.label)) {
        const newText = inputText + (inputText ? ' ' : '') + `我感到${emotionTag.label}，`;
        setInputText(newText);
      }
    }
  };

  // 处理补充信息
  const handleSupplement = () => {
    if (supplementText.trim()) {
      const newText = inputText + (inputText ? ' ' : '') + supplementText;
      setInputText(newText);
      setSupplementText('');
      setShowSupplement(false);
    }
  };

  // 处理文本发送
  const handleSend = () => {
    if (disabled) return;
    
    const text = inputText.trim();
    if (!text) return;

    onSendMessage(text, { emotion: selectedEmotion || undefined });
    setInputText('');
    setSelectedEmotion(null);
    setSupplementText('');
  };

  // 语音输入
  const startRecording = async () => {
    if (!hasPermission) {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
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
        onSendMessage('[语音消息]', { audioUri: uri });
      }
    } catch (error) {
      console.error('停止录音失败:', error);
      setIsRecording(false);
    }
  };

  // 获取当前等待提示
  const getThinkingTip = () => {
    return THINKING_TIPS[tipIndex];
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        
        {/* 情绪标签 - 等待时显示提示，非等待时可交互 */}
        {!disabled && (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {isThinking ? getThinkingTip() : '选择你的情绪（可选）'}
            </Text>
            <View className="flex-row">
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                className="flex-row gap-2"
              >
              {EMOTION_TAGS.map((emotion) => (
                <TouchableOpacity
                  key={emotion.id}
                  onPress={() => handleEmotionSelect(emotion.id)}
                  disabled={isThinking}
                  className={`flex-row items-center px-3 py-1.5 rounded-full ${
                    selectedEmotion === emotion.id
                      ? 'bg-emerald-100 dark:bg-emerald-900 border border-emerald-500'
                      : 'bg-gray-100 dark:bg-gray-800'
                  } ${isThinking ? 'opacity-50' : ''}`}
                >
                  <Ionicons 
                    name={emotion.icon as any} 
                    size={14} 
                    className="mr-1 text-gray-500 dark:text-gray-400" 
                  />
                  <Text className={`text-sm ${
                    selectedEmotion === emotion.id
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    {emotion.label}
                  </Text>
                </TouchableOpacity>
              ))}
              </ScrollView>
            </View>
          </View>
        )}

        {/* 等待提示 */}
        {isThinking && (
          <View className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <View className="flex-row items-center">
              <Ionicons name="bulb-outline" size={16} color="#D97706" className="mr-2" />
              <Text className="text-sm text-amber-700 dark:text-amber-300 flex-1">
                {getThinkingTip()}
              </Text>
              <View className="flex-row gap-1">
                <View className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <View className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <View className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </View>
            </View>
          </View>
        )}

        {/* 补充信息区域 */}
        {showSupplement && !disabled && (
          <View className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                补充更多信息
              </Text>
              <TouchableOpacity onPress={() => setShowSupplement(false)}>
                <Ionicons name="close-circle" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TextInput
              value={supplementText}
              onChangeText={setSupplementText}
              placeholder="例如：具体发生了什么？持续多久了？"
              placeholderTextColor="#9CA3AF"
              multiline
              className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm"
              style={{ maxHeight: 80 }}
            />
            <TouchableOpacity
              onPress={handleSupplement}
              disabled={!supplementText.trim()}
              className={`mt-2 px-3 py-1.5 rounded-lg self-end ${
                supplementText.trim()
                  ? 'bg-blue-500'
                  : 'bg-gray-300 dark:bg-gray-700'
              }`}
            >
              <Text className="text-white text-sm font-medium">添加到问题</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 输入框和按钮 */}
        <View className="flex-row items-end">
          {/* 语音按钮 */}
          <TouchableOpacity
            onPressIn={startRecording}
            onPressOut={stopRecording}
            disabled={disabled}
            className={`w-10 h-10 items-center justify-center mr-2 rounded-full ${
              isRecording ? 'bg-red-500' : ''
            }`}
          >
            <FontAwesome6
              name="microphone"
              size={20}
              color={isRecording ? 'white' : (disabled ? '#9CA3AF' : '#6B7280')}
            />
          </TouchableOpacity>

          {/* 补充信息按钮 */}
          {!disabled && !showSupplement && (
            <TouchableOpacity
              onPress={() => setShowSupplement(true)}
              className="w-10 h-10 items-center justify-center mr-2 rounded-full"
            >
              <Ionicons
                name="add-circle-outline"
                size={24}
                color="#6B7280"
              />
            </TouchableOpacity>
          )}

          {/* 输入框 */}
          <View className={`flex-1 rounded-2xl px-4 py-2 mr-2 ${
            disabled ? 'bg-gray-200 dark:bg-gray-700' : 'bg-gray-100 dark:bg-gray-800'
          }`}>
            <TextInput
              value={disabled ? getThinkingTip() : inputText}
              onChangeText={disabled ? undefined : setInputText}
              placeholder={disabled ? '' : "输入你的问题..."}
              placeholderTextColor={disabled ? 'transparent' : "#9CA3AF"}
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
              inputText.trim() && !disabled
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

        {/* 底部提示 */}
        {!disabled && (
          <Text className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
            {isThinking 
              ? '我可以等待，您可以继续补充...'
              : '选择一个情绪标签或直接输入您的问题'
            }
          </Text>
        )}
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
