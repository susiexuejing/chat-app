/**
 * Coze API Client
 * 用于对接 Coze 平台的 Bot API
 * 使用 react-native-sse 处理流式响应
 */

import RNSSE from 'react-native-sse';

const COZE_API_BASE = 'https://api.coze.cn';
const COZE_API_TOKEN = 'pat_PQ6QGqmJ6cqlxSJKRTgzI883P7unwnOn0bApEBzm4DA1wyXy2ibq6adYc6ntqyLq';
const BOT_ID = '7635592039983644682';

export interface CozeResponse {
  conversation_id: string;
  code: number;
  msg: string;
}

// 流式对话接口
export async function chatWithCoze(
  botId: string,
  message: string,
  conversationId?: string,
  onChunk?: (text: string) => void,
): Promise<CozeResponse> {
  const userId = 'user_psychology_app';

  return new Promise((resolve, reject) => {
    let fullContent = '';
    let responseConversationId: string | null = null;

    const requestBody: Record<string, any> = {
      bot_id: botId,
      user_id: userId,
      query: message,
      stream: true,
      auto_save_history: true,
    };

    // 如果有 conversationId，添加到请求中
    if (conversationId) {
      requestBody.conversation_id = conversationId;
    }

    const sse = new RNSSE(`${COZE_API_BASE}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    sse.addEventListener('open', () => {
      console.log('SSE connection opened');
    });

    sse.addEventListener('message', (event) => {
      try {
        if (event.data === '[DONE]') {
          sse.close();
          resolve({
            conversation_id: responseConversationId || '',
            code: 0,
            msg: 'success',
          });
          return;
        }

        const data = JSON.parse(event.data);
        
        // 保存 conversation_id
        if (data.data?.conversation_id) {
          responseConversationId = data.data.conversation_id;
        }
        
        // 跳过状态消息
        if (data.event === 'conversation.chat.created' || 
            data.event === 'conversation.chat.in_progress' ||
            data.event === 'conversation.chat.completed') {
          return;
        }
        
        // 消息内容
        if (data.event === 'conversation.message.delta') {
          const content = data.data?.content || '';
          const reasoning = data.data?.reasoning_content || '';
          
          // 优先使用思考内容
          const text = reasoning || content;
          if (text) {
            fullContent += text;
            onChunk?.(text);
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error) => {
      console.error('SSE error:', error);
      reject(new Error('SSE connection error'));
    });

    sse.addEventListener('close', () => {
      console.log('SSE connection closed');
    });

    // 超时处理
    setTimeout(() => {
      if (fullContent === '' && !responseConversationId) {
        sse.close();
        reject(new Error('Request timeout'));
      }
    }, 60000);
  });
}

// 非流式对话接口（备用）
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
  const convId = createData.data.conversation_id;

  // 轮询获取结果
  const maxAttempts = 60;
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const retrieveResponse = await fetch(
      `${COZE_API_BASE}/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${convId}`,
      {
        headers: {
          'Authorization': `Bearer ${COZE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!retrieveResponse.ok) {
      throw new Error(`HTTP error: ${retrieveResponse.status}`);
    }

    const retrieveData = await retrieveResponse.json();

    if (retrieveData.data?.status === 'completed') {
      // 获取消息
      const messagesResponse = await fetch(
        `${COZE_API_BASE}/v3/chat/message/list?chat_id=${chatId}&conversation_id=${convId}`,
        {
          headers: {
            'Authorization': `Bearer ${COZE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!messagesResponse.ok) {
        throw new Error(`HTTP error: ${messagesResponse.status}`);
      }

      const messagesData = await messagesResponse.json();
      const assistantMessage = messagesData.data?.find(
        (m: any) => m.role === 'assistant' && m.type === 'answer'
      );

      return {
        content: assistantMessage?.content || '',
        conversationId: convId,
      };
    } else if (retrieveData.data?.status === 'failed') {
      throw new Error('Chat failed');
    }

    attempts++;
  }

  throw new Error('Timeout waiting for response');
}
