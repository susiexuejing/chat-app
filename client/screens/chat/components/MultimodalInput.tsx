/**
 * 文本输入组件 v2
 * 支持情绪标签、补充信息、有意义的等待提示
 */

import React, { useState, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import { MultimodalInputView } from '@/screens/chat/components/MultimodalInputView';
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
  onSendMessage: (text: string, options?: { audioUri?: string; emotion?: string }) => Promise<boolean>;
  disabled?: boolean;
  isThinking?: boolean;
}

export function MultimodalInput({ onSendMessage, disabled: propDisabled, isThinking }: MultimodalInputProps) {
  const { inputText, setInputText, chatPhase } = useChat();
  // ── 核心设计：打字永远可打，只控制发送按钮 ──
  // editable=true 始终开放，用户永远可以输入文字
  // 唯一不能发送的情况：正在处理中(propDisabled=true) 或 没有输入文字
  const isSendDisabled = propDisabled || !inputText.trim();
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
    if (propDisabled) return;
    
    if (selectedEmotion === emotionId) {
      setSelectedEmotion(null);
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
  const handleSend = async () => {
    if (isSendDisabled) return;
    
    const text = inputText.trim();
    if (!text) return;

    // EM-53: 根据 sendMessage 返回值决定是否清空输入框
    const sent = await onSendMessage(text, { emotion: selectedEmotion || undefined });
    
    if (sent) {
      // 消息已成功发送，清空输入框
      setInputText('');
      setSelectedEmotion(null);
      setSupplementText('');
    } else {
      // 消息被排队，保留输入框内容，用户可以继续输入或修改
      console.log('[EM-53] Message queued, keeping input text');
    }
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
    <MultimodalInputView
      value={inputText}
      onChangeText={setInputText}
      onSend={handleSend}
      disabled={propDisabled}
      phase={chatPhase}
    />
  );
}
