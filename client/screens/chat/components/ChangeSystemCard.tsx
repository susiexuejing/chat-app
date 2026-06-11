import React from 'react';
import { View, Text } from 'react-native';

interface ChangeSystemData {
  currentState?: string;
  source?: string;
  deeperFeeling?: string;
  shift?: string;
  recoveryClue?: string;
  /** 原始字段，调试用 */
  flowType?: string | null;
  flowStage?: string | null;
  flowStrength?: number | null;
  flowConfidence?: number | null;
}

interface ChangeSystemCardProps {
  data?: ChangeSystemData | null;
}

export function ChangeSystemCard({ data }: ChangeSystemCardProps) {
  // 无数据或置信度 < 0.4 → 显示"还在理解中"
  const lowConfidence = data?.flowConfidence !== null && data?.flowConfidence !== undefined && data.flowConfidence < 0.4;
  const isEmpty = !data || !data.currentState || data.currentState === '还在理解中';

  const fields = isEmpty || lowConfidence
    ? [
        { label: '当前状态', value: '还在理解中' },
        { label: '变化方向', value: '尚不明确' },
      ]
    : [
        { label: '当前状态', value: data?.currentState },
        { label: '变化方向', value: data?.shift },
        { label: '置信度', value: data?.source || '--' },
      ].filter((f) => f.value && f.value.trim());

  return (
    <View className="mx-4 mb-3 bg-white dark:bg-gray-800 rounded-2xl px-4 py-3"
      style={{ shadowColor: '#EA580C', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2 }}
    >
      {/* 顶部图标行 */}
      <View className="flex-row items-center mb-2">
        <View className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 items-center justify-center mr-2">
          <Text className="text-amber-600 dark:text-amber-400 text-xs">⟳</Text>
        </View>
        <Text className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          状态变化
        </Text>
      </View>

      {/* 字段行 */}
      {fields.map((field) => (
        <View key={field.label} className="flex-row py-1">
          <Text className="text-xs text-gray-400 dark:text-gray-500 w-20 shrink-0">
            {field.label}
          </Text>
          <Text className="text-xs text-gray-700 dark:text-gray-300 flex-1 leading-4">
            {field.value}
          </Text>
        </View>
      ))}
    </View>
  );
}