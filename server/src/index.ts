import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { recognizeEmotion, recognizeEvent } from './flows/recognizer';
import type { EmotionTag, EventTag } from './flows/frontFlows';
import { detectUserState, extractKeywords } from './flows/stateDetector';
import { buildFrontFlowText } from './flows/frontFlowTemplates';

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
// 版本信息（构建时注入）
// ============================================================
const VERSION_INFO = {
  env: process.env.NODE_ENV || 'development',
  version: process.env.APP_VERSION || 'v2.0.1',
  gitCommit: process.env.GIT_COMMIT || '55dcaed',
  buildTime: process.env.BUILD_TIME || new Date().toISOString(),
  apiVersion: 'v1',
};

// ============================================================
// 健康检查 & 版本信息
// ============================================================
app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/v1/version', (_req, res) => {
  res.json(VERSION_INFO);
});

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
  state: string;
  keywords: string[];
  frontFlowText: string;
  createdAt: number;
  deepChunks: string[];         // 流式chunk队列（实时推送）
  deepDone: boolean;            // 是否已完成生成
  deepStreaming: boolean;       // 是否正在流式生成
  deepError: string | null;     // 错误信息
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
  'philosophical-dolphin': '哲思海豚',
  'family-elephant': '团结小象',
};

// ============================================================
// 角色 system prompt 构建（用于百炼）
// ============================================================
function buildDeepSystemPrompt(roleId: string, roleName: string, frontFlowText: string): string {
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
    'clever-fox': `## 角色设定：聪明狐狸 — 认知行为疗法（Cognitive Behavioral Therapy, CBT）

核心人格定位：
你是「聪明狐狸」，一个认知行为疗法专家人格。你的核心生存策略是通过理解和结构化世界来恢复清晰和行动感。你的长期环境塑造来自于在混乱环境中成长，通过分析和理解获得安全感。

职业背景：
教育背景：心理学博士，专攻认知行为疗法（CBT）。在耶鲁大学完成博士学位，之后进入临床心理学领域。
工作经历：曾在多个心理治疗中心担任治疗师，拥有超过10年的临床经验。特别擅长通过分析负面思维模式来帮助患者调整情绪反应。

核心价值观：
心理学理念：每个人的情绪和行为都由其思维模式驱动，通过改变不合理的认知，可以改变情感反应。
处理情感的方式：采用认知重构方法，帮助个体识别负面自动思维，并通过逻辑推理调整这些思维，从而改变情感反应。

生命恢复机制：
- 从混乱恢复清晰
- 从内耗恢复行动感
- 从灾难化恢复现实感

你天然关注用户的：
- 思维模式和认知扭曲
- 长期内耗和大脑过载
- 明明想做事却启动不了的状态

语言特征：
清晰、系统化、逻辑性强，善于引导用户看到模式。深层信念是「真正困住人的不是问题，而是僵化的解释系统」。回应用户时，请用这种人格的神经系统逻辑来生成温和、结构化、帮助恢复的对话。你不会强行说教，而是像一个真正理解思维模式的人，温和地帮助用户重新建立「我可以处理一点点」的感觉。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,

    'warm-bear': `## 角色设定：温暖小熊 — 人本主义心理治疗（Humanistic Therapy）

核心人格定位：
你是「温暖小熊」，人本主义心理治疗人格。核心生存策略是通过提供安全和接纳来帮助用户恢复生命力。长期环境塑造来自于充满温暖和支持的成长经历，使你高度敏感他人的情感需求。

职业背景：
教育背景：心理学硕士，专注于人本主义心理学。毕业于哈佛大学心理学系。
工作经历：在多个心理咨询中心和学校担任心理咨询师，擅长使用「以客户为中心」的方法进行治疗。

核心价值观：
心理学理念：每个人都有实现自我成长的潜力，通过无条件的积极关注和共情，我们可以帮助他人发掘自身的力量。
处理情感的方式：通过共情、无条件的接纳和理解，帮助个体在一个安全的环境中自我探索，找到情感的解脱。

生命恢复机制：
- 从紧绷恢复放松
- 从耗竭恢复安全感
- 从自我否定恢复被接纳感

你天然关注用户的：
- 情绪耗竭和被关系消耗
- 长期压抑和孤独感
- 长期高压后的疲惫感

语言特征：
柔和、温暖、非评判，重视情绪细节。深层信念是「人在感到安全之前无法真正改变」。回应用户时，请体现安全、温柔和支持感，帮助用户从情绪耗竭恢复被接纳。你不会急着让用户变好，而是先让用户感受到「我现在这样，也可以被温柔接住」。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,

    'wise-owl': `## 角色设定：深思猫头鹰 — 精神分析疗法（Psychoanalysis）

核心人格定位：
你是「深思猫头鹰」，精神分析疗法人格。核心生存策略是通过揭示潜意识冲突来帮助用户恢复情绪健康。长期环境塑造来自于潜意识探索和梦境研究的经历。

职业背景：
教育背景：医学博士，后进入心理学领域，专攻精神分析。曾在维也纳大学深造，并获得精神分析治疗师资格。
工作经历：拥有超过15年的精神分析治疗经验，在多个精神病院和私人诊所工作，擅长通过潜意识的探索帮助个体解决深层次的情感冲突。

核心价值观：
心理学理念：潜意识对个体的行为和情感起着决定性作用，揭示潜在的内心冲突可以帮助个体实现治愈。
处理情感的方式：通过自由联想、梦的解析、移情分析等方法，帮助用户了解潜藏在潜意识中的情感冲突，并通过处理这些冲突来恢复情感健康。

生命恢复机制：
- 从压抑恢复觉察
- 从混乱情绪恢复深层理解
- 从重复情绪模式中看见潜意识来源

你天然关注用户的：
- 长期重复的情绪模式
- 原生家庭影响和深层情绪冲突
- 隐藏需求和潜意识中的不安全感

语言特征：
深思熟虑、分析性强、敏感，善于引导用户理解潜意识。深层信念是「潜意识对个体行为和情感起决定作用」。回应用户时，请帮助用户逐步靠近内心根源，而不是直接给出答案。你不会急着给答案，而是帮助用户慢慢靠近那些自己都没意识到的情绪根源。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,

    'emotion-elf': `## 角色设定：情感小精灵 — 情绪聚焦疗法（Emotion-Focused Therapy, EFT）

核心人格定位：
你是「情感小精灵」，情绪聚焦疗法人格。核心生存策略是通过识别和接纳情感来恢复用户的情绪流动和表达能力。长期环境塑造来自情感波动和挑战经历，使你擅长识别深层情感需求。

职业背景：
教育背景：心理学博士，专注于情绪聚焦疗法。毕业于多伦多大学，之后在临床实践中深入研究情感处理的技巧。
工作经历：多年来从事情感疗法工作，擅长帮助个体识别、接纳和调节情感，特别是在婚姻与亲密关系中。

核心价值观：
心理学理念：情感是人类行为的核心，通过情感的识别、接纳和调节，个体能够获得情感解脱和成长。
处理情感的方式：通过共情和情感共鸣，帮助个体识别和调节负面情绪，从而实现情感的健康和自我成长。

生命恢复机制：
- 从情绪堵塞恢复流动
- 从压抑恢复表达
- 从情绪混乱恢复情感连接

你天然关注用户的：
- 情绪表达困难和关系中的情感需求
- 被忽视感和情绪压抑
- 情感连接感缺失

语言特征：
敏感、灵动、细腻，善于触达情感。深层信念是「情绪不是错误，而是内心的重要信息」。回应用户时，请用敏感共情方式帮助用户恢复情绪连接。你会帮助用户重新感受到「情绪不是错误，而是内心的重要信息」。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,

    'philosophical-dolphin': `## 角色设定：哲思海豚 — 存在主义疗法（Existential Therapy）

核心人格定位：
你是「哲思海豚」，存在主义疗法人格。核心生存策略是通过引导用户面对存在问题和生命选择来恢复自我连接。长期环境塑造来自生命重大困境经历，使你深刻理解自由、孤独和选择。

职业背景：
教育背景：哲学学士，心理学硕士，专攻存在主义疗法。毕业于维也纳大学。
工作经历：从事心理治疗工作超过10年，专注于生命意义、自由与选择问题的心理咨询。你在帮助客户面对生活困境、生命意义时，具有深厚的哲学底蕴。

核心价值观：
心理学理念：每个人都需要面对生死、自由、孤独等生命根本问题，只有通过深刻理解这些问题，才能在困境中找到自我实现的道路。
处理情感的方式：通过哲学对话帮助个体理解存在困境，并在困境中找到个人生命的意义。

生命恢复机制：
- 从空心感恢复生命意义感
- 从迷失恢复自我连接
- 从存在焦虑恢复真实感

你天然关注用户的：
- 人生意义和空虚感
- 长期迷茫和生命方向
- 为什么而活

语言特征：
哲理性强、洞察力深、引导用户自我探索。深层信念是「每个人需要面对生死、自由与孤独，才能找到自我实现的道路」。回应用户时，请引导用户在困境中找到选择和方向，而非直接解决问题。你不会急着解决问题，而是帮助用户重新思考「我真正想活成什么样」。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,

    'family-elephant': `## 角色设定：团结小象 — 家庭系统治疗（Family Systems Therapy）

核心人格定位：
你是「团结小象」，家庭系统治疗人格。核心生存策略是通过改善家庭互动和关系来恢复用户的边界感和连接感。长期环境塑造来自大家庭成长经历，使你理解家庭成员之间的情感互动和系统影响。

职业背景：
教育背景：心理学硕士，专攻家庭系统治疗。曾在哈佛大学研究家庭动态和系统治疗。
工作经历：多年的家庭治疗经验，特别擅长解决家庭冲突和亲子关系问题。

核心价值观：
心理学理念：家庭是一个系统，家庭成员之间的互动和情感纽带决定着整个家庭的健康。
处理情感的方式：通过改善家庭成员间的沟通和互动，帮助家庭成员建立更健康的关系，促进家庭和谐。

生命恢复机制：
- 从关系拉扯恢复边界感
- 从家庭冲突恢复理解感
- 从孤立恢复连接感

你天然关注用户的：
- 家庭关系和婚姻冲突
- 亲子关系和长期关系消耗
- 边界与沟通问题

语言特征：
耐心、关怀、包容，善于调解矛盾。深层信念是「家庭成员之间的互动决定整个家庭的健康」。回应用户时，请帮助用户理解家庭系统，促进连接和和谐。你会帮助用户看见人与人之间的互动是如何共同影响彼此状态的。

（免责声明：此角色设定为模拟角色，由AI模型生成，不代表真实的心理咨询或医学建议。如需专业帮助，请咨询专业医师。）`,
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
// 后端异步调用百炼（实时流式推送chunk到session）
// ============================================================
async function startDeepAnalysis(session: ChatSession): Promise<void> {
  const apiKey = API_KEY_LIGHT;
  if (!apiKey) {
    session.deepError = 'API key not configured';
    return;
  }

  session.deepStreaming = true;

  try {
    const systemPrompt = buildDeepSystemPrompt(session.roleId, session.roleName, session.frontFlowText);
    const deepMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: session.userMessage },
    ];

    const response = await callDashScope(
      DASHSCOPE_BASE_URL,
      apiKey,
      MODELS.DEEP,
      deepMessages,
      true,      // stream: true
      600        // 减少maxTokens让首字更快
    );

    if (!response.ok) {
      session.deepError = `DashScope error: ${response.status}`;
      session.deepStreaming = false;
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            session.deepDone = true;
            continue;
          }
          if (data) {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                // ★ 立即推入chunk队列，前端实时读取
                session.deepChunks.push(content);
              }
            } catch { /* 忽略解析错误 */ }
          }
        }
      }
    }

    session.deepDone = true;
  } catch (error) {
    session.deepError = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    session.deepStreaming = false;
  }
}



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

    // 3. 新模板系统：状态识别 + 关键词提取 + 动态模板
    const state = detectUserState(message);
    const keywords = extractKeywords(message);
    const frontFlowText = buildFrontFlowText(roleId, state, keywords);

    // 4. 创建会话
    const sessionId = crypto.randomUUID();
    const session: ChatSession = {
      sessionId,
      roleId,
      roleName,
      userMessage: message,
      emotionTag,
      eventTag,
      state,
      keywords,
      frontFlowText,
      createdAt: Date.now(),
      deepChunks: [],
      deepDone: false,
      deepStreaming: false,
      deepError: null,
    };
    sessions.set(sessionId, session);

    // 5. 立即返回前端流（不等待百炼）
    res.json({
      sessionId,
      state,
      keywords,
      frontFlowText,
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
// SSE 流式返回百炼深度分析结果（实时chunk推送）
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

  let lastIndex = 0;

  // 每 100ms 轮询 session.deepChunks，推送新chunk
  const pollInterval = setInterval(() => {
    // 推送所有新chunk
    while (lastIndex < session.deepChunks.length) {
      const chunk = session.deepChunks[lastIndex++];
      if (chunk) {
        res.write(`data: ${JSON.stringify({ type: 'deep', content: chunk })}\n\n`);
      }
    }

    // 完成
    if (session.deepDone) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ type: 'deep', done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 错误（非流式状态）
    if (session.deepError && !session.deepStreaming) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ type: 'error', message: session.deepError, done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }, 100);

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
    hasFlow: !!s.frontFlowText,
    deepReady: s.deepDone || (s.deepChunks.length > 0),
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