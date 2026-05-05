import { FlatList, View, Text, TouchableOpacity, Image } from 'react-native';
import { useChat } from '../contexts/ChatContext';
import { Screen } from '@/components/Screen';
import { MessageBubble } from './MessageBubble';
import { LightAnalysisCard } from './LightAnalysisCard';
import { RoleHeader } from './RoleHeader';
import { HistoryList } from './HistoryList';
import { PsychologistRole } from '../constants/roles';

interface MessageListProps {
  onSelectRole?: () => void;
}

export default function MessageList({ onSelectRole }: MessageListProps) {
  const {
    messages,
    currentRole,
    lightAnalysis,
    showHistory,
    setShowHistory,
    isLoading,
    isThinking,
    error,
    createNewChat,
    sendMessage,
    clearError,
  } = useChat();

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

  // 检查百炼回复是否开始（当有 assistant 消息且有内容时）
  const aiReplyStarted = lastMsg?.role === 'assistant' && lastMsg?.content && lastMsg.content.length > 0;

  // 只有在有轻量分析结果且 AI 回复还没开始时才显示分析卡片
  const shouldShowAnalysis = lightAnalysis && !aiReplyStarted;

  const handleStartChat = () => {
    if (onSelectRole) {
      onSelectRole();
    }
  };

  // 欢迎消息
  if (messages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        {/* AI 头像 */}
        <Image
          source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentRole?.id || 'default'}` }}
          className="w-20 h-20 rounded-full mb-6"
        />
        
        {/* 欢迎语 */}
        <Text className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-2">
          嗨，我是 {currentRole?.name || '咨询师'}
        </Text>
        
        <Text className="text-base text-gray-500 dark:text-gray-400 text-center mb-8">
          {currentRole?.briefIntro || '倾诉你的心事，我来陪伴你'}
        </Text>
        
        {/* 开始按钮 */}
        <TouchableOpacity
          className="bg-indigo-500 px-8 py-3 rounded-full"
          onPress={handleStartChat}
        >
          <Text className="text-white font-medium">开始对话</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={messages}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item }) => (
          <MessageBubble message={item} />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 128 }}
        inverted={false}
      />
      
      {/* 轻量分析卡片 - 显示在消息列表下方 */}
      {shouldShowAnalysis && (
        <View className="absolute bottom-28 left-2 right-2">
          <LightAnalysisCard 
            analysis={lightAnalysis} 
            onOptionSelect={(response: string) => {
              // 用户点击选项后，发送该选项作为新消息
              sendMessage(response);
            }}
          />
        </View>
      )}
    </>
  );
}
