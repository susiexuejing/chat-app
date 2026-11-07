/** Live-context adapter for the original message bubble. */
import React, { memo } from 'react';
import type { ChatMessage } from '@/screens/chat/types';
import { useChat } from '@/screens/chat/contexts/ChatContext';
import { MessageBubbleView } from '@/screens/chat/components/MessageBubbleView';

interface MessageBubbleProps {
  message: ChatMessage;
  thinking?: string;
}

function MessageBubbleComponent({ message, thinking }: MessageBubbleProps) {
  const { currentRole } = useChat();
  return <MessageBubbleView message={message} thinking={thinking} assistantAvatar={currentRole?.avatar} />;
}

export const MessageBubble = memo(MessageBubbleComponent);
