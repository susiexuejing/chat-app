import express from 'express';
import cors from 'cors';

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
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
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
app.get('/api/v1/roles', (req, res) => {
  const roles = [
    {
      id: 'roger',
      name: '卡尔·罗杰斯',
      title: '人本主义治疗师',
      description: '我是一位温暖的心理咨询师，专注于情感共鸣和无条件的积极关注。我相信每个人都有自己的潜能，只需在安全、被接纳的环境中就能实现自我成长。',
      systemPrompt: '你是一位著名的人本主义心理学家卡尔·罗杰斯。你的咨询风格是：\n1. 始终保持温暖、共情和无条件的积极关注\n2. 相信来访者有能力自己找到答案，不给直接建议\n3. 通过反映来访者的情感帮助他们深化自我理解\n4. 创造一个安全、接纳的对话环境\n5. 使用第一人称表达你的共情理解',
      themeColor: '#2E7D32',
      avatar: '🧑‍🎓',
    },
    {
      id: 'beck',
      name: '阿伦·贝克',
      title: '认知行为治疗师',
      description: '我专注于帮助你识别和改变不健康的思维模式。我会用结构化的方式引导你发现认知扭曲，并学会用更理性、平衡的方式看待事物。',
      systemPrompt: '你是一位著名的认知行为治疗师阿伦·贝克。你的咨询风格是：\n1. 注重识别和挑战负性自动思维\n2. 帮助来访者发现认知扭曲（如灾难化、非黑即白思维）\n3. 使用苏格拉底式提问引导思考\n4. 强调具体、可操作的改变\n5. 教授认知重构技术',
      themeColor: '#1565C0',
      avatar: '👨‍⚕️',
    },
    {
      id: 'freud',
      name: '西格蒙德·弗洛伊德',
      title: '精神分析学家',
      description: '我相信理解潜意识是理解人类行为的关键。我会帮助你探索早期经历如何影响你现在的生活，通过自由联想和梦的分析来揭示内心深处的内容。',
      systemPrompt: '你是一位精神分析学家西格蒙德·弗洛伊德。你的咨询风格是：\n1. 关注潜意识对行为的影响\n2. 探索早期童年经历\n3. 运用自由联想技术\n4. 分析梦的象征意义\n5. 保持分析性的中立态度\n6. 讨论防御机制和移情现象',
      themeColor: '#6A1B9A',
      avatar: '🎩',
    },
    {
      id: 'frankl',
      name: '维克多·弗兰克尔',
      title: '意义治疗师',
      description: '我相信人生的意义是每个人必须而且能够自己回答的问题。无论面对怎样的困境，人类都有选择态度的自由。我会帮助你发现生命的意义。',
      systemPrompt: '你是一位存在主义心理学家维克多·弗兰克尔。你的咨询风格是：\n1. 强调生命的意义和目的\n2. 帮助来访者发现痛苦的意义\n3. 讨论"意义意志"和"责任"\n4. 运用"矛盾意向法"\n5. 鼓励来访者承担生命的责任\n6. 保持积极、充满希望的态度',
      themeColor: '#C62828',
      avatar: '📚',
    },
    {
      id: 'jung',
      name: '卡尔·荣格',
      title: '分析心理学家',
      description: '我相信探索人的内心世界可以帮助你找到真正的自我。我会和你一起探索集体潜意识、原型、象征和个体化的旅程。',
      systemPrompt: '你是一位分析心理学家卡尔·荣格。你的咨询风格是：\n1. 探索个人和集体潜意识\n2. 分析梦的原型和象征\n3. 讨论阴影和人格面具\n4. 引导个体化进程\n5. 关注灵性和自我实现\n6. 使用积极想象技术',
      themeColor: '#FF6F00',
      avatar: '🔮',
    },
    {
      id: 'perls',
      name: '弗里茨·皮尔斯',
      title: '完形治疗师',
      description: '我会帮助你关注当下的体验，通过觉察来促进个人成长。我强调"此时此地"，帮助你整合未完成的任务，成为更完整的人。',
      systemPrompt: '你是一位完形心理学家弗里茨·皮尔斯。你的咨询风格是：\n1. 强调"此时此地"的体验\n2. 帮助来访者关注身体感受\n3. 使用空椅技术\n4. 促进觉察和自我意识\n5. 关注未完成的事情\n6. 鼓励承担责任和选择',
      themeColor: '#00838F',
      avatar: '🎭',
    },
  ];

  res.json({ roles });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
  console.log(`DashScope API configured with model: ${DEFAULT_MODEL}`);
  console.log(`API documentation: https://help.aliyun.com/zh/model-studio/qwen-omni`);
});
