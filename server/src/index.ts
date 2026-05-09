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
 * 文档: https://help.aliyun.com/zh/model-studio/role-play
 */
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// 模型配置
const MODELS = {
  // 轻量分析模型 - 快速共情
  LIGHT: process.env.DASHSCOPE_MODEL_LIGHT || 'qwen-flash-character-2026-02-26',
  // 深度分析模型 - 多角色分析
  DEEP: process.env.DASHSCOPE_MODEL_DEEP || 'qwen3.6-plus',
  // 默认角色扮演模型
  DEFAULT: process.env.DASHSCOPE_MODEL || 'qwen-plus-character',
};

// API Keys
const API_KEY_LIGHT = process.env.DASHSCOPE_API_KEY; // 轻量分析用
const API_KEY_DEEP = process.env.DASHSCOPE_API_KEY_DEEP; // 深度分析用

/**
 * 轻量共情分析提示词
 * 目标：事实优先复述 + 轻度心理理解 + 开放引导
 */
const LIGHT_ANALYSIS_PROMPT = `你是一位温暖的心理咨询师，正在与来访者进行轻量共情对话。

【核心原则】
1. 事实优先：用户说什么就是什么，直接回应用户的表述，不要假设用户隐藏情绪
2. 轻度心理理解：在确认事实的基础上，给出简短的心理层面的理解
3. 开放引导：用1-2个开放式问题引导用户进一步表达

【回复风格】
- 简洁有力，每次回复控制在50字以内
- 先复述确认用户表达的事实
- 再给出简短的心理理解（如果有）
- 最后用开放式问题引导

【示例】
用户说："我最近感觉有点累了"
正确回复："听起来你这段时间挺辛苦的。能说说是什么让你觉得累吗？是事情太多，还是心里有什么事放不下？"

用户说："今天和男朋友吵架了"
正确回复："吵架了确实会不舒服。能说说是因为什么吵起来的吗？"

【禁止】
- 不要长篇大论
- 不要一上来就安慰或给建议
- 不要假设用户心理状态（如"你可能在隐藏什么"）
- 不要过度解读用户的话`;

import { PSYCHOLOGIST_ROLES } from './roles/psychologistRoles';

/**
 * 调用百炼 API（通用）
 */
async function callDashScope(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean = false,
  maxTokens: number = 500
): Promise<Response> {
  const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
      max_tokens: maxTokens,
      extra_body: {
        thinking: { type: "off" }
      }
    }),
  });
  return response;
}

/**
 * 构建深度分析的角色系统提示词
 */
function buildDeepAnalysisPrompt(userMessage: string, lightAnalysis: string): string {
  const rolesIntro = PSYCHOLOGIST_ROLES.map(role => {
    return `${role.name}（${role.therapyType}）：
- 人设：${role.personalBackground.personalityTraits.join('、')}
- 核心方法：${role.coreValues.emotionalApproach}
- 风格：${role.emotionalResponse.reactionPattern}`;
  }).join('\n\n');

  return `【深度心理分析任务】

用户输入：${userMessage}

轻量共情分析结果：${lightAnalysis}

请从以下6个心理治疗学派视角，对用户进行深度分析：

${rolesIntro}

【输出格式】
请按以下JSON格式输出（只需要输出JSON，不要其他内容）：
{
  "聪明狐狸": { "analysis": "CBT视角分析...", "insight": "关键洞察..." },
  "温暖小熊": { "analysis": "人本主义视角分析...", "insight": "关键洞察..." },
  "深思猫头鹰": { "analysis": "精神分析视角分析...", "insight": "关键洞察..." },
  "情感小精灵": { "analysis": "情绪聚焦视角分析...", "insight": "关键洞察..." },
  "哲思海豚": { "analysis": "存在主义视角分析...", "insight": "关键洞察..." },
  "团结小象": { "analysis": "家庭系统视角分析...", "insight": "关键洞察..." }
}

【要求】
- 每个角色的分析控制在50字以内
- 洞察要精准、有启发性
- 从各自学派的专业角度切入`;
}

/**
 * 轻量共情分析接口
 * POST /api/v1/chat/light
 * 快速返回共情回复
 */
