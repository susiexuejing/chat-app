import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config(); // 加载 .env 环境变量

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/v1/health', (req, res) => {
  console.log('Health check success');
  res.status(200).json({ status: 'ok' });
});

/**
 * 百炼 API 配置
 * 文档: https://help.aliyun.com/zh/model-studio/qwen-omni
 */
const DASHSCOPE_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1';
// 模型选择: qwen-plus (文本) 或 qwen3.5-omni-plus (多模态-文本+音频)
const DEFAULT_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-plus';

/**
 * 聊天消息接口（非流式）
 * POST /api/v1/chat
 * Body: {
 *   role: string,           // 角色ID
 *   systemPrompt: string,   // 系统提示词
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>
 *   model?: string          // 可选：指定模型
 * }
 */
app.post('/api/v1/chat', async (req, res) => {
  try {
    const { systemPrompt, messages, model } = req.body;

    // 构建消息格式
    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    // 调用百炼 API
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.error('DASHSCOPE_API_KEY not configured');
      return res.status(500).json({ error: 'API key not configured. Please set DASHSCOPE_API_KEY environment variable.' });
    }

    const selectedModel = model || DEFAULT_MODEL;
    console.log(`Calling DashScope API with model: ${selectedModel}`);

    const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: chatMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DashScope API error:', response.status, errorData);
      return res.status(response.status).json({
        error: 'Failed to get response from AI service',
        details: errorData,
      });
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const assistantMessage = data.choices?.[0]?.message?.content || '';

    res.json({
      content: assistantMessage,
      usage: data.usage,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error', message: String(error) });
  }
});

/**
 * 流式聊天接口（SSE）
 * POST /api/v1/chat/stream
 * Body: {
 *   role: string,           // 角色ID
 *   systemPrompt: string,   // 系统提示词
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>
 *   model?: string          // 可选：指定模型
 * }
 */
app.post('/api/v1/chat/stream', async (req, res) => {
  const { systemPrompt, messages, model } = req.body;

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // 构建消息格式
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const selectedModel = model || DEFAULT_MODEL;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: chatMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DashScope API error:', response.status, errorData);
      res.write(`data: ${JSON.stringify({ error: 'AI service error', details: errorData })}\n\n`);
      res.end();
      return;
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream error', message: String(error) })}\n\n`);
    res.end();
  }
});

/**
 * 角色列表接口
 * GET /api/v1/roles
 * 返回所有可用的心理咨询师角色配置
 */
import { PSYCHOLOGIST_ROLES } from './roles/psychologistRoles';

app.get('/api/v1/roles', (req, res) => {
  // 返回角色列表（不含 systemPrompt，让前端自己处理）
  const roles = PSYCHOLOGIST_ROLES.map(({ systemPrompt, ...role }) => role);
  res.json({ roles });
});

/**
 * Coze API 代理接口（SSE 流式）
 * POST /api/v1/coze/chat
 * Body: {
 *   botId: string,
 *   userId: string,
 *   query: string,
 *   conversationId?: string
 * }
 */
const COZE_API_BASE = 'https://api.coze.cn';
const COZE_API_TOKEN = process.env.COZE_API_TOKEN || 'pat_PQ6QGqmJ6cqlxSJKRTgzI883P7unwnOn0bApEBzm4DA1wyXy2ibq6adYc6ntqyLq';

app.post('/api/v1/coze/chat', async (req, res) => {
  const { botId, userId, query, roleName } = req.body;

  if (!botId || !userId || !query) {
    return res.status(400).json({ error: 'Missing required parameters: botId, userId, query' });
  }

  // 百炼 API 配置
  const apiKey = process.env.DASHSCOPE_API_KEY || 'sk-dcdaf744a6644e2890ac7d4f9ecb2d9f';
  const modelName = 'qwen3-omni-flash';

  // 构造包含百炼 API 调用参数的消息
  const formattedQuery = `我需要调用百炼 API，参数为：
- 任务标题（title）：${roleName || '心理咨询对话'}
- 待处理内容（input_content）：${query}
- 目标模型名称（model_name）：${modelName}
- API 密钥（api_key）：${apiKey}

请帮我调用百炼 API 处理这段对话内容。`;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // 调用 Coze API 创建对话（流式）
    const createResponse = await fetch(`${COZE_API_BASE}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: botId,
        user_id: userId,
        stream: true,
        auto_save_history: true,
        additional_messages: [
          {
            role: 'user',
            content: formattedQuery,
            content_type: 'text',
          },
        ],
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Coze API error:', createResponse.status, errorText);
      res.write(`data: ${JSON.stringify({ error: 'Coze API error', details: errorText })}\n\n`);
      res.end();
      return;
    }

    // 直接将 Coze 的流式响应转发给客户端
    const reader = createResponse.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) {
      res.write(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`);
      res.end();
      return;
    }

    // 持续读取并转发流
    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            res.write('data: [DONE]\n\n');
            res.end();
            break;
          }

          // 解码数据
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // 处理 SSE 事件（Coze 格式: event:xxx\ndata:{...}\n\n）
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            // 解析 event: 头
            if (line.startsWith('event:')) {
              // 跳过 event 行
              continue;
            }
            
            // 解析 data: 内容
            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              
              // 跳过空数据
              if (!dataStr) continue;

              // 检查是否是结束标记
              if (dataStr === '[DONE]') {
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }

              // 尝试解析 Coze 的响应数据
              try {
                const cozeData = JSON.parse(dataStr);
                
                // Coze 流式响应的数据结构
                // { type: "message", role: "assistant", content: "...", ... }
                // { type: "message", role: "assistant", content_type: "text", content: "...", reasoning_content: "..." }
                
                if (cozeData.type === 'message' || cozeData.type === 'answer') {
                  // 提取内容（优先使用 reasoning_content，其次使用 content）
                  let content = cozeData.reasoning_content || cozeData.content || '';
                  
                  if (content) {
                    // 发送到客户端
                    res.write(`data: ${JSON.stringify({ type: 'message', content })}\n\n`);
                  }
                } else if (cozeData.type === 'conversation.message.delta') {
                  // 另一种可能的格式
                  let content = cozeData.content || cozeData.delta || '';
                  if (content) {
                    res.write(`data: ${JSON.stringify({ type: 'message', content })}\n\n`);
                  }
                }
              } catch (parseErr) {
                // 如果解析失败，尝试直接发送原数据
                if (dataStr && dataStr !== '[DONE]') {
                  console.log('Failed to parse Coze data:', dataStr.substring(0, 100));
                }
              }
            }
          }
        }
      } catch (streamErr) {
        console.error('Stream processing error:', streamErr);
        res.write(`data: ${JSON.stringify({ error: 'Stream error', message: String(streamErr) })}\n\n`);
        res.end();
      }
    };

    processStream();

    // 处理客户端断开连接
    req.on('close', () => {
      reader.cancel();
      res.end();
    });

  } catch (error) {
    console.error('Coze proxy error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Proxy error', message: String(error) })}\n\n`);
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
  console.log(`DashScope API configured with model: ${DEFAULT_MODEL}`);
  console.log(`API documentation: https://help.aliyun.com/zh/model-studio/qwen-omni`);
});
