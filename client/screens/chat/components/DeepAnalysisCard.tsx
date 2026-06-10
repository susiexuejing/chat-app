/**
 * 深度分析卡片组件 v2
 * 适配新版 analyze API 输出格式
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

interface DeepAnalysisData {
  fact?: string;
  interpretation?: string;
  possible_cognitive_pattern?: string | string[];
  reframe?: string;
}

interface DeepAnalysisCardProps {
  analysis: DeepAnalysisData;
}

export function DeepAnalysisCard({ analysis }: DeepAnalysisCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!analysis || Object.keys(analysis).length === 0) return null;

  const hasContent = analysis.fact || analysis.interpretation || analysis.reframe;

  return (
    <View className="px-4 mb-4">
      {/* 标题栏 */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl p-3"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <FontAwesome6 name="ear-listen" size={16} color="white" />
            <Text className="text-white font-medium ml-2">我听见的东西</Text>
          </View>
          <FontAwesome6
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="white"
          />
        </View>
      </TouchableOpacity>

      {/* 展开内容 */}
      {expanded && hasContent && (
        <View className="mt-2 bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
          {/* 发生了什么 */}
          {analysis.fact ? (
            <View className="mb-3">
              <View className="flex-row items-center mb-1">
                <FontAwesome6 name="eye" size={12} color="#6B7280" />
                <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-1.5 uppercase tracking-wide">
                  发生了什么
                </Text>
              </View>
              <Text className="text-sm text-gray-700 dark:text-gray-200 leading-5">
                {analysis.fact}
              </Text>
            </View>
          ) : null}

          {/* 解读方式 */}
          {analysis.interpretation ? (
            <View className="mb-3">
              <View className="flex-row items-center mb-1">
                <FontAwesome6 name="comment-dots" size={12} color="#6B7280" />
                <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-1.5 uppercase tracking-wide">
                  你心里怎么理解这件事
                </Text>
              </View>
              <Text className="text-sm text-gray-700 dark:text-gray-200 leading-5">
                {analysis.interpretation}
              </Text>
            </View>
          ) : null}

          {/* 认知模式 */}
          {analysis.possible_cognitive_pattern ? (
            <View className="mb-3">
              <View className="flex-row items-center mb-1">
                <FontAwesome6 name="brain" size={12} color="#6B7280" />
                <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-1.5 uppercase tracking-wide">
                  这里可能卡住的地方
                </Text>
              </View>
              {Array.isArray(analysis.possible_cognitive_pattern) ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {analysis.possible_cognitive_pattern.map((pattern, i) => (
                    <View key={i} className="bg-purple-100 dark:bg-purple-900/30 px-2 py-1 rounded-lg">
                      <Text className="text-xs text-purple-700 dark:text-purple-300">
                        {pattern}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-sm text-gray-700 dark:text-gray-200 leading-5">
                  {analysis.possible_cognitive_pattern}
                </Text>
              )}
            </View>
          ) : null}

          {/* 重新框架 */}
          {analysis.reframe ? (
            <View>
              <View className="flex-row items-center mb-1">
                <FontAwesome6 name="rotate" size={12} color="#059669" />
                <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 ml-1.5 uppercase tracking-wide">
                  可以先松动的一点
                </Text>
              </View>
              <Text className="text-sm text-gray-700 dark:text-gray-200 leading-5">
                {analysis.reframe}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 未展开时显示简短提示 */}
      {!expanded && hasContent && (
        <TouchableOpacity
          onPress={() => setExpanded(true)}
          className="mt-1 py-2"
        >
          <Text className="text-xs text-purple-500 text-center">
            点击展开
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}