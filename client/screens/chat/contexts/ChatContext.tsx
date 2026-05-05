import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PsychologistRole, DEFAULT_ROLES } from '../constants/roles';
import { ChatMessage, ChatSession, LightAnalysisResult } from '../types';
import { analyzeText } from '../utils/textAnalyzer';
import { chatWithDashScope } from '../api/cozeApi';

interface ChatContextValue {
  messages: ChatMessage[];
  sessions: ChatSession[];
  currentRole: PsychologistRole | null;
  currentSessionId: string | null;
  isLoading: boolean;
  isThinking: boolean;
  thinkingContent: string;
  error: string | null;
  showHistory: boolean;
  lightAnalysis: LightAnalysisResult | null;
  inputText: string;
  showRoleIntro: boolean;
  roles: PsychologistRole[];
  onSelectRole?: (role: PsychologistRole) => void;
  onShowIntro?: () => void;
  setShowRoleIntro: (show: boolean) => void;
  setShowHistory: (show: boolean) => void;
  sendMessage: (content: string) => Promise<void>;
  setLightAnalysis: (analysis: LightAnalysisResult | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setInputText: (text: string) => void;
  setCurrentRole: (role: PsychologistRole | null) => void;
  clearError: () => void;
  createNewChat: (role: PsychologistRole) => void;
  loadSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  currentSession: ChatSession | null;
}

const STORAGE_KEY = 'chat_sessions';

export const ChatContext = createContext<ChatContextValue>({
  messages: [],
  sessions: [],
  currentRole: null,
  currentSessionId: null,
  isLoading: false,
  isThinking: false,
  thinkingContent: '',
  error: null,
  showHistory: false,
  lightAnalysis: null,
  inputText: '',
  showRoleIntro: false,
  roles: DEFAULT_ROLES,
  onSelectRole: undefined,
  onShowIntro: undefined,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setShowRoleIntro: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setShowHistory: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setMessages: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setInputText: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setLightAnalysis: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setCurrentRole: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  createNewChat: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  loadSession: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  deleteSession: async () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  clearError: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  sendMessage: async () => {},
  currentSession: null,
});

export const useChat = () => useContext(ChatContext);

interface ChatProviderProps {
  children: ReactNode;
  onSelectRole?: (role: PsychologistRole) => void;
  onShowIntro?: () => void;
}

export function ChatProvider({ children, onSelectRole, onShowIntro }: ChatProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentRole, setCurrentRole] = useState<PsychologistRole | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lightAnalysis, setLightAnalysis] = useState<LightAnalysisResult | null>(null);
  const [inputText, setInputText] = useState('');
  const [showRoleIntro, setShowRoleIntro] = useState(false);
  const roles = DEFAULT_ROLES;

  const currentSession = sessions.find(s => s.id === currentSessionId) || null;

  // Save sessions to storage
  const saveSessionsToStorage = useCallback(async (newSessions: ChatSession[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSessions));
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  }, []);

  // Load sessions from storage on mount
  useEffect(() => {
    const loadSessionsFromStorage = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          setSessions(JSON.parse(stored));
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    };
    loadSessionsFromStorage();
  }, []);

  const createNewChat = useCallback((role: PsychologistRole) => {
    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      roleId: role.id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions(prev => {
      const updated = [newSession, ...prev];
      saveSessionsToStorage(updated);
      return updated;
    });

    setCurrentSessionId(newSession.id);
    setCurrentRole(role);
    setMessages([]);
    setLightAnalysis(null);
    setError(null);
    setShowHistory(false);
  }, [saveSessionsToStorage]);

  const loadSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === sessionId);
      if (session) {
        const role = DEFAULT_ROLES.find(r => r.id === session.roleId) || null;
        setCurrentSessionId(session.id);
        setCurrentRole(role);
        setMessages(session.messages);
        setLightAnalysis(null);
        setError(null);
        setShowHistory(false);
      }
      return prev;
    });
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== sessionId);
      saveSessionsToStorage(updated);
      
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
        setCurrentRole(null);
      }
      return updated;
    });
  }, [currentSessionId, saveSessionsToStorage]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!currentRole || !userMessage.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    // Perform light analysis immediately
    const analysis = analyzeText(userMessage);
    setLightAnalysis(analysis);

    // Add a placeholder for AI response
    const aiMsgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, aiMsg]);
    setIsLoading(true);
    setIsThinking(false);
    setThinkingContent('');

    let fullContent = '';
    let thinkingText = '';

    try {
      // Get current messages using callback to avoid stale closure
      let currentMessages: ChatMessage[] = [];
      setMessages(prev => {
        currentMessages = [...prev];
        return prev;
      });

      await chatWithDashScope(
        currentRole.systemPrompt,
        currentMessages.slice(0, -1).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        currentRole.name,
        (content) => {
          // onChunk - content callback
          fullContent += content;
          setMessages(prev =>
            prev.map(m =>
              m.id === aiMsgId ? { ...m, content: fullContent } : m
            )
          );
        },
        (thinking) => {
          // onThinkingChunk - thinking callback
          thinkingText += thinking;
          setIsThinking(true);
          setThinkingContent(thinkingText);
        }
      );

      setIsLoading(false);
      setIsThinking(false);
      setThinkingContent('');

      // Save to session if message count >= 1
      if (currentSessionId) {
        setSessions(prev => {
          const updated = prev.map(s => {
            if (s.id === currentSessionId) {
              const updatedMessages = [...s.messages, userMsg, { ...aiMsg, content: fullContent }];
              return { ...s, messages: updatedMessages, updatedAt: Date.now() };
            }
            return s;
          });
          saveSessionsToStorage(updated);
          return updated;
        });
      }
    } catch (err) {
      setIsLoading(false);
      setIsThinking(false);
      setThinkingContent('');
      setError(err instanceof Error ? err.message : '发送失败');

      setMessages(prev => prev.filter(m => m.id !== aiMsgId));
    }
  }, [currentRole, currentSessionId, saveSessionsToStorage]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        sessions,
        currentRole,
        currentSessionId,
        isLoading,
        isThinking,
        thinkingContent,
        error,
        showHistory,
        lightAnalysis,
        inputText,
        showRoleIntro,
        roles,
        onSelectRole,
        onShowIntro,
        setShowRoleIntro,
        setShowHistory,
        setMessages,
        setInputText,
        setLightAnalysis,
        setCurrentRole,
        createNewChat,
        loadSession,
        deleteSession,
        clearError,
        sendMessage,
        currentSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => useContext(ChatContext);
