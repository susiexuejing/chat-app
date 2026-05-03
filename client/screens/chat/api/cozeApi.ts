/**
 * Coze API Client (通过后端代理)
 * 
 * 由于浏览器 CORS 限制，前端不能直接调用 Coze API
 * 所以通过我们自己的 Express 后端进行代理转发
 */

import RNSSE from 'react-native-sse';
import Constants from 'expo-constants';

// 后端代理地址
const BACKEND_BASE_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';
const COZE_PROXY_URL = `${BACKEND_BASE_URL}/api/v1/coze/chat`;

export interface CozeResponse {
  conversation_id: string;
  code: number;
  msg: string;
}

/**
 * 通过后端代理调用 Coze API
 */
export async function chatWithCoze(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = `user_${Date.now()}`;

  return new Promise((resolve, reject) => {
    let conversationIdResult = conversationId || '';
    let resolved = false;

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

        // 检查是否是结束标记
        if (rawData === '[DONE]') {
          if (!resolved) {
            resolved = true;
            resolve({ conversation_id: conversationIdResult, code: 0, msg: 'success' });
          }
          sse.close();
          return;
        }

        // 解析代理返回的数据
        const data = JSON.parse(rawData);

        if (data.type === 'chat_created') {
          // 保存 conversation ID
          conversationIdResult = data.conversationId;
        } else if (data.type === 'message' && data.content) {
          // 收到消息内容块
          onChunk?.(data.content);
        } else if (data.error) {
          // 错误处理
          console.error('Coze proxy error:', data);
          if (!resolved) {
            resolved = true;
            reject(new Error(data.error || 'Unknown error'));
          }
          sse.close();
        }
      } catch (e) {
        console.error('Parse error:', e);
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

  const response = await fetch(COZE_PROXY_URL.replace('/chat', '/chat'), {
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

  let fullContent = '';
  let convId = conversationId || '';

  // 解析 SSE 流
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          return { content: fullContent, conversationId: convId };
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.conversationId) {
            convId = parsed.conversationId;
          }
          if (parsed.content) {
            fullContent += parsed.content;
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  return { content: fullContent, conversationId: convId };
}
