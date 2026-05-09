/**
 * 百炼 API 客户端（通过后端代理）
 * 
 * 后端直接调用百炼 API，前端通过 SSE 流式获取响应
 * 自动适配 Web 和 React Native 环境
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// 获取后端地址 - 尝试多个可能的地址
function getBackendUrl(): string {
  // 1. 优先使用环境变量
  if (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_BASE_URL) {
    return Constants.expoConfig.extra.EXPO_PUBLIC_BACKEND_BASE_URL;
  }
  // 2. 尝试从 window.location 获取当前域名
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    // 如果是生产环境域名，直接使用
    if (hostname === 'chat.douhaoyu.cn' || hostname === '8.145.45.174') {
      return `${protocol}//${hostname}`;
    }
  }
  // 3. 默认 localhost
  return 'http://localhost:9091';
}

const BACKEND_BASE_URL = getBackendUrl();
const STREAM_API_URL = BACKEND_BASE_URL 
  ? `${BACKEND_BASE_URL}/api/v1/chat/stream` 
  : '/api/v1/chat/stream';

// 组合分析接口（轻量 + 深度）
const COMBINED_API_URL = BACKEND_BASE_URL 
  ? `${BACKEND_BASE_URL}/api/v1/chat/combined` 
  : '/api/v1/chat/combined';

export interface ChatRequest {
  role: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

// 动态导入 react-native-sse（仅在原生环境使用）
let RNSSE: any = null;
if (Platform.OS !== 'web') {
  try {
    RNSSE = require('react-native-sse').default;
  } catch (e) {
    console.warn('react-native-sse not available');
  }
}

/**
 * 通过后端调用百炼 API（流式）
 */
export async function chatWithDashScope(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  if (Platform.OS === 'web') {
    await chatWeb(systemPrompt, messages, roleName, onChunk, onThinkingChunk);
  } else {
    await chatNative(systemPrompt, messages, roleName, onChunk, onThinkingChunk);
  }
}

/**
 * Web 环境实现：使用 fetch + ReadableStream
 */
async function chatWeb(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  try {
    const response = await fetch(STREAM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: roleName,
        systemPrompt,
        messages,
        model: 'qwen3.6-plus',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // 处理回复内容
            if (parsed.type === 'content' && parsed.content) {
              onChunk?.(parsed.content);
            }
            // 处理思考内容（可选）
            if (parsed.type === 'thinking' && parsed.content && onThinkingChunk) {
              onThinkingChunk(parsed.content);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (error) {
    console.error('Web chat error:', error);
    throw error;
  }
}

/**
 * React Native 环境实现：使用 react-native-sse
 */
async function chatNative(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!RNSSE) {
      reject(new Error('react-native-sse not available'));
      return;
    }

    const sse = new RNSSE(STREAM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: roleName,
        systemPrompt,
        messages,
        model: 'qwen3.6-plus',
      }),
    });

    const timeout = setTimeout(() => {
      sse.close();
      reject(new Error('Request timeout'));
    }, 120000); // 2分钟超时

    sse.addEventListener('message', (event: any) => {
      if (event.data === '[DONE]') {
        clearTimeout(timeout);
        sse.close();
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        // 处理回复内容
        if (parsed.type === 'content' && parsed.content) {
          onChunk?.(parsed.content);
        }
        // 处理思考内容（可选）
        if (parsed.type === 'thinking' && parsed.content && onThinkingChunk) {
          onThinkingChunk(parsed.content);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error: any) => {
      clearTimeout(timeout);
      sse.close();
      reject(new Error(error.message || 'SSE connection error'));
    });

    sse.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * 非流式版本（备用）
 */
export async function chatWithDashScopeSync(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
): Promise<string> {
  const response = await fetch(`${STREAM_API_URL.replace('/stream', '')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: roleName,
      systemPrompt,
      messages,
      model: 'qwen3.6-plus',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.content || data.response || '';
}

// 深度分析结果类型
export interface DeepAnalysis {
  [roleName: string]: {
    analysis: string;
    insight: string;
  };
}

/**
 * 组合分析接口（轻量 + 深度）
 * Web 环境实现
 */
export async function chatCombined(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
): Promise<void> {
  if (Platform.OS === 'web') {
    await chatCombinedWeb(messages, onLightChunk, onDeepChunk, onDeepAnalysis);
  } else {
    await chatCombinedNative(messages, onLightChunk, onDeepChunk, onDeepAnalysis);
  }
}

async function chatCombinedWeb(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
): Promise<void> {
  try {
    // 获取最后一条用户消息用于深度分析
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    const response = await fetch(COMBINED_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        userMessage: lastUserMessage,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            
            // 轻量分析结果
            if (parsed.type === 'light' && parsed.content) {
              onLightChunk?.(parsed.content);
            }
            
            // 深度分析流式内容
            if (parsed.type === 'deep' && parsed.content) {
              onDeepChunk?.(parsed.content);
            }
            
            // 深度分析完整结果（JSON格式）
            if (parsed.type === 'deep' && parsed.analysis) {
              onDeepAnalysis?.(parsed.analysis);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (error) {
    console.error('Combined chat error:', error);
    throw error;
  }
}

async function chatCombinedNative(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!RNSSE) {
      reject(new Error('react-native-sse not available'));
      return;
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    const sse = new RNSSE(COMBINED_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        userMessage: lastUserMessage,
      }),
    });

    const timeout = setTimeout(() => {
      sse.close();
      reject(new Error('Request timeout'));
    }, 180000); // 3分钟超时（深度分析需要更长时间）

    sse.addEventListener('message', (event: any) => {
      if (event.data === '[DONE]') {
        clearTimeout(timeout);
        sse.close();
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        
        if (parsed.type === 'light' && parsed.content) {
          onLightChunk?.(parsed.content);
        }
        
        if (parsed.type === 'deep' && parsed.content) {
          onDeepChunk?.(parsed.content);
        }
        
        if (parsed.type === 'deep' && parsed.analysis) {
          onDeepAnalysis?.(parsed.analysis);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error: any) => {
      clearTimeout(timeout);
      sse.close();
      reject(new Error(error.message || 'SSE connection error'));
    });

    sse.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
