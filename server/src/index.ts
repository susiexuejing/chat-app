import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { recognizeEmotion, recognizeEvent } from './flows/recognizer';
import type { EmotionTag, EventTag } from './flows/frontFlows';
import { detectUserState, extractKeywords } from './flows/stateDetector';
import { buildFrontFlowText } from './flows/frontFlowTemplates';
import { extractSignal } from './flows/signalExtractor';
import { neuralManager } from './flows/neuralProfileManager';
import type { NeuralProfile } from './flows/neuralProfileManager';
import {
  generateReactionTimeline,
  generateCompanionTimeline,
} from './flows/localReactionEngine';
import { analyzeFlow, recordChange, getChangeBlock, getChangeTrends } from './flows/index';
import type { FlowResult, FlowContext, FlowContextType, FlowContextStage, FlowContextRisk } from './flows/flowTypes';
import { loadProfile, generateLTUSummary, updateProfile } from './flows/longTermUnderstanding';
import { adjustWeights, getDefaultWeights, logWeightChange } from './flows/personalityEvolution';
import type { ResponseWeights } from './flows/evolutionTypes';
import { buildDeepSystemPrompt } from './flows/deepSystemPromptBuilder';
import { validateEf41DeepOutput } from './flows/ef41DeepCompositionValidator';
import { incrementConversationTurn, incrementConversationTurnIdempotent, getConversationTurn } from './flows/conversationTurns';
import conversationsRouter from './routes/conversations.js';
import { mapSafeStreamError, serializeStreamEvent, TurnEventSequencer } from './contracts/streamEvents';
import type { StreamEventType, StreamPayloadByType } from './contracts/streamEvents';

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
  version: process.env.APP_VERSION || 'v2.1.2',
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
// EF-59: Conversation Persistence API
// ============================================================
app.use('/api/v1/conversations', conversationsRouter);

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
  reactionLayer: string;        // EmotionFlow V3: 人格自然第一反应
  companionLayer: string;       // EmotionFlow V3: 人格自然陪伴
  deepReadyAt: number;          // EmotionFlow V3: 百炼Deep层就绪时间戳（createdAt + 3s，动态缓冲）
  createdAt: number;
  deepChunks: string[];         // 流式chunk队列（实时推送）
  deepDone: boolean;            // 是否已完成生成
  deepStreaming: boolean;       // 是否正在流式生成
  deepError: string | null;     // 错误信息
  userId: string;               // 用户标识（用于神经档案）
  neuralProfile: NeuralProfile; // 当前用户神经状态
  flowResult: FlowResult | null; // Flow System 心理流向分析结果
  flowContext: FlowContext | null; // Step1: 结构化 FlowContext（用于 Deep prompt）
  eventSequencer: TurnEventSequencer; // EF-102: server-owned ordering for this turn
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

  // 60秒超时控制（Deep模型流式回复较慢）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// 后端异步调用百炼（实时流式推送chunk到session）
