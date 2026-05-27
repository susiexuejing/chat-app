import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { frontFlows } from './flows/frontFlows';
import type { FrontFlowItem } from './flows/frontFlows';
import type { EmotionTag, EventTag } from './flows/frontFlows';
import { recognizeEmotion, recognizeEvent } from './flows/recognizer';

// 调试：打印环境变量
console.log('DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? 'SET' : 'NOT SET');
console.log('DASHSCOPE_API_KEY_DEEP:', process.env.DASHSCOPE_API_KEY_DEEP ? 'SET' : 'NOT SET');

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================
// 环境变量
// ============================================================
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY_LIGHT = process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY_LIGHT;
const API_KEY_DEEP = process.env.DASHSCOPE_API_KEY_DEEP;

const MODELS = {
  LIGHT: process.env.MODEL_LIGHT || 'qwen-flash-character-2026-02-26',
  DEEP: process.env.MODEL_DEEP || 'qwen3.6-plus',
};

// ============================================================
// Session 管理（内存）
// ============================================================
interface ChatSession {
  sessionId: string;
  roleId: string;
  roleName: string;
  userMessage: string;
  emotionTag: EmotionTag;
  eventTag: EventTag;
  frontFlow: FrontFlowItem[];
  createdAt: number;
  deepResult: string | null;       // 最终完整结果
  deepStreaming: boolean;          // 是否正在流式生成
  deepError: string | null;        // 错误信息
}

const sessions = new Map<string, ChatSession>();

const SESSION_TTL_MS = 10 * 60 * 1000; // 10分钟过期

// 定期清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 1000);

// ============================================================
// 角色名称映射
// ============================================================
const ROLE_NAMES: Record<string, string> = {
  'clever-fox': '聪明狐狸',
  'warm-bear': '温暖小熊',
  'wise-owl': '深思猫头鹰',
  'emotion-elf': '情感小精灵',
  'philosophy-dolphin': '哲思海豚',
  'unity-elephant': '团结小象',
};

// ============================================================
// 角色 system prompt 构建（用于百炼）
// ============================================================
function buildDeepSystemPrompt(roleId: string, roleName: string, frontFlow: FrontFlowItem[]): string {
  // 从前端流中提取文本
  const flowTexts = frontFlow.map(item => item.text);
  const frontFlowText = flowTexts.join('\n');

  return `你是「${roleName}」。

${getRoleStyle(roleId)}

用户已经看到以下前置陪伴内容：
${frontFlowText}

请严格遵守：
- 不要重复以上前置陪伴内容
- 不要输出 JSON
- 不要输出 Markdown 代码块（包括 \`\`\`json）
- 只用自然语言继续往下说
- 从更深一层的分析开始
- 回复长度控制在 300 字以内

请接着前端陪伴流自然续写，让用户感受到是同一个「${roleName}」一直在陪伴ta。`;
}

function getRoleStyle(roleId: string): string {
  const styles: Record<string, string> = {
    'clever-fox': '你风格接近CBT：理性、温和、善于拆解念头。',
    'warm-bear': '你风格接近人本主义：温暖、共情、无条件接纳。',
    'wise-owl': '你风格接近精神分析：洞察潜意识、探索深层冲突。',
    'emotion-elf': '你风格接近情绪聚焦疗法：关注情感识别与调节。',
    'philosophy-dolphin': '你风格接近存在主义：探索意义、自由与责任。',
    'unity-elephant': '你风格接近叙事/系统疗法：关注关系模式与故事重构。',
  };
  return styles[roleId] || '你是一位温暖的心理陪伴者。';
}

// ============================================================
// 调用百炼 DashScope API
// ============================================================
async function callDashScope(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean,
  maxTokens: number = 1200
): Promise<Response> {
  const url = `${baseUrl}/chat/completions`;

  const body = JSON.stringify({
    model,
    messages,
    stream,
    max_tokens: maxTokens,
    temperature: 0.6,
  });

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });
}

// ============================================================
// 后端异步调用百炼（在返回前端流之后触发）
// ============================================================
async function startDeepAnalysis(session: ChatSession): Promise<void> {
  const apiKey = API_KEY_LIGHT;  // 使用基础密钥（已验证可用）
  if (!apiKey) {
    session.deepError = 'API key not configured';
    return;
  }

  session.deepStreaming = true;

  try {
    const systemPrompt = buildDeepSystemPrompt(session.roleId, session.roleName, session.frontFlow);
    const deepMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: session.userMessage },
    ];

    const response = await callDashScope(
      DASHSCOPE_BASE_URL,
      apiKey,
      MODELS.DEEP,
      deepMessages,
      true,
      1200
    );

    if (!response.ok) {
      session.deepError = `DashScope error: ${response.status}`;
      session.deepStreaming = false;
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data && data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
              }
            } catch {}
          }
        }
      }
    }

    session.deepResult = fullContent;
  } catch (error) {
    session.deepError = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    session.deepStreaming = false;
  }
}

