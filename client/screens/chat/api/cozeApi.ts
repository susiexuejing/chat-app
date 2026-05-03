/**
 * Coze API Client
 * 用于对接 Coze 平台的 Bot API
 * 
 * Coze SSE 事件格式：
 * event:conversation.message.delta
 * data:{"type":"answer","content":"","reasoning_content":"我",...}
 */

import RNSSE from 'react-native-sse';

const COZE_API_BASE = 'https://api.coze.cn';
const COZE_API_TOKEN = 'pat_PQ6QGqmJ6cqlxSJKRTgzI883P7unwnOn0bApEBzm4DA1wyXy2ibq6adYc6ntqyLq';

export interface CozeResponse {
  conversation_id: string;
  code: number;
  msg: string;
}

/**
 * React Native 环境下的流式处理
 */
export async function chatWithCoze(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = 'user_psychology_app';

  const requestBody: Record<string, any> = {
    bot_id: botId,
    user_id: userId,
    stream: true,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: message,
        content_type: 'text',
      },
    ],
  };

  if (conversationId) {
    requestBody.conversation_id = conversationId;
  }

  return new Promise((resolve, reject) => {
    let conversationIdResult = '';
    let chatCompleted = false;

    const sse = new RNSSE(`${COZE_API_BASE}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Coze API 使用标准的 message 事件
    sse.addEventListener('message', (event: any) => {
      try {
        const rawData = event.data;
        
        // 检查是否是结束标记
        if (rawData === '[DONE]') {
          chatCompleted = true;
          resolve({ conversation_id: conversationIdResult, code: 0, msg: 'success' });
          return;
        }

        // 解析 Coze 的 SSE 数据格式
        // Coze 发送的格式是：event:xxx\ndata:{...}\n
        // react-native-sse 会把整个消息作为 data 发送
        
        let eventType = '';
        let jsonData = rawData;

        // 检查是否包含 event: 前缀（有些 SSE 实现会包含）
        if (rawData.startsWith('event:')) {
          const parts = rawData.split('\n');
          for (const part of parts) {
            if (part.startsWith('event:')) {
              eventType = part.slice(6).trim();
            } else if (part.startsWith('data:')) {
              jsonData = part.slice(5).trim();
            }
          }
        }

        const data = JSON.parse(jsonData);
        
        // 从数据中提取 conversation_id
        if (data.conversation_id) {
          conversationIdResult = data.conversation_id;
        }

        // 检查是否是消息 delta 事件
        // Coze 使用 type 字段来区分消息类型
        if (data.type === 'answer' || data.type === 'follow_up' || eventType.includes('message.delta')) {
          // 优先使用 reasoning_content（思维链），否则使用 content
          const text = data.reasoning_content || data.content || '';
          
          if (text && onChunk) {
            onChunk(text);
          }
        }

        // 检查对话是否完成
        if (data.status === 'completed' || eventType.includes('chat.completed')) {
          chatCompleted = true;
          resolve({ conversation_id: conversationIdResult, code: 0, msg: 'success' });
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error: any) => {
      console.error('SSE error:', error);
      if (!chatCompleted) {
        reject(new Error('SSE connection error'));
      }
    });

    sse.addEventListener('close', () => {
      console.log('SSE connection closed');
    });

    // 超时处理（3分钟）
    setTimeout(() => {
      if (!chatCompleted) {
        sse.close();
        resolve({ conversation_id: conversationIdResult, code: 0, msg: 'timeout' });
      }
    }, 180000);
  });
}

/**
 * 非流式对话接口（备用方案）
 */
export async function chatWithCozeSync(
  botId: string,
  message: string,
  conversationId?: string,
): Promise<{ content: string; conversationId: string }> {
  const userId = 'user_psychology_app';

  const requestBody: Record<string, any> = {
    bot_id: botId,
    user_id: userId,
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: message,
        content_type: 'text',
      },
    ],
  };

  if (conversationId) {
    requestBody.conversation_id = conversationId;
  }

  // 创建对话
  const createResponse = await fetch(`${COZE_API_BASE}/v3/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COZE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!createResponse.ok) {
    throw new Error(`HTTP error: ${createResponse.status}`);
  }

  const createData = await createResponse.json();
  
  if (createData.code !== 0) {
    throw new Error(createData.msg || 'API error');
  }

  const chatId = createData.data.id;
  const newConversationId = createData.data.conversation_id;

  // 轮询获取结果（最多等待 60 秒）
  const maxAttempts = 60;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const statusResponse = await fetch(
      `${COZE_API_BASE}/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${newConversationId}`,
      {
        headers: {
          'Authorization': `Bearer ${COZE_API_TOKEN}`,
        },
      }
    );
    
    const statusData = await statusResponse.json();
    
    if (statusData.data?.status === 'completed') {
      // 获取消息列表
      const messagesResponse = await fetch(
        `${COZE_API_BASE}/v3/chat/message/list?chat_id=${chatId}&conversation_id=${newConversationId}`,
        {
          headers: {
            'Authorization': `Bearer ${COZE_API_TOKEN}`,
          },
        }
      );
      
      const messagesData = await messagesResponse.json();
      
      // 找到 assistant 的最终回复
      const assistantMessages = messagesData.data?.filter(
        (m: any) => m.role === 'assistant' && m.type === 'answer'
      );
      
      if (assistantMessages && assistantMessages.length > 0) {
        const lastMessage = assistantMessages[assistantMessages.length - 1];
        return {
          content: lastMessage.content || '',
          conversationId: newConversationId,
        };
      }
      
      return { content: '', conversationId: newConversationId };
    }
    
    attempts++;
  }

  throw new Error('Timeout waiting for response');
}