// ============================================================
async function startDeepAnalysis(session: ChatSession, userTurn: number = 3): Promise<void> {
  const apiKey = API_KEY_LIGHT;
  console.log(`[Deep] startDeepAnalysis called for session ${session.sessionId}, apiKey=${apiKey ? 'SET' : 'NOT SET'}, userTurn=${userTurn}`);
  if (!apiKey) {
    session.deepError = 'API key not configured';
    return;
  }

  session.deepStreaming = true;
  let streamStartTime = Date.now();

  try {
    const changeBlock = getChangeBlock(session.userId, session.roleId);
    // Load long-term understanding for this user+role
    const ltuProfile = await loadProfile(session.userId, session.roleId);
    const longTermSummary = generateLTUSummary(ltuProfile);
    const systemPrompt = buildDeepSystemPrompt(session.roleId, session.roleName, session.frontFlowText, session.neuralProfile, session.flowResult, changeBlock, session.flowContext, longTermSummary, userTurn, session.userMessage);
    const deepMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: session.userMessage },
    ];

    console.log(`[Deep] Calling DashScope API... model=${MODELS.DEEP}`);
    const response = await callDashScope(
      DASHSCOPE_BASE_URL,
      apiKey,
      MODELS.DEEP,
      deepMessages,
      true,      // stream: true
      1200       // max_tokens: 确保有足够空间输出中文回复
    );

    console.log(`[Deep] DashScope response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[Deep] DashScope error: ${response.status} - ${errorText}`);
      session.deepError = `DashScope error: ${response.status} - ${errorText.substring(0, 200)}`;
      session.deepStreaming = false;
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      console.error(`[Deep] No reader from DashScope response`);
      session.deepError = 'No response reader';
      session.deepStreaming = false;
      return;
    }
    const decoder = new TextDecoder();
    let reasoningBuffer = '';
    let deepContentBuffer = '';  // 累积所有content（含推理过程），流结束后清洗再推送
    let firstTokenTime = 0;
    let usedFallback = false;
    let streamTimeout: ReturnType<typeof setTimeout> | null = null;
    console.log(`[Deep] Stream start for session ${session.sessionId}`);

    // 60秒流读取超时（Deep模型首次token可能需要较长时间）
    const streamReadTimeout = new Promise<void>((_, reject) => {
      streamTimeout = setTimeout(() => reject(new Error('Stream read timeout (60s)')), 60000);
    });

    const streamReadLoop = (async () => {
      console.log(`[Deep] Stream start for session ${session.sessionId}`);
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            if (data) {
              try {
                const parsed = JSON.parse(data);
                // 优先取 content（最终回复）
                const content = parsed.choices?.[0]?.delta?.content ||
                                parsed.output?.choices?.[0]?.delta?.content || '';
                if (content) {
                  if (firstTokenTime === 0) {
                    firstTokenTime = Date.now();
                    console.log(`[Deep] First token received for session ${session.sessionId} (${firstTokenTime - streamStartTime}ms)`);
                  }
                  deepContentBuffer += content;
                } else {
                  // 累积 reasoning_content（推理模型将输出放在此字段）
                  const rc = parsed.choices?.[0]?.delta?.reasoning_content ||
                             parsed.output?.choices?.[0]?.delta?.reasoning_content || '';
                  if (rc) {
                    reasoningBuffer += rc;
                  } else {
                    console.log(`[Deep] Raw SSE line (no content): ${data.substring(0, 80)}`);
                  }
                }
              } catch {
                console.log(`[Deep] Parse error for line: ${data.substring(0, 80)}`);
              }
            }
          } else if (line.trim()) {
            // 非标准SSE格式的日志
            console.log(`[Deep] Non-SSE line: ${line.substring(0, 100)}`);
          }
        }
      }
    })();

    try {
      await Promise.race([streamReadLoop, streamReadTimeout]);
    } catch (e) {
      console.error(`[Deep] Stream error/timeout:`, e);
      // 超时或出错时仍然标记完成，让前端能拿到已缓存的chunks
    }
    if (streamTimeout) clearTimeout(streamTimeout);

    // ── 内容清洗：仅保留最终中文回复 ──
    // qwen3.6-plus 将推理过程混在 content 字段中，
    // 需要清洗掉 "Here's a thinking process" 等英文推理，
    // 只保留最终中文回复
    const cleaned = extractFinalChineseResponse(deepContentBuffer);
    if (cleaned.trim()) {
      session.deepChunks.push(validateEf41DeepOutput({
        text: cleaned,
        roleId: session.roleId,
        userTurn,
        userMessage: session.userMessage,
        source: 'cleaned',
      }));
      console.log(`[Deep] Cleaned content: ${cleaned.length} chars (raw: ${deepContentBuffer.length} chars)`);
    } else if (deepContentBuffer.trim()) {
      // 🛡️ 极兜底：清洗返回空但原始内容不为空 → 截取最后300字
      const last300 = deepContentBuffer.slice(-300).trim();
      const cjk = last300.match(/[\u4e00-\u9fff]/g);
      if (cjk && cjk.length >= 10) {
        session.deepChunks.push(validateEf41DeepOutput({
          text: last300,
          roleId: session.roleId,
          userTurn,
          userMessage: session.userMessage,
          source: 'last-resort',
        }));
        console.log(`[Deep] Last-resort fallback: ${last300.length} chars (${cjk.length} CJK)`);
      } else {
        console.log(`[Deep] Cleaning returned empty AND no CJK in last 300 chars (raw: ${deepContentBuffer.length} chars)`);
      }
    }

    // 如果 content 流为空但累积了 reasoning_content（推理模型），
    // 将 reasoning_content 作为最终内容推给前端
    if (session.deepChunks.length === 0 && reasoningBuffer.trim()) {
      session.deepChunks.push(validateEf41DeepOutput({
        text: reasoningBuffer.trim(),
        roleId: session.roleId,
        userTurn,
        userMessage: session.userMessage,
        source: 'reasoning',
      }));
      const duration = Date.now() - streamStartTime;
      console.log(`[Deep] Fallback: used reasoning_content (${reasoningBuffer.length} chars, took ${duration}ms)`);
    }

    session.deepDone = true;
    const completionDuration = Date.now() - streamStartTime;
    const firstTokenDelay = firstTokenTime > 0 ? (firstTokenTime - streamStartTime) : -1;
    const hasContent = session.deepChunks.length > 0;
    const wasFallback = !hasContent && reasoningBuffer.trim().length > 0;
    console.log(`[Deep] Stream complete for session ${session.sessionId} ` +
      `(total: ${completionDuration}ms, firstToken: ${firstTokenDelay}ms, ` +
      `chunks: ${session.deepChunks.length}ch, content: ${(session.deepChunks.join('').length)}ch, fallback: ${wasFallback})`);

    // ── Step 3: 更新 Long-Term Understanding ──
    try {
      const deepOutput = session.deepChunks.join('');
      updateProfile(session.userId, session.roleId, {
        userInput: session.userMessage,
        state: session.state,
        keywords: session.keywords,
        emotionTag: session.emotionTag,
        eventTag: session.eventTag,
        flowType: session.flowContext?.flowType,
        flowStage: session.flowContext?.flowStage,
        deepSummary: cleaned,
      });
    } catch (ltuErr) {
      console.error(`[Deep] LTU update error:`, ltuErr instanceof Error ? ltuErr.message : ltuErr);
    }

    // ── [Dev-Only] Step 4: Personality Evolution 实验 ──
    if (process.env.NODE_ENV === 'development') {
      try {
        const trendData = getChangeTrends(session.userId, session.roleId);

        // 重新读取最新LTU（Deep已完成并更新，避免使用stale profile）
        let freshLtu = ltuProfile;
        try {
          const reloaded = await loadProfile(session.userId, session.roleId);
          if (reloaded && reloaded.totalInteractions > (ltuProfile?.totalInteractions ?? 0)) {
            freshLtu = reloaded;
          }
        } catch { /* 回退到旧profile */ }

        // 从 evolution 日志加载当前权重
        const evolutionDir = path.join(process.cwd(), 'data', 'evolution');
        const logPath = path.join(evolutionDir, `${session.userId}_${session.roleId}.jsonl`);
        let currentWeights: ResponseWeights | null = null;
        if (fs.existsSync(logPath)) {
          const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
          if (lines.length > 0) {
            const last = JSON.parse(lines[lines.length - 1]);
            currentWeights = last.weights;
          }
        }

        const result = adjustWeights(
          session.userId,
          session.roleId,
          session.flowContext ?? null,
          {
            totalInteractions: freshLtu?.totalInteractions ?? 0,
            recurringFlowPatterns: freshLtu?.recurringFlowPatterns ?? [],
            emotionalTriggers: freshLtu?.emotionalTriggers ?? [],
            roleSpecific: (freshLtu?.roleSpecific as unknown as { roleId: string; data: Record<string, string[]> } | undefined) ?? undefined,
          },
          trendData,
          currentWeights,
        );

        // 记录 JSONL 快照
        logWeightChange(session.userId, session.roleId, {
          timestamp: result.weights.updatedAt,
          weights: result.weights,
          trigger: result.trigger,
          flowContext: session.flowContext ? {
            flowType: session.flowContext.flowType ?? 'unknown',
            flowStage: session.flowContext.flowStage ?? 'unknown',
            flowStrength: session.flowContext.flowStrength ?? 0,
            flowConfidence: session.flowContext.flowConfidence ?? 0,
          } : null,
          trendData,
        });

        console.log(`[Evolution] ${session.roleId}[${session.userId}] weights updated: ${result.trigger.factor} (${result.trigger.detail.slice(0, 80)})`);
      } catch (e) { /* evolution experiment */ }
    }

  } catch (error) {
    const errTime = Date.now() - streamStartTime;
    console.error(`[Deep] Error in startDeepAnalysis (at ${errTime}ms):`, error instanceof Error ? error.message : error);
    session.deepError = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    session.deepStreaming = false;
  }
}



