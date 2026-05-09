/**
 * 深度分析卡片组件
 * 显示6个角色视角的深度分析结果
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

interface RoleAnalysis {
  analysis: string;
  insight: string;
}

interface DeepAnalysisCardProps {
  analysis: {
    [roleName: string]: RoleAnalysis;
  };
}

// 角色配置（颜色、图标）
const ROLE_CONFIG: Record<string, { color: string; icon: string; shortTitle: string }> = {
  '聪明狐狸': { color: '#FF6B35', icon: 'fox', shortTitle: '认知行为' },
  '温暖小熊': { color: '#FF8C42', icon: 'bear', shortTitle: '人本主义' },
  '深思猫头鹰': { color: '#6B5B95', icon: 'owl', shortTitle: '精神分析' },
  '情感小精灵': { color: '#F7CAC9', icon: 'sparkles', shortTitle: '情绪聚焦' },
  '哲思海豚': { color: '#4ECDC4', icon: 'water', shortTitle: '存在主义' },
  '团结小象': { color: '#95E1D3', icon: 'seedling', shortTitle: '家庭系统' },
};

export function DeepAnalysisCard({ analysis }: DeepAnalysisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const roles = Object.keys(analysis);
  const visibleRoles = expanded ? roles : roles.slice(0, 2);

  if (!analysis || Object.keys(analysis).length === 0) {
    return null;
  }

  return (
    <View className="px-4 mb-4">
      {/* 标题栏 */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl p-3"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <FontAwesome6 name="brain" size={16} color="white" />
            <Text className="text-white font-medium ml-2">深度心理分析</Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-white/80 text-xs mr-2">
              {roles.length} 个视角
            </Text>
            <FontAwesome6
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="white"
            />
          </View>
        </View>
      </TouchableOpacity>

      {/* 分析内容 */}
      {visibleRoles.map((roleName, index) => {
        const config = ROLE_CONFIG[roleName] || { color: '#8B5CF6', icon: 'user', shortTitle: '' };
        const roleData = analysis[roleName];

        return (
          <View
            key={roleName}
            className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mt-2"
            style={{ borderLeftWidth: 3, borderLeftColor: config.color }}
          >
            <View className="flex-row items-center mb-1">
              <Text className="font-semibold text-gray-900 dark:text-white">
                {roleName}
              </Text>
              <View
                className="ml-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: config.color + '20' }}
              >
                <Text
                  className="text-xs font-medium"
                  style={{ color: config.color }}
                >
                  {config.shortTitle}
                </Text>
              </View>
            </View>

            {roleData.analysis && (
              <Text className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                {roleData.analysis}
              </Text>
            )}

            {roleData.insight && (
              <View className="flex-row items-start bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                <FontAwesome6
                  name="lightbulb"
                  size={12}
                  color="#F59E0B"
                  style={{ marginTop: 2 }}
                />
                <Text className="text-xs text-amber-700 dark:text-amber-300 ml-2 flex-1">
                  {roleData.insight}
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {/* 展开/收起提示 */}
      {roles.length > 2 && (
        <TouchableOpacity
          onPress={() => setExpanded(!expanded)}
          className="items-center py-2"
        >
          <Text className="text-xs text-purple-600 dark:text-purple-400">
            {expanded ? '收起分析' : `展开全部 ${roles.length} 个视角`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
