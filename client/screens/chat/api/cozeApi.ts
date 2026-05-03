/**
 * Coze API Client (通过后端代理)
 * 
 * 由于浏览器 CORS 限制，前端不能直接调用 Coze API
 * 所以通过我们自己的 Express 后端进行代理转发
 * 
 * 自动适配 Web 和 React Native 环境
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// 后端代理地址
const BACKEND_BASE_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';
const COZE_PROXY_URL = `${BACKEND_BASE_URL}/api/v1/coze/chat`;

export interface CozeResponse {
  conversation_id: string;
  code: number;
  msg: string;
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
 * 通过后端代理调用 Coze API
 * Web 环境使用 fetch + ReadableStream
 * React Native 环境使用 react-native-sse
 */
export async function chatWithCoze(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = `user_${Date.now()}`;

  if (Platform.OS === 'web') {
    // Web 环境：使用 fetch API
    return chatWithCozeWeb(botId, message, conversationId, onChunk);
  } else {
    // React Native 环境：使用 react-native-sse
    return chatWithCozeNative(botId, message, conversationId, onChunk);
  }
}

/**
 * Web 环境实现
 */
async function chatWithCozeWeb(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = `user_${Date.now()}`;
  
  try {
    const response = await fetch(COZE_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botId,
        userId,
        query: message,
        conversationId,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let conversationIdResult = conversationId || '';
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      // 按行分割处理 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === 'data: [DONE]') {
          return { conversation_id: conversationIdResult, code: 0, msg: 'success' };
        }
        
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          
          try {
            const data = JSON.parse(dataStr);
            
            if (data.type === 'chat_created') {
              conversationIdResult = data.conversationId;
            } else if (data.type === 'message' && data.content) {
              onChunk?.(data.content);
            } else if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    return { conversation_id: conversationIdResult, code: 0, msg: 'success' };
  } catch (error: any) {
    console.error('SSE error:', error);
    throw new Error(error.message || 'SSE connection error');
  }
}

/**
 * React Native 环境实现
 */
function chatWithCozeNative(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = `user_${Date.now()}`;
  
  return new Promise((resolve, reject) => {
    let conversationIdResult = conversationId || '';
    let resolved = false;

    if (!RNSSE) {
      reject(new Error('react-native-sse not available'));
      return;
    }

    const sse = new RNSSE(COZE_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botId,
        userId,
        query: message,
        conversationId,
      }),
    });

    sse.addEventListener('message', (event: any) => {
      try {
        const rawData = event.data;

        if (rawData === '[DONE]') {
          if (!resolved) {
            resolved = true;
            resolve({ conversation_id: conversationIdResult, code: 0, msg: 'success' });
          }
          sse.close();
          return;
        }

        const data = JSON.parse(rawData);

        if (data.type === 'chat_created') {
          conversationIdResult = data.conversationId;
        } else if (data.type === 'message' && data.content) {
          onChunk?.(data.content);
        } else if (data.error) {
          if (!resolved) {
            resolved = true;
            reject(new Error(data.error || 'Unknown error'));
          }
          sse.close();
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (event: any) => {
      console.error('SSE error:', event);
      if (!resolved) {
        resolved = true;
        reject(new Error('SSE connection error'));
      }
    });

    sse.addEventListener('close', () => {
      if (!resolved) {
        resolved = true;
        resolve({ conversation_id: conversationIdResult, code: 0, msg: 'success' });
      }
    });

    // 超时保护：3分钟
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sse.close();
        reject(new Error('Request timeout'));
      }
    }, 180000);
  });
}

/**
 * 非流式版本（备用）
 */
export async function chatWithCozeSync(
  botId: string,
  message: string,
  conversationId?: string,
): Promise<{ content: string; conversationId: string }> {
  const userId = `user_${Date.now()}`;

  try {
    const response = await fetch(COZE_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botId,
        userId,
        query: message,
        conversationId,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let conversationIdResult = conversationId || '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === 'data: [DONE]') {
          return { content: fullContent, conversationId: conversationIdResult };
        }
        
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          
          try {
            const data = JSON.parse(dataStr);
            
            if (data.type === 'chat_created') {
              conversationIdResult = data.conversationId;
            } else if (data.type === 'message' && data.content) {
              fullContent += data.content;
            } else if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    return { content: fullContent, conversationId: conversationIdResult };
  } catch (error: any) {
    console.error('SSE error:', error);
    throw new Error(error.message || 'SSE connection error');
  }
}