// ─── 构建结构化 FlowContext（替代纯文本 frontFlowText 注入 Deep prompt）─
// 将 emotionTag / eventTag / state 映射为 FlowContext JSON
function buildFlowContext(state: string, emotionTag: string, eventTag: string, keywords: string[]): FlowContext {
  // 1) 映射 flowType
  const flowType = ((): FlowContextType => {
    // 自我怀疑/自责 → self_blame
    if (state === 'self_doubt' || emotionTag === 'guilt') return 'self_blame';
    // 愤怒/受伤 → anger_to_hurt
    if (state === 'anger' || emotionTag === 'anger' || emotionTag === 'hurt') return 'anger_to_hurt';
    // 关系冲突
    if (state === 'relationship_conflict' || eventTag === 'relationship_conflict' || eventTag === 'family_issue') return 'relationship_conflict';
    // 依恋焦虑（优先于普通 anxiety，防止被 anxiety_overwhelm 覆盖）
    if (state === 'attachment_anxiety') return 'attachment_anxiety';
    // 无力/失控 → control_to_helplessness
    if (state === 'helplessness') return 'control_to_helplessness';
    // 焦虑/恐惧 → anxiety_overwhelm
    if (state === 'anxiety' || emotionTag === 'anxiety' || emotionTag === 'fear') return 'anxiety_overwhelm';
    // 身体紧绷
    if (state === 'body_tension') return 'body_tension';
    // 悲伤/孤立
    if (state === 'sadness' || emotionTag === 'sadness') return 'sadness_isolation';
    // 孤独 → 依恋焦虑兜底
    if (emotionTag === 'loneliness' || eventTag === 'loneliness_event') return 'attachment_anxiety';
    // 迷茫 → analysis_to_feeling
    if (emotionTag === 'confusion') return 'analysis_to_feeling';
    return 'general_flow';
  })();

  // 2) 初始 stage 总是 beginning（后续轮次由 Deep 分析更新）
  const flowStage: FlowContextStage = 'beginning';

  // 3) flowStrength: 基于 emotionTag 是否精确匹配 + 消息长度
  const isExactEmotion = (
    (state === 'attachment_anxiety' && emotionTag === 'attachment_anxiety') ||
    (state === 'helplessness' && emotionTag === 'helplessness') ||
    (state === 'anger' && emotionTag === 'anger') ||
    (state === 'sadness' && emotionTag === 'sadness') ||
    (state === 'anxiety' && emotionTag === 'anxiety') ||
    (state === 'self_doubt' && (emotionTag === 'guilt' || eventTag === 'self_doubt')) ||
    (state === 'relationship_conflict' && (eventTag === 'relationship_conflict' || eventTag === 'family_issue'))
  );
  const lengthFactor = Math.min(keywords.join('').length / 30, 0.3);
  const flowStrength = Math.min((isExactEmotion ? 0.5 : 0.3) + lengthFactor, 0.9);

  // 4) flowConfidence
  const flowConfidence = isExactEmotion ? 0.6 + lengthFactor : 0.35 + lengthFactor;

  // 5) flowRisk: 检测升级风险/反刍风险
  const fullText = keywords.join(' ');
  let flowRisk: FlowContextRisk | undefined;
  if (/想死|活不下去|死了算了|自杀|不想活了|撑不住了/.test(fullText)) {
    flowRisk = 'escalating';
  } else if (/反复想|一直想|停不下来|越想越|钻牛角尖/.test(fullText)) {
    flowRisk = 'rumination';
  }

  return { flowType, flowStage, flowStrength: Math.round(flowStrength * 100) / 100, flowConfidence: Math.round(flowConfidence * 100) / 100, flowRisk, keywords };
}

