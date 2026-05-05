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
import { DEFAULT_ROLES } from '../constants/roles';

// 模块级别存储当前时间（只在模块首次加载时计算一次）
const INIT_TIME = Date.now();

interface HistoryListProps {
  onClose: () => void;
}

export function HistoryList({ onClose }: HistoryListProps) {
  const { sessions, currentSession, loadSession, deleteSession } = useChat();
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
    const role = DEFAULT_ROLES.find(r => r.id === roleId);
    return role?.name || '未知咨询师';
  };

  const getRoleAvatar = (roleId: string) => {
    const role = DEFAULT_ROLES.find(r => r.id === roleId);
    return role?.avatar || '';
  };

  const getRoleColor = (roleId: string) => {
    const role = DEFAULT_ROLES.find(r => r.id === roleId);
    return role?.themeColor || '#10B981';
  };

  const handleDelete = (session: ChatSession) => {
    Alert.alert(
      '删除对话',
      '即将删除这个对话，对话删除后不能恢复，是否确认删除？',
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => deleteSession(session.id) },
      ]
    );
  };

  const renderItem = ({ item }: { item: ChatSession }) => {
    const isActive = currentSession?.id === item.id;
    
    return (
      <TouchableOpacity
        onPress={() => {
          loadSession(item.id);
          onClose();
        }}
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
          source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.roleId}` }}
          className="w-10 h-10 rounded-full"
        />
        
        {/* 对话信息 */}
        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between">
            <Text
              className="text-sm font-medium text-gray-900 dark:text-white"
              numberOfLines={1}
            >
              {getRoleName(item.roleId)}
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
              {item.messages.length > 0 ? `${item.messages.length}条消息` : '新对话'}
            </Text>
          </View>
        </View>
        
        {/* 删除按钮 */}
        <TouchableOpacity
          onPress={() => handleDelete(item)}
          className="p-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <FontAwesome6 name="trash" size={14} color="#9CA3AF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (sessions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-12">
        <FontAwesome6 name="comments" size={48} color="#D1D5DB" />
        <Text className="text-gray-400 mt-4 text-center">
          还没有历史对话
        </Text>
        <Text className="text-gray-400 text-sm text-center mt-1">
          选择一位咨询师开始对话吧
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
      {/* 标题 */}
      <View className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">
          历史对话 ({sessions.length})
        </Text>
      </View>
      
      {/* 对话列表 */}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
      />
    </View>
  );
}
