import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnalysisResult } from '../utils/textAnalyzer';
import { useChat } from '../contexts/ChatContext';

interface LightAnalysisCardProps {
  analysis: AnalysisResult;
  onOptionSelect?: (option: string) => void;
}

export function LightAnalysisCard({ analysis, onOptionSelect }: LightAnalysisCardProps) {
  const { setInputText, inputText } = useChat();
  
  const handleOptionPress = (option: string) => {
    if (onOptionSelect) {
      onOptionSelect(option);
    } else {
      // 默认行为：添加到输入框
      setInputText(inputText + (inputText ? ' ' : '') + option);
    }
  };
  
  return (
    <View style={styles.container}>
      {/* 情绪标签 */}
      {analysis.emotions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.emotionBadge}>
            <Ionicons name="heart" size={14} color="#F43F5E" />
            <Text style={styles.emotionText}>
              感受到你可能在经历 {analysis.emotions.join('、')} 的情绪
            </Text>
          </View>
        </View>
      )}
      
      {/* 关键事件 */}
      {analysis.keyEvent && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            <Ionicons name="key-outline" size={12} color="#6366F1" />
            {' '}关键事件
          </Text>
          <Text style={styles.eventText}>&ldquo;{analysis.keyEvent}&rdquo;</Text>
        </View>
      )}
      
      {/* 互动选项 */}
      {analysis.interactionOptions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>你想深入探讨：</Text>
          <View style={styles.optionsContainer}>
            {analysis.interactionOptions.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={styles.optionButton}
                onPress={() => handleOptionPress(option.value)}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      
      {/* 分析完成提示 */}
      <View style={styles.footer}>
        <Ionicons name="sparkles" size={14} color="#8B5CF6" />
        <Text style={styles.footerText}>正在为你生成回复...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F0F9FF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  section: {
    marginBottom: 12,
  },
  emotionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  emotionText: {
    fontSize: 14,
    color: '#991B1B',
    marginLeft: 6,
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 6,
    fontWeight: '600',
  },
  eventText: {
    fontSize: 14,
    color: '#334155',
    fontStyle: 'italic',
  },
  optionsContainer: {
    gap: 8,
  },
  optionButton: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  optionText: {
    fontSize: 13,
    color: '#5B21B6',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0F2FE',
  },
  footerText: {
    fontSize: 12,
    color: '#8B5CF6',
    marginLeft: 6,
  },
});
