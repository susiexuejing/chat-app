/**
 * 文本输入组件
 * 支持文本输入、语音输入（Web 和 Native）
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

// 检测是否为 Web 环境
const isWeb = Platform.OS === 'web';

export function MultimodalInput({ onSendMessage, disabled }: MultimodalInputProps) {
  const { inputText, setInputText } = useChat();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const webRecognitionRef = useRef<any>(null);

  // 请求录音权限 (仅 Native)
  useEffect(() => {
    if (!isWeb) {
      (async () => {
        const { status } = await Audio.requestPermissionsAsync();
        setHasPermission(status === 'granted');
      })();
    }
  }, []);

  // Web 语音识别
  const startWebRecognition = () => {
    if (!isWeb || !window.webkitSpeechRecognition && !window.SpeechRecognition) {
      Alert.alert('不支持', '您的浏览器不支持语音识别功能');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && transcript.trim()) {
        setInputText(transcript.trim());
      } else {
        Alert.alert('提示', '未能识别到语音内容，请重试');
      }
      setIsRecording(false);
    };

    recognition.onerror = (event: any) => {
      console.error('语音识别错误:', event.error);
      setIsRecording(false);
      if (event.error !== 'no-speech') {
        Alert.alert('识别失败', '语音识别失败，请重试');
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    webRecognitionRef.current = recognition;
    recognition.start();
  };

  const stopWebRecognition = () => {
    if (webRecognitionRef.current) {
      webRecognitionRef.current.stop();
      webRecognitionRef.current = null;
    }
    setIsRecording(false);
  };

  // Native 录音
  const startNativeRecording = async () => {
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

  const stopNativeRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        setIsTranscribing(true);
        
        try {
          const text = await speechToText(uri);
          
          if (text && text.trim()) {
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

  // 统一开始录音
  const handleStartRecording = () => {
    if (isWeb) {
      startWebRecognition();
    } else {
      startNativeRecording();
    }
  };

  // 统一停止录音
  const handleStopRecording = () => {
    if (isWeb) {
      stopWebRecognition();
    } else {
      stopNativeRecording();
    }
  };

  // 处理文本发送
  const handleSend = () => {
    if (disabled) return;
    
    const text = inputText.trim();
    if (!text) return;

    onSendMessage(text);
    setInputText('');
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
            onPressIn={handleStartRecording}
            onPressOut={handleStopRecording}
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