// ─── 内容清洗：提取最终中文回复 ────────────────────────
// qwen3.6-plus 可能把完整的思考链（Here's a thinking process…）写在 content 字段，
// 思考过程中也会包含中文（如引用用户输入或写草稿），因此不能简单地按"第一个中文行"截断。
// 策略：从尾部反向扫描，找到最后一个中文密集的段落块作为最终回复
// 核心原则：绝不返回 raw 原始内容（无中文则返回空字符串）
function extractFinalChineseResponse(raw: string): string {
  if (!raw || raw.length < 20) return '';

  const thinkingMarkers = [
    "here's a thinking process",
    "here is a thinking process",
    "thinking process",
    "let me think",
    "analyze user input",
    "check constraints",
    "draft construction",
    "final polish",
    "step-by-step",
    "reason carefully",
    "let me break this down",
    "i'll start by",
    "first, let me",
  ];

  const hasThinkingMarker = thinkingMarkers.some(m =>
    raw.toLowerCase().includes(m)
  );

  // 按空行分割段落
  const paragraphs = raw.split(/\n\s*\n/);

  if (hasThinkingMarker) {
    // ── 有思考标记 → 行级别截取（更鲁棒） ──
    // 核心策略：按行切分 → 找到最后一个编号行（"N. **..."）→ 取之后的所有行
    // 无论模型是否使用\n\n分隔，都能正确处理

    const lines = raw.split('\n');
    const numberedLine = /^\s*\d+\.\s+/;   // 行首数字编号
    const endMarkers = [
      /proceeds\.?\s*$/i,
      /all good\.?\s*$/i,
      /output matches/i,
      /ready\.?\s*$/i,
    ];

    // 1. 找到最后一行编号行 或 结束标记行
    let lastStructureLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (numberedLine.test(trimmed) || endMarkers.some(m => m.test(trimmed))) {
        lastStructureLine = i;
      }
    }

    // 2. 取最后一个结构行之后的所有内容
    const afterStructure = lastStructureLine >= 0
      ? lines.slice(lastStructureLine + 1).join('\n').trim()
      : '';

    // 3. 如果截取到了内容，按段落过滤中文
    if (afterStructure.length > 0) {
      const responseParagraphs = afterStructure.split('\n\n').filter(p => p.trim());
      const chineseParagraphs = responseParagraphs.filter(p => {
        const chineseChars = p.match(/[\u4e00-\u9fff]/g);
        if (!chineseChars) return false;
        const totalVisible = p.replace(/\s/g, '').length;
        return totalVisible > 0 && chineseChars.length / totalVisible >= 0.3;
      });
      if (chineseParagraphs.length > 0) {
        const result = chineseParagraphs.join('\n\n');
        console.log(`[Clean] Extracted ${result.length} chars (thinking→last numbered line: ${lastStructureLine})`);
        return result;
      }
      // 兜底：最后一段≥5中文字
      for (let i = responseParagraphs.length - 1; i >= 0; i--) {
        const cjk = responseParagraphs[i].match(/[\u4e00-\u9fff]/g);
        if (cjk && cjk.length >= 5) {
          console.log(`[Clean] Fallback: took last para after structure (${cjk.length} CJK chars)`);
          return responseParagraphs[i].trim();
        }
      }
    }

    // 4. 🛡️ 极兜底：全文中最后一段≥5中文字的内容（无结构行时）
    //    处理 "Here's a thinking process: 1.  **Analyze...**" 同一段落的情况
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const cjk = paragraphs[i].match(/[\u4e00-\u9fff]/g);
      if (cjk && cjk.length >= 8) {
        // 检查此段是否包含编号行（如仍在思考过程中）
        const paraLines = paragraphs[i].split('\n');
        const hasNumbered = paraLines.some(l => numberedLine.test(l.trim()));
        if (!hasNumbered) {
          console.log(`[Clean] Extreme fallback: took para ${i} (${cjk.length} CJK chars, no numbered lines)`);
          return paragraphs[i].trim();
        }
      }
    }

    console.log(`[Clean] Has thinking marker, no reliable Chinese (${raw.length} raw chars)`);
    return '';
  }

  // ── 无思考标记 → 正常清洗：保留中文占比≥30%的段落 ──
  const chineseParagraphs = paragraphs.filter(p => {
    const chineseChars = p.match(/[\u4e00-\u9fff]/g);
    if (!chineseChars) return false;
    const totalVisible = p.replace(/\s/g, '').length;
    return totalVisible > 0 && chineseChars.length / totalVisible >= 0.3;
  });

  if (chineseParagraphs.length > 0) {
    const result = chineseParagraphs.join('\n\n');
    console.log(`[Clean] Extracted ${result.length} Chinese chars from ${raw.length} raw chars (${paragraphs.length}→${chineseParagraphs.length} paragraphs)`);
    return result;
  }

  // 🛡️ 二次兜底：取最后一段≥5个中文字的内容
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const cjk = paragraphs[i].match(/[\u4e00-\u9fff]/g);
    if (cjk && cjk.length >= 5) {
      console.log(`[Clean] Fallback: took last Chinese paragraph (${cjk.length} CJK chars)`);
      return paragraphs[i].trim();
    }
  }

  console.log(`[Clean] No Chinese paragraphs found in ${raw.length} raw chars, returning empty`);
  return '';
}


