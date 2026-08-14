import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { MessageList } from '../components/MessageList';
import type { ChatMessage } from '../types';

const mockedUseChat = jest.fn();

jest.mock('../contexts/ChatContext', () => ({
  useChat: () => mockedUseChat(),
}));

jest.mock('../components/MessageBubble', () => ({
  MessageBubble: ({ message }: { message: ChatMessage }) => (
    <Text testID={`message-${message.id}`}>{message.content}</Text>
  ),
}));

jest.mock('../components/DeepAnalysisCard', () => ({
  DeepAnalysisCard: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: () => null,
}));

describe('EF-104 MessageList layer rendering', () => {
  it('renders user, Reaction, Companion, and Deep as four independent entities', async () => {
    const turnId = 'turn-render';
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'User', timestamp: 1, turnId },
      {
        id: 'reaction-1', role: 'assistant', content: 'Reaction', timestamp: 2,
        turnId, responseLayer: 'reaction',
      },
      {
        id: 'companion-1', role: 'assistant', content: 'Companion', timestamp: 3,
        turnId, responseLayer: 'companion',
      },
      {
        id: 'deep-1', role: 'assistant', content: 'Deep', timestamp: 4,
        turnId, responseLayer: 'deep',
      },
    ];
    mockedUseChat.mockReturnValue({
      messages,
      currentRole: { avatar: '', name: 'Role', themeColor: '#000000' },
      setInputText: jest.fn(),
      turnStatus: 'completed',
      retryLastMessage: jest.fn(),
    });

    const view = await render(<MessageList onShowIntro={jest.fn()} />);

    for (const message of messages) {
      expect(view.getByTestId(`message-${message.id}`)).toBeTruthy();
    }
    expect(view.getAllByText(/User|Reaction|Companion|Deep/)).toHaveLength(4);
  });
});
