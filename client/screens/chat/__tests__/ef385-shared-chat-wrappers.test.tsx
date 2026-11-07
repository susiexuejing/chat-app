import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { MessageBubble } from '../components/MessageBubble';
import { MessageList } from '../components/MessageList';
import { MultimodalInput } from '../components/MultimodalInput';

// Exercise the original adapters with mocked context, presentation, and Audio.
// No real provider, network, storage, or microphone module is mounted here.
const mockSetInputText = jest.fn();
const mockRetry = jest.fn();
const mockRequestPermissions = jest.fn();
let mockContext: {
  currentRole: { name: string; avatar: string; themeColor: string };
  messages: any[];
  inputText: string;
  chatPhase: string;
  turnStatus: string;
  setInputText: jest.Mock;
  retryLastMessage: jest.Mock;
};
jest.mock('../contexts/ChatContext', () => ({ useChat: () => mockContext }));
jest.mock('expo-av', () => ({ Audio: { requestPermissionsAsync: () => mockRequestPermissions() } }));
jest.mock('../components/MessageBubbleView', () => ({
  MessageBubbleView: (props: any) => require('react').createElement('MessageBubbleView', props),
}));
jest.mock('../components/MessageListView', () => ({
  MessageListView: (props: any) => require('react').createElement('MessageListView', props),
}));
jest.mock('../components/MultimodalInputView', () => ({
  MultimodalInputView: (props: any) => require('react').createElement('MultimodalInputView', props),
}));

describe('EF-385 legacy wrappers retain live behavior', () => {
  let tree: ReactTestRenderer | undefined;
  let oldAct: unknown;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockContext = {
      currentRole: { name: '原有角色', avatar: 'https://example.invalid/live-avatar.png', themeColor: '#10B981' },
      messages: [{ id: 'user', role: 'user', content: '虚构输入', timestamp: 1767225600000 }],
      inputText: '  虚构输入  ', chatPhase: 'responding', turnStatus: 'generating',
      setInputText: mockSetInputText, retryLastMessage: mockRetry,
    };
  });
  afterEach(async () => {
    if (tree) await act(async () => { tree!.unmount(); });
    tree = undefined;
    jest.clearAllTimers();
    jest.useRealTimers();
    logSpy.mockRestore();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  async function render(element: React.ReactElement) {
    await act(async () => {
      if (tree) tree.update(element);
      else tree = renderer.create(element);
    });
  }
  function view(name: string) {
    return tree!.root.find(node => typeof node.type === 'string' && node.type === name);
  }

  it('passes the live role avatar and thinking text to the shared bubble', async () => {
    const message = mockContext.messages[0];
    await render(<MessageBubble message={message} thinking="思考片段" />);
    expect(view('MessageBubbleView').props).toMatchObject({ message, thinking: '思考片段', assistantAvatar: mockContext.currentRole.avatar });
  });

  it('passes live messages, role, starter, generation and retry callbacks unchanged', async () => {
    const onShowIntro = jest.fn();
    await render(<MessageList onShowIntro={onShowIntro} />);
    expect(view('MessageListView').props).toEqual({
      messages: mockContext.messages, currentRole: mockContext.currentRole,
      setInputText: mockSetInputText, turnStatus: 'generating', retryLastMessage: mockRetry, onShowIntro,
    });
  });

  it('keeps the old permission effect on the live wrapper and clears accepted trimmed text only after success', async () => {
    let finish!: (sent: boolean) => void;
    const onSendMessage = jest.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await render(<MultimodalInput onSendMessage={onSendMessage} />);
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(view('MultimodalInputView').props).toMatchObject({ value: mockContext.inputText, onChangeText: mockSetInputText, phase: 'responding' });
    let pending!: Promise<void>;
    await act(async () => { pending = view('MultimodalInputView').props.onSend(); });
    expect(onSendMessage).toHaveBeenCalledWith('虚构输入', { emotion: undefined });
    expect(mockSetInputText).not.toHaveBeenCalled();
    await act(async () => { finish(true); await pending; });
    expect(mockSetInputText).toHaveBeenCalledWith('');
  });

  it('preserves queued input when the existing send callback returns false', async () => {
    const onSendMessage = jest.fn(async () => false);
    await render(<MultimodalInput onSendMessage={onSendMessage} />);
    await act(async () => { await view('MultimodalInputView').props.onSend(); });
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSetInputText).not.toHaveBeenCalled();
  });

  it('keeps the original disabled and blank-text send guards in the wrapper', async () => {
    const onSendMessage = jest.fn(async () => true);
    await render(<MultimodalInput onSendMessage={onSendMessage} disabled />);
    await act(async () => { await view('MultimodalInputView').props.onSend(); });
    mockContext.inputText = '   ';
    await render(<MultimodalInput onSendMessage={onSendMessage} />);
    await act(async () => { await view('MultimodalInputView').props.onSend(); });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(mockSetInputText).not.toHaveBeenCalled();
  });
});