// ─── normal_chat 检测 ──────────────────────────────────
// 纯问候/询问人格身份，不应进入情感支持流程
function isNormalChat(message: string): boolean {
  const trimmed = message.trim();
  // 纯问候语
  if (/^(你好|您好|嗨|hi|hello|hey|早上好|下午好|晚上好|晚安|早[啊呀]?)$/i.test(trimmed)) return true;
  // 询问你是谁/你叫什么/你是什么
  if (/你(是|叫|的名字)[什么谁]|你是谁|你叫什么/.test(trimmed)) return true;
  // 问你在做什么/你今天做了什么等日常闲聊
  if (/你(今天|最近|现在)?(在|都)?(做了?|干|忙|想)什么/.test(trimmed)) return true;
  if (/你在(干嘛|干什么)/.test(trimmed)) return true;
  // 单纯夸赞/寒暄（不含情绪包袱）
  if (/^(你真?|你好?)(棒|厉害|可爱|聪明|有趣|好|帅|漂亮)/.test(trimmed)) return true;
  // 询问你今天做什么/你在干嘛
  if (/你(今天|最近|在).{0,8}(做|干|忙)什/.test(trimmed)) return true;
  // 纯问候+角色名
  if (/^(你好|您好).{0,10}(狐狸|熊|猫头鹰|小精灵|海豚|小象|小精灵)$/.test(trimmed)) return true;
  // 今天的天气/话题无关内容
  if (/今天天气|你吃了[吗嘛]|你多大了|你几岁/.test(trimmed)) return true;
  return false;
}

