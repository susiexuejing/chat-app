/**
 * 百炼 API 客户端（通过后端代理）
 * 
 * 后端直接调用百炼 API，前端通过 SSE 流式获取响应
 * 自动适配 Web 和 React Native 环境
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// 获取后端地址 - Web 环境直接使用当前域名
function getBackendUrl(): string {
  // Web 环境：从 window.location 获取当前域名
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:9091`;
  }
  // 默认 localhost
  return 'http://localhost:9091';
}

const BACKEND_BASE_URL = getBackendUrl();
const STREAM_API_URL = BACKEND_BASE_URL 
  ? `${BACKEND_BASE_URL}/api/v1/chat/stream` 
  : '/api/v1/chat/stream';

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
): Promise<void> {
  if (Platform.OS === 'web') {
    await chatWeb(systemPrompt, messages, roleName, onChunk);
  } else {
    await chatNative(systemPrompt, messages, roleName, onChunk);
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
            if (parsed.content) {
              onChunk?.(parsed.content);
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
        if (parsed.content) {
          onChunk?.(parsed.content);
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

/**
 * 语音转文字（ASR）
 * @param audioUri 录音文件的 URI
 * @returns 识别后的文字
 */
export async function speechToText(audioUri: string): Promise<string> {
  try {
    // 创建 FormData
    const formData = new FormData();
    
    // 获取文件名和 MIME 类型
    const fileName = audioUri.split('/').pop() || 'recording.m4a';
    const mimeType = 'audio/m4a';
    
    // 根据环境处理文件
    if (Platform.OS === 'web') {
      // Web 环境：使用 fetch 获取 blob
      const response = await fetch(audioUri);
      const blob = await response.blob();
      formData.append('file', blob, fileName);
    } else {
      // React Native 环境：使用 uri
      formData.append('file', {
        uri: audioUri,
        name: fileName,
        type: mimeType,
      } as any);
    }

    const response = await fetch(`${BACKEND_BASE_URL}/api/v1/asr`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `ASR failed: ${response.status}`);
    }

    const data = await response.json();
    return data.text || data.transcription || '';
  } catch (error) {
    console.error('ASR error:', error);
    throw error;
  }
}