// ============================================================
// 获取前端流（基于角色 + 情绪 + 事件，包含 fallback）
// ============================================================
function getFrontFlow(roleId: string, emotionTag: EmotionTag, eventTag: EventTag): FrontFlowItem[] {
  const roleFlows = frontFlows[roleId];
  if (!roleFlows) return getDefaultFlow(roleId);

  // 精确匹配：角色 + 情绪 + 事件
  const exact = roleFlows[emotionTag]?.[eventTag];
  if (exact) return exact;

  // 匹配：角色 + 情绪（不区分事件）
  const emotionAny = (roleFlows as any)[emotionTag]?.any;
  if (emotionAny) return emotionAny as FrontFlowItem[];

  // 匹配：角色 + 默认
  const defaultFlow = (roleFlows as any).default?.any;
  if (defaultFlow) return defaultFlow as FrontFlowItem[];

  // 全局 fallback
  return getDefaultFlow(roleId);
}

function getDefaultFlow(roleId: string): FrontFlowItem[] {
  const roleName = ROLE_NAMES[roleId] || '心理陪伴师';
  return [
    { delay: 0, text: `${roleName}在这里陪着你。` },
    { delay: 8, text: '愿意和我多说一些吗？' },
    { delay: 18, text: '我在听。' },
    { delay: 30, text: '有时候，说出来本身就有疗愈的力量。' },
    { delay: 45, text: '我们可以一起慢慢梳理。' },
  ];
}

// ============================================================
// 健康检查
// ============================================================
app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ============================================================
// 接口 1：POST /api/v1/chat/start
// 即时返回前端流 + 触发后台百炼调用
// ============================================================
app.post('/api/v1/chat/start', async (req, res) => {
  try {
    const { roleId, message } = req.body;

    if (!roleId || !message) {
      return res.status(400).json({ error: 'roleId and message are required' });
    }

    const roleName = ROLE_NAMES[roleId] || roleId;

    // 1. 情绪识别
    const emotionTag = recognizeEmotion(message);

    // 2. 事件识别
    const eventTag = recognizeEvent(message);

    // 3. 匹配前端流脚本
    const frontFlow = getFrontFlow(roleId, emotionTag, eventTag);

    // 4. 创建会话
    const sessionId = crypto.randomUUID();
    const session: ChatSession = {
      sessionId,
      roleId,
      roleName,
      userMessage: message,
      emotionTag,
      eventTag,
      frontFlow,
      createdAt: Date.now(),
      deepResult: null,
      deepStreaming: false,
      deepError: null,
    };
    sessions.set(sessionId, session);

    // 5. 立即返回前端流（不等待百炼）
    res.json({
      sessionId,
      frontFlow,
      emotionTag,
      eventTag,
    });

    // 6. 后台异步调用百炼（响应返回后触发）
    console.log(`[Start] Session ${sessionId}: role=${roleName}, emotion=${emotionTag}, event=${eventTag}`);
    startDeepAnalysis(session).catch(err => {
      console.error(`[Deep] Session ${sessionId} error:`, err);
      session.deepError = err instanceof Error ? err.message : 'Unknown error';
    });
  } catch (error) {
    console.error('[Start] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 接口 2：GET /api/v1/chat/stream?sessionId=xxx
// SSE 流式返回百炼深度分析结果
// ============================================================
app.get('/api/v1/chat/stream', (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 如果已经完成，直接返回结果
  if (session.deepResult) {
    res.write(`data: ${JSON.stringify({ type: 'deep', content: session.deepResult, done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // 如果有错误
  if (session.deepError && !session.deepStreaming) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: session.deepError, done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // 轮询等待百炼完成（SSE 长连接）
  const pollInterval = setInterval(() => {
    if (session.deepResult) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ type: 'deep', content: session.deepResult, done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else if (session.deepError && !session.deepStreaming) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ type: 'error', message: session.deepError, done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }, 1000);

  // 60秒超时
  const timeout = setTimeout(() => {
    clearInterval(pollInterval);
    res.write(`data: ${JSON.stringify({ type: 'timeout', done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, 60000);

  req.on('close', () => {
    clearInterval(pollInterval);
    clearTimeout(timeout);
  });
});

// ============================================================
// 调试端点：查看会话状态
// ============================================================
app.get('/api/v1/debug/last-prompt', (_req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    sessionId: s.sessionId,
    roleName: s.roleName,
    emotionTag: s.emotionTag,
    eventTag: s.eventTag,
    userMessage: s.userMessage.slice(0, 50),
    hasFlow: s.frontFlow.length > 0,
    deepReady: !!s.deepResult,
    deepStreaming: s.deepStreaming,
    deepError: s.deepError,
    age: Math.floor((Date.now() - s.createdAt) / 1000) + 's',
  }));

  res.json({
    sessions: sessionList,
    totalSessions: sessions.size,
  });
});

// ============================================================
// 启动服务
// ============================================================
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`DASHSCOPE_API_KEY: ${API_KEY_LIGHT ? 'SET' : 'NOT SET'}`);
  console.log(`DASHSCOPE_API_KEY_DEEP: ${API_KEY_DEEP ? 'SET' : 'NOT SET'}`);
});