// normal_chat 的引导回复
// 注意：reaction 必须为空字符串，否则前端优先级 reactionLayer > frontFlowText 会先展示 reaction
function getNormalChatResponse(roleId: string): { frontFlow: string; reaction: string; companion: string } {
  const responses: Record<string, { frontFlow: string; reaction: string; companion: string }> = {
    'clever-fox': {
      frontFlow: '我是聪明狐狸。\n\n我最擅长的事，是把一团乱麻慢慢理出线头。你说的话里哪怕只有几个字，我都能看到背后的结构和逻辑——这不是分析你，是我天生对"模式"敏感。\n\n如果你心里有什么绕来绕去的事、反复想也想不通的问题，或者不知道该怎么理清头绪的时候，可以放在我这里。我不替你做决定，但我能帮你把局面看清楚。\n\n你可以直接从最乱的那一块开始说，也可以从最轻的那一句说起。怎么说都行，我接得住。',
      reaction: '',
      companion: '',
    },
    'warm-bear': {
      frontFlow: '我是温暖小熊。\n\n我没有那么多分析，也不急着帮你找答案。我更在意的是——你现在感觉怎么样。你不用什么都想好了再来说，带着情绪来也没关系，我这里不需要你"整理好自己"。\n\n如果你累了、烦了、或者只是想让某件事有个地方放着，这里就是那个地方。我不会催你，也不会觉得你小题大做。\n\n你坐着就好，想说什么慢慢说。不想说的时候，我也在。',
      reaction: '',
      companion: '',
    },
    'wise-owl': {
      frontFlow: '我是深思猫头鹰。\n\n我比较擅长听那些没说完的话，也会留意一句话背后反复出现的东西。我不急着给你答案，也不会马上劝你怎么做。\n\n如果你愿意，可以把最近一直绕在心里的事放在这里。说不清也没关系，我会陪你慢慢看。很多问题不是一下子想明白的，是说着说着、看着看着，自己慢慢清晰起来的。\n\n你从哪儿说起都行。我在这儿听着。',
      reaction: '',
      companion: '',
    },
    'emotion-elf': {
      frontFlow: '我是情感小精灵。\n\n我能感受到你心里的温度——哪怕你自己还没说出口，我就能捕捉到那些细小的情绪变化。你不用急着解释，也不用给自己找理由。\n\n我就是你的情绪容器。你心里那些说不清的紧、沉、痛、空——都可以放在我这里。不需要你消化好了再来，带着所有情绪来就行。我接得住。\n\n你现在可以试着感受一下自己：心里那个最明显的感觉是什么？不用说出来，先感受它。然后，如果你想，可以跟我聊聊那是什么。',
      reaction: '',
      companion: '',
    },
    'empathy-fairy': {
      frontFlow: '我是情感小精灵。\n\n我能感受到你心里的温度——哪怕你自己还没说出口，我就能捕捉到那些细小的情绪变化。你不用急着解释，也不用给自己找理由。\n\n我就是你的情绪容器。你心里那些说不清的紧、沉、痛、空——都可以放在我这里。不需要你消化好了再来，带着所有情绪来就行。我接得住。\n\n你现在可以试着感受一下自己：心里那个最明显的感觉是什么？不用说出来，先感受它。然后，如果你想，可以跟我聊聊那是什么。',
      reaction: '',
      companion: '',
    },
    'philosophical-dolphin': {
      frontFlow: '我是哲思海豚。\n\n我喜欢陪人一起看看远方。有些问题在原来的位置上怎么想也想不通，但换个角度、拉远一点看，可能就不一样了。\n\n如果你感觉自己被困在某个问题里、或者对生活的方向感到模糊，我可以陪你一起游到高处看一看。不是给答案，是帮你看到更大的图景。\n\n你不用急着定义"问题是什么"，从你最近的感受说起就行。有时候答案藏在问题之外。',
      reaction: '',
      companion: '',
    },
    'family-elephant': {
      frontFlow: '我是团结小象。\n\n我最在意人与人之间的连接。我习惯帮人扛一点重量，不是替你做决定，而是让你知道——你不用一个人撑着。\n\n生活里最难的事，往往不是事情本身，是你一个人扛了太久。如果你身边的关系让你觉得累、觉得委屈、或者不知道该往哪儿放，你都可以告诉我。\n\n先说出来就行。说出来就是第一步。剩下的我们慢慢看。',
      reaction: '',
      companion: '',
    },
  };
  return responses[roleId] || {
    frontFlow: `我是${ROLE_NAMES[roleId] || roleId}，很高兴认识你！`,
    reaction: '',
    companion: '',
  };
}

