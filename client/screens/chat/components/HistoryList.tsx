/**
 * 历史对话列表组件
 * 显示所有历史对话会话
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useChat } from '../contexts/ChatContext';
import { ChatSession } from '../types';
import { THERAPIST_ROLES } from '../constants/roles';

// 模块级别存储当前时间（只在模块首次加载时计算一次）
const INIT_TIME = Date.now();

interface HistoryListProps {
  onClose: () => void;
}

export function HistoryList({ onClose }: HistoryListProps) {
  const { sessions, currentSession, loadSession, deleteSession, createNewChat } = useChat();
  const insets = useSafeAreaInsets();

  const formatTime = (timestamp: number) => {
    const now = INIT_TIME;
    const diff = now - timestamp;
    const oneDay = 24 * 60 * 60 * 1000;
    
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < oneDay) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 7 * oneDay) return `${Math.floor(diff / oneDay)}天前`;
    
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const getRoleName = (roleId: string) => {
    const role = THERAPIST_ROLES.find(r => r.id === roleId);
    return role?.name || '未知咨询师';
  };

  const getRoleAvatar = (roleId: string) => {
    const role = THERAPIST_ROLES.find(r => r.id === roleId);
    return role?.avatar || '';
  };

  const getRoleColor = (roleId: string) => {
    const role = THERAPIST_ROLES.find(r => r.id === roleId);
    return role?.themeColor || '#10B981';
  };

  const handleDelete = (session: ChatSession) => {
    // 使用浏览器原生 confirm 对话框（Web 兼容）
    const confirmed = window.confirm('即将删除这个对话，对话删除后不能恢复，是否确认删除？');
    if (confirmed) {
      deleteSession(session.id);
    }
  };

  const renderItem = ({ item }: { item: ChatSession }) => {
    const isActive = currentSession?.id === item.id;
    
    return (
      <TouchableOpacity
        onPress={() => loadSession(item)}
        onLongPress={() => handleDelete(item)}
        className={`flex-row items-center p-4 rounded-xl mb-2 ${
          isActive
            ? 'bg-emerald-50 dark:bg-emerald-900/20'
            : 'bg-gray-50 dark:bg-gray-800/50'
        }`}
        style={{
          borderLeftWidth: 3,
          borderLeftColor: getRoleColor(item.roleId),
        }}
      >
        {/* 角色头像 */}
        <Image
          source={{ uri: getRoleAvatar(item.roleId) }}
          className="w-10 h-10 rounded-full"
        />
        
        {/* 对话信息 */}
        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between">
            <Text
              className="text-sm font-medium text-gray-900 dark:text-white"
              numberOfLines={1}
            >
              {item.title || getRoleName(item.roleId)}
            </Text>
            <Text className="text-xs text-gray-400">
              {formatTime(item.updatedAt)}
            </Text>
          </View>
          <View className="flex-row items-center mt-1">
            <Text
              className="text-xs text-gray-500 dark:text-gray-400"
              numberOfLines={1}
            >
              {getRoleName(item.roleId)} · {item.messages.length}条消息
            </Text>
          </View>
        </View>
        
        {/* 删除按钮 */}
        <TouchableOpacity
          onPress={() => handleDelete(item)}
          className="p-2 ml-1"
        >
          <FontAwesome6 name="trash" size={14} color="#9CA3AF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View
      className="flex-1 bg-white dark:bg-gray-900"
      style={{ paddingTop: insets.top }}
    >
      {/* 头部 */}
      <View className="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900 dark:text-white">
            历史对话
          </Text>
          <TouchableOpacity onPress={onClose} className="p-2">
            <FontAwesome6 name="xmark" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 新建对话按钮 */}
      <View className="px-4 py-3">
        <TouchableOpacity
          onPress={createNewChat}
          className="flex-row items-center justify-center p-4 rounded-2xl"
          style={{ backgroundColor: '#10B981' }}
        >
          <FontAwesome6 name="plus" size={18} color="white" />
          <Text className="ml-2 text-white font-semibold">新建对话</Text>
        </TouchableOpacity>
      </View>

      {/* 对话列表 */}
      <FlatList
        data={sessions}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <FontAwesome6 name="comments" size={48} color="#E5E7EB" />
            <Text className="text-gray-400 mt-4 text-center">
              暂无历史对话{'\n'}点击上方开始新对话
            </Text>
          </View>
        }
      />
    </View>
  );
}