app.post('/api/v1/chat/light', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!API_KEY_LIGHT) {
      return res.status(500).json({ error: 'Light model API key not configured' });
    }

    // 构建消息：只取最后1-2条用户消息
    const recentMessages = messages.slice(-2);
    const chatMessages = [
      { role: 'system', content: LIGHT_ANALYSIS_PROMPT },
      ...recentMessages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    console.log(`[Light Analysis] Using model: ${MODELS.LIGHT}`);

    const response = await callDashScope(API_KEY_LIGHT, MODELS.LIGHT, chatMessages, false, 150);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Light Analysis] API error:', response.status, errorData);
      return res.status(response.status).json({ error: 'Light analysis failed', details: errorData });
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    res.json({ content, type: 'light' });
  } catch (error) {
    console.error('[Light Analysis] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 轻量共情分析接口（流式）
 * POST /api/v1/chat/light/stream
 */
app.post('/api/v1/chat/light/stream', async (req, res) => {
  const { messages } = req.body;

  if (!API_KEY_LIGHT) {
    return res.status(500).json({ error: 'Light model API key not configured' });
  }

  const recentMessages = messages.slice(-2);
  const chatMessages = [
    { role: 'system', content: LIGHT_ANALYSIS_PROMPT },
    ...recentMessages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    console.log(`[Light Analysis Stream] Using model: ${MODELS.LIGHT}`);

    const response = await callDashScope(API_KEY_LIGHT, MODELS.LIGHT, chatMessages, true, 150);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ error: 'Light analysis failed', details: errorData })}\n\n`);
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
              const delta = parsed.choices?.[0]?.delta || {};
              const content = delta.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ type: 'light', content })}\n\n`);
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
    console.error('[Light Stream] Error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    res.end();
  }
});

/**
 * 深度分析接口（并行调用6个角色）
 * POST /api/v1/chat/deep
 */
app.post('/api/v1/chat/deep', async (req, res) => {
  try {
    const { userMessage, lightAnalysis } = req.body;

    if (!API_KEY_DEEP) {
      return res.status(500).json({ error: 'Deep model API key not configured' });
    }

    console.log(`[Deep Analysis] Using model: ${MODELS.DEEP}`);

    // 构建深度分析提示词
    const systemPrompt = buildDeepAnalysisPrompt(userMessage, lightAnalysis);

    const chatMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请根据上述信息进行深度心理分析。' },
    ];

    const response = await callDashScope(API_KEY_DEEP, MODELS.DEEP, chatMessages, false, 2000);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Deep Analysis] API error:', response.status, errorData);
      return res.status(response.status).json({ error: 'Deep analysis failed', details: errorData });
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    let content = data.choices?.[0]?.message?.content || '';

    // 尝试解析 JSON
    try {
      // 提取 JSON 部分（可能在 ```json ... ``` 中）
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        content = jsonMatch[1];
      }
      const parsed = JSON.parse(content);
      res.json({ analysis: parsed, type: 'deep' });
    } catch (e) {
      // 解析失败，返回原始内容
      res.json({ content, type: 'deep', parseError: true });
    }
  } catch (error) {
    console.error('[Deep Analysis] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 深度分析接口（流式）
 * POST /api/v1/chat/deep/stream
 */
app.post('/api/v1/chat/deep/stream', async (req, res) => {
  const { userMessage, lightAnalysis } = req.body;

  if (!API_KEY_DEEP) {
    res.write(`data: ${JSON.stringify({ error: 'Deep model API key not configured' })}\n\n`);
    res.end();
    return;
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    console.log(`[Deep Analysis Stream] Using model: ${MODELS.DEEP}`);

    const systemPrompt = buildDeepAnalysisPrompt(userMessage, lightAnalysis);
    const chatMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请根据上述信息进行深度心理分析。' },
    ];

    const response = await callDashScope(API_KEY_DEEP, MODELS.DEEP, chatMessages, true, 2000);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ error: 'Deep analysis failed', details: errorData })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

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
            // 尝试解析完整的 JSON 并发送
            try {
              const jsonMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/) || fullContent.match(/(\{[\s\S]*\})/);
              if (jsonMatch) {
                const jsonStr = jsonMatch[1];
                const parsed = JSON.parse(jsonStr);
                res.write(`data: ${JSON.stringify({ type: 'deep', analysis: parsed, done: true })}\n\n`);
              } else {
                res.write(`data: ${JSON.stringify({ type: 'deep', content: fullContent, done: true })}\n\n`);
              }
            } catch (e) {
              res.write(`data: ${JSON.stringify({ type: 'deep', content: fullContent, done: true })}\n\n`);
            }
          } else {
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta || {};
              const content = delta.content;
              if (content) {
                fullContent += content;
                res.write(`data: ${JSON.stringify({ type: 'deep', content })}\n\n`);
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
    console.error('[Deep Stream] Error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    res.end();
  }
});