// ============================================================
// 接口 1：POST /api/v1/chat/start
// 即时返回前端流 + 触发后台百炼调用
// ============================================================
app.post('/api/v1/chat/start', async (req, res) => {
  try {
    const { roleId, message, userId: reqUserId, conversationId } = req.body;
    const userId = reqUserId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!roleId || !message) {
      return res.status(400).json({ error: 'roleId and message are required' });
    }

    // EM-43: 验证 conversationId 格式
    if (conversationId !== undefined) {
      if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversationId: must be 1-100 alphanumeric/underscore/hyphen characters' });
      }
    }

    // EM-43: 递增会话轮数（幂等，支持 requestId）
    const { requestId } = req.body;
    let userTurn = 1;
    if (conversationId) {
      userTurn = incrementConversationTurnIdempotent(conversationId, requestId);
    }

    const roleName = ROLE_NAMES[roleId] || roleId;
    const neuralProfile = neuralManager.getOrCreateProfile(userId, roleId);

    // 0. 检测 normal_chat（纯问候/问身份，不走情感支持）
    const normalChat = isNormalChat(message);

    let emotionTag: EmotionTag;
    let eventTag: EventTag;
    let state: any;
    let keywords: string[];
    let frontFlowText: string;
    let reactionLayer: string;
    let companionLayer: string;
    let reactionTimeline: Array<{displayAt: number; text: string}> | undefined;
    let companionTimeline: Array<{displayAt: number; text: string}> | undefined;
    let deepReadyAt: number;
    let deepDone: boolean;
    let deepStreaming: boolean;
    let flowContext: FlowContext | null = null;

    if (normalChat) {
      // normal_chat：不走情感识别，不走深度分析
      emotionTag = 'general';
      eventTag = 'general';
      state = {};
      keywords = [];
      const nc = getNormalChatResponse(roleId);
      frontFlowText = nc.frontFlow;
      reactionLayer = nc.reaction;
      companionLayer = nc.companion;
      reactionTimeline = undefined;
      companionTimeline = undefined;
      deepReadyAt = Date.now();
      deepDone = true;
      deepStreaming = false;
      flowContext = null; // normal_chat 不生成 flowContext
    } else {
      // 1. 情绪识别
      emotionTag = recognizeEmotion(message);
      // 2. 事件识别
      eventTag = recognizeEvent(message);
      // 3. 状态识别 + 关键词提取
      state = detectUserState(message);
      keywords = extractKeywords(message);
      frontFlowText = buildFrontFlowText(roleId, state, keywords);

      // 3.5 生成结构化 FlowContext（替代纯文本 frontFlowText 注入 Deep prompt）
      flowContext = buildFlowContext(state, emotionTag, eventTag, keywords);

      // 4. EmotionFlow V3: 本地秒回引擎（零百炼依赖）
      const signal = extractSignal(message);
      reactionTimeline = generateReactionTimeline(roleId, message, signal, userTurn);
      companionTimeline = generateCompanionTimeline(roleId, message, signal, userTurn);
      reactionLayer = reactionTimeline[0]?.text || frontFlowText.split('。')[0] + '。';
      companionLayer = companionTimeline[0]?.text || frontFlowText;

      deepReadyAt = Date.now() + 3000;  // 3秒后开始推送Deep层
      deepDone = false;
      deepStreaming = false;
    }

    // 5. 创建会话
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session: ChatSession = {
      sessionId,
      userId,
      neuralProfile,
      roleId,
      roleName,
      userMessage: message,
      emotionTag,
      eventTag,
      state,
      keywords,
      frontFlowText,
      reactionLayer,
      companionLayer,
      deepReadyAt,
      createdAt: now,
      deepChunks: [],
      deepDone,
      deepStreaming,
      deepError: null,
      flowResult: null,
      flowContext,
      eventSequencer: new TurnEventSequencer(),
    };
    sessions.set(sessionId, session);

    // 6. 立即返回前端流 + R+C + 时间线模板 + FlowContext（不等待百炼）
    res.json({
      sessionId,
      userTurn,
      state,
      keywords,
      frontFlowText,
      emotionTag,
      eventTag,
      reactionLayer,
      companionLayer,
      reactionTimeline,
      companionTimeline,
      flowContext: flowContext ? {
        flowType: flowContext.flowType,
        flowStage: flowContext.flowStage,
        flowStrength: flowContext.flowStrength,
        flowConfidence: flowContext.flowConfidence,
        flowRisk: flowContext.flowRisk || null,
      } : null,
    });

    // 7. 后台异步调用百炼（normal_chat 跳过深度分析）
    if (normalChat) {
      console.log(`[Start] Session ${sessionId}: NORMAL_CHAT role=${roleName}, skipped deep analysis`);
    } else {
      console.log(`[Start] Session ${sessionId}: role=${roleName}, emotion=${emotionTag}, event=${eventTag}`);

      // 7a. Flow System 心理流向分析
      try {
        session.flowResult = analyzeFlow(userId, roleId, message);
        console.log(`[Flow] Session ${sessionId}: pattern=${session.flowResult.primaryFlow?.flowType || 'none'}, status=${session.flowResult.status}`);

        // 7a'. Change System 用户变化感知
        const changeSnapshot = recordChange(userId, roleId, session.flowResult);
        if (changeSnapshot) {
          console.log(`[Change] Session ${sessionId}: dir=${changeSnapshot.patternDelta.directionChange}, Δatt=${changeSnapshot.positionDelta.attributionDelta}, Δage=${changeSnapshot.positionDelta.agencyDelta}`);
        } else {
          console.log(`[Change] Session ${sessionId}: first record (no change snapshot)`);
        }
      } catch (flowErr) {
        console.error(`[Flow] Session ${sessionId} error:`, flowErr);
        session.flowResult = null;
      }

      startDeepAnalysis(session, userTurn).catch(err => {
        console.error(`[Deep] Session ${sessionId} error:`, err);
        session.deepError = err instanceof Error ? err.message : 'Unknown error';
      });
    }
  } catch (error) {
    console.error('[Start] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 接口 2：GET /api/v1/chat/stream?sessionId=xxx
// SSE 流式返回人格陪伴流 + 百炼深度分析结果（动态缓冲）
// 前端首选展示 Reaction + Companion 时间线，一旦百炼就绪立即接管
// 不再固定90秒等待，百炼返回多快接管多快
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

  const emit = <T extends StreamEventType>(
    eventType: T,
    payload: StreamPayloadByType[T],
  ) => {
    const event = session.eventSequencer.next(eventType, payload);
    res.write(serializeStreamEvent(event));
  };

  emit('turn.started', {
    sessionId: session.sessionId,
    deepReadyAt: session.deepReadyAt,
    reactionLayer: session.reactionLayer || '',
    companionLayer: session.companionLayer || '',
    flowContext: session.flowContext ? {
      flowType: session.flowContext.flowType,
      flowStage: session.flowContext.flowStage,
      flowStrength: session.flowContext.flowStrength,
      flowConfidence: session.flowContext.flowConfidence,
      flowRisk: session.flowContext.flowRisk || null,
    } : null,
  });
  emit('reaction', { content: session.reactionLayer || '' });
  emit('companion', { content: session.companionLayer || '' });

  let lastIndex = 0;
  let lastHeartbeat = Date.now();

  // 每 100ms 轮询 session.deepChunks，推送新chunk（但前90秒不发）
  const pollInterval = setInterval(() => {
    const now = Date.now();

    // 动态缓冲期内：只发心跳，不发deep chunks
    if (now < session.deepReadyAt) {
      // 每5秒发一次心跳保持连接
      if (now - lastHeartbeat >= 5000) {
        res.write(': keepalive\n\n');
        lastHeartbeat = now;
      }
      return;
    }

    // 缓冲期后：开始推送缓存的deep chunks
    while (lastIndex < session.deepChunks.length) {
      const chunk = session.deepChunks[lastIndex++];
      if (chunk) {
        emit('deep.delta', { content: chunk });
      }
    }

    // 完成
    if (session.deepDone) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      emit('deep.completed', {});
      emit('turn.completed', { status: 'completed' });
      res.end();
      return;
    }

    // 错误（非流式状态）
    if (session.deepError && !session.deepStreaming) {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      emit('error', mapSafeStreamError('deep_response_failed'));
      res.end();
      return;
    }
  }, 100);

  // 150秒超时（90秒缓存 + 60秒流式传输）
  const timeout = setTimeout(() => {
    clearInterval(pollInterval);
    emit('error', mapSafeStreamError('stream_timeout'));
    res.end();
  }, 150000);

  req.on('close', () => {
    clearInterval(pollInterval);
    clearTimeout(timeout);
    // 保存用户神经档案
    try {
      if (session.userId && session.neuralProfile) {
        neuralManager.updateAfterSession(session.userId, session.roleId, session.userMessage, session.deepChunks.join(''));
        neuralManager.saveProfiles();
      }
    } catch (e) {
      // 静默失败，不影响用户体验
    }
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
  neuralManager.loadProfiles();
  console.log(`DASHSCOPE_API_KEY: ${API_KEY_LIGHT ? 'SET' : 'NOT SET'}`);
  console.log(`DASHSCOPE_API_KEY_DEEP: ${API_KEY_DEEP ? 'SET' : 'NOT SET'}`);
});
