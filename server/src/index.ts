import express from "express";
import cors from "cors";

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
 * 聊天消息接口
 * POST /api/v1/chat
 * Body: {
 *   role: string,          // 角色ID
 *   systemPrompt: string,  // 系统提示词
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>
 * }
 */
app.post('/api/v1/chat', async (req, res) => {
  try {
    const { systemPrompt, messages } = req.body;

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
      return res.status(500).json({ error: 'API key not configured' });
    }

    const response = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: chatMessages,
          stream: false,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DashScope API error:', response.status, errorData);
      return res.status(response.status).json({ 
        error: 'Failed to get response from AI service',
        details: errorData 
      });
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const assistantMessage = data.choices?.[0]?.message?.content || '';

    res.json({ content: assistantMessage });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