/**
 * 组合分析接口（轻量 + 深度，分段返回）
 * POST /api/v1/chat/combined
 * 先返回轻量分析，再并行触发深度分析
 */
app.post('/api/v1/chat/combined', async (req, res) => {
  const { messages, userMessage } = req.body;

  if (!API_KEY_LIGHT) {
    return res.status(500).json({ error: 'Light model API key not configured' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // 阶段1：轻量共情分析（立即返回）
    console.log(`[Combined] Stage 1: Light Analysis`);
    
    const recentMessages = messages.slice(-2);
    const lightMessages = [
      { role: 'system', content: LIGHT_ANALYSIS_PROMPT },
      ...recentMessages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    const lightResponse = await callDashScope(API_KEY_LIGHT, MODELS.LIGHT, lightMessages, false, 150);

    if (!lightResponse.ok) {
      const errorData = await lightResponse.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ error: 'Light analysis failed', details: errorData })}\n\n`);
      res.end();
      return;
    }

    const lightData = await lightResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const lightContent = lightData.choices?.[0]?.message?.content || '';

    // 发送轻量分析结果
    res.write(`data: ${JSON.stringify({ type: 'light', content: lightContent })}\n\n`);

    // 阶段2：深度分析（并行触发）
    if (API_KEY_DEEP) {
      console.log(`[Combined] Stage 2: Deep Analysis`);
      
      const systemPrompt = buildDeepAnalysisPrompt(userMessage, lightContent);
      const deepMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请根据上述信息进行深度心理分析。' },
      ];

      const deepResponse = await callDashScope(API_KEY_DEEP, MODELS.DEEP, deepMessages, false, 2000);

      if (deepResponse.ok) {
        const deepData = await deepResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        let deepContent = deepData.choices?.[0]?.message?.content || '';

        // 尝试解析 JSON
        try {
          const jsonMatch = deepContent.match(/```(?:json)?\s*([\s\S]*?)```/) || deepContent.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            deepContent = jsonMatch[1];
          }
          const parsed = JSON.parse(deepContent);
          res.write(`data: ${JSON.stringify({ type: 'deep', analysis: parsed })}\n\n`);
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'deep', content: deepContent })}\n\n`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[Combined] Error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
    res.end();
  }
});

/**
 * 聊天消息接口（非流式）- 保留兼容
 */
app.post('/api/v1/chat', async (req, res) => {
  try {
    const { systemPrompt, messages, model } = req.body;

    const apiKey = API_KEY_LIGHT || process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    const selectedModel = model || MODELS.DEFAULT;
    const response = await callDashScope(apiKey, selectedModel, chatMessages, false, 800);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: 'AI service error', details: errorData });
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    res.json({ content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 流式聊天接口（SSE）- 保留兼容
 */
app.post('/api/v1/chat/stream', async (req, res) => {
  const { systemPrompt, messages, model } = req.body;

  const apiKey = API_KEY_LIGHT || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const selectedModel = model || MODELS.DEFAULT;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await callDashScope(apiKey, selectedModel, chatMessages, true, 500);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ error: 'AI service error', details: errorData })}\n\n`);
      res.end();
      return;
    }

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
              const delta = parsed.choices?.[0]?.delta || {};
              const content = delta.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
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
    res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    res.end();
  }
});

/**
 * 角色列表接口
 * GET /api/v1/roles
 */
app.get('/api/v1/roles', (req, res) => {
  const roles = PSYCHOLOGIST_ROLES.map(({ systemPrompt, ...role }) => role);
  res.json({ roles });
});

// 启动服务器
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Light Model: ${MODELS.LIGHT}`);
  console.log(`Deep Model: ${MODELS.DEEP}`);
});

export default app;
