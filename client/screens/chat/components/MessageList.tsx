/** Live-context adapter for the original message list. */
import React from 'react';
import { useChat } from '@/screens/chat/contexts/ChatContext';
import { MessageListView } from '@/screens/chat/components/MessageListView';

interface MessageListProps {
  onShowIntro: () => void;
}

export function MessageList({ onShowIntro }: MessageListProps) {
  const { messages, currentRole, setInputText, turnStatus, retryLastMessage } = useChat();
  return (
    <MessageListView
      messages={messages}
      currentRole={currentRole}
      setInputText={setInputText}
      turnStatus={turnStatus}
      retryLastMessage={retryLastMessage}
      onShowIntro={onShowIntro}
    />
  );
}
