/**
 * 多模态输入组件
 * 支持文本输入、语音输入、图片上传
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
  Image,
} from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';

interface MultimodalInputProps {
  onSendMessage: (text: string, options?: { imageUri?: string; audioUri?: string }) => void;
  disabled?: boolean;
}

export function MultimodalInput({ onSendMessage, disabled }: MultimodalInputProps) {
  const { inputText, setInputText } = useChat();
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
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
    if (!text && !selectedImage) return;

    onSendMessage(text, { imageUri: selectedImage || undefined });
    setInputText('');
    setSelectedImage(null);
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
        // 发送语音消息（目前使用语音URI，后续可实现语音转文字）
        onSendMessage('[语音消息]', { audioUri: uri });
      }
    } catch (error) {
      console.error('停止录音失败:', error);
      setIsRecording(false);
    }
  };

  // 图片选择
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请授予相册权限');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  // 拍照
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请授予相机权限');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  // 显示功能菜单
  const showAttachmentMenu = () => {
    Alert.alert(
      '添加附件',
      '选择附件类型',
      [
        { text: '相册', onPress: pickImage },
        { text: '拍照', onPress: takePhoto },
        { text: '取消', style: 'cancel' },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* 预览已选图片 */}
        {selectedImage && (
          <View className="mb-3 relative">
            <Image
              source={{ uri: selectedImage }}
              className="w-20 h-20 rounded-xl"
              resizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => setSelectedImage(null)}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full items-center justify-center"
            >
              <FontAwesome6 name="xmark" size={12} color="white" />
            </TouchableOpacity>
          </View>
        )}

        {/* 输入框和按钮 */}
        <View className="flex-row items-end">
          {/* 附加按钮 */}
          <TouchableOpacity
            onPress={showAttachmentMenu}
            disabled={disabled}
            className="w-10 h-10 items-center justify-center mr-2"
          >
            <FontAwesome6
              name="paperclip"
              size={20}
              color={disabled ? '#9CA3AF' : '#6B7280'}
            />
          </TouchableOpacity>

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
            disabled={disabled || (!inputText.trim() && !selectedImage)}
            className={`w-10 h-10 items-center justify-center rounded-full ${
              inputText.trim() || selectedImage
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
