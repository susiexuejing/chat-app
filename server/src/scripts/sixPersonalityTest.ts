// @ts-nocheck
/**
 * 六人格同消息对比测试
 * 并行发送相同消息到6个人格，捕获Reaction+Companion+Deep
 */
const BASE_URL_6 = 'http://localhost:9091';
const DEEP_TIMEOUT_6 = 35000;

const PERSONALITIES_6 = [
  { id: 'clever-fox',          label: '🦊 狐狸(CBT)' },
  { id: 'warm-bear',           label: '🐻 熊(人本)' },
  { id: 'wise-owl',            label: '🦉 猫头鹰(精神分析)' },
  { id: 'emotion-elf',         label: '🧚 精灵(EFT)' },
  { id: 'philosophical-dolphin', label: '🐬 海豚(存在主义)' },
  { id: 'family-elephant',    label: '🐘 象(家庭治疗)' },
];

const CONVERSATION_6 = [
  "最近总觉得很累，早上起不来，晚上睡不着",
  "工作压力太大了，老板天天催进度",
  "我其实也说不清楚到底在焦虑什么",
  "可能是对自己要求太高了，总觉得不够好",
  "小时候爸妈对我特别严格，很少夸我",
  "我现在做什么都怕做错，追求完美到累",
  "有时候会突然心慌，感觉喘不过气",
  "我试过冥想，但坚持不下来",
  "朋友说我太敏感了，但我觉得他们不懂",
  "其实我就想要有人能真正理解我",
];

interface StartResponse {
  sessionId: string;
  emotionTag: string;
  reactionLayer?: string;
  companionLayer?: string;
}

interface DeepResult {
  content: string;
  success: boolean;
}

interface PersonalityResult {
  sessionId: string;
  personalityId: string;
  round: number;
  message: string;
  reactionLayer: string;
  companionLayer: string;
  deepContent: string;
  deepChars: number;
  deepSuccess: boolean;
  emotionTag: string;
}

interface PersonalitySummary {
  personality: string;
  label: string;
  rounds: RoundResult[];
}

interface RoundResult {
  round: number;
  message: string;
  reactionLayer: string;
  companionLayer: string;
  deepContent: string;
  deepChars: number;
  deepSuccess: boolean;
  emotionTag?: string;
}

async function pollDeep(sessionId: string): Promise<{content: string; success: boolean}> {
  const url = `${BASE_URL_6}/api/v1/chat/stream?sessionId=${sessionId}`;
  return new Promise(resolve => {
    let deep = '';
    let finished = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!finished) { controller.abort(); resolve({ content: deep, success: deep.length > 0 }); }
    }, DEEP_TIMEOUT_6);

    fetch(url, { signal: controller.signal })
      .then(async r => {
        const reader = r.body?.getReader();
        if (!reader) { clearTimeout(timer); resolve({ content: deep, success: false }); return; }
        const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'deep' && d.content) deep += d.content;
              if (d.type === 'deep' && d.done) finished = true;
            } catch {}
          }
        }
        clearTimeout(timer); resolve({ content: deep, success: true });
      })
      .catch(() => {
        clearTimeout(timer); resolve({ content: deep, success: deep.length > 0 });
      });
  });
}

async function sendMessage(pId: string, userId: string, message: string, conversationId: string, requestId: string) {
  const res = await fetch(`${BASE_URL_6}/api/v1/chat/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId: pId, userId, message, conversationId, requestId }),
  });
  return res.json();
}

async function runRound(
  round: number,
  message: string,
  userIds: string[],
  conversationId: string
): Promise<RoundResult[]> {
  console.log(`\n=== 第 ${round}/${CONVERSATION_6.length} 轮 ===`);
  console.log(`消息: "${message}"`);

  // 每轮生成唯一 requestId
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // 并行发送到6个人格
  const startTime = Date.now();
  const startResponses = await Promise.all(
    PERSONALITIES_6.map((p, i) => sendMessage(p.id, userIds[i], message, conversationId, requestId))
  );
  console.log(`  API响应: ${Date.now() - startTime}ms (Reaction+Companion就绪)`);

  // 提取即时返回
  const results: RoundResult[] = startResponses.map((data, i) => ({
    round,
    message,
    reactionLayer: (data.reactionLayer || '').substring(0, 200),
    companionLayer: (data.companionLayer || '').substring(0, 200),
    deepContent: '',
    deepChars: 0,
    deepSuccess: false,
    emotionTag: data.emotionTag,
  }));

  // 并行轮询Deep
  const deepStart = Date.now();
  const deepResults = await Promise.all(
    startResponses.map(data => pollDeep(data.sessionId))
  );
  console.log(`  Deep完成: ${Date.now() - deepStart}ms`);

  // 合并Deep结果
  for (let i = 0; i < PERSONALITIES_6.length; i++) {
    results[i].deepContent = deepResults[i].content;
    results[i].deepChars = deepResults[i].content.length;
    results[i].deepSuccess = deepResults[i].success;
  }

  // 打印本轮对比
  for (let i = 0; i < PERSONALITIES_6.length; i++) {
    const r = results[i];
    const status = r.deepSuccess ? '✅' : '⏳';
    console.log(`  ${PERSONALITIES_6[i].label}: Deep=${r.deepChars}c ${status}`);
  }

  return results;
}

async function main() {
  // 每个角色独立用户ID，避免串流
  const userIds = PERSONALITIES_6.map(p => `six_test_${p.id}`);
  
  // 生成会话ID
  const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  console.log(`会话ID: ${conversationId}`);

  const allResults: PersonalitySummary[] = PERSONALITIES_6.map((p, i) => ({
    personality: p.id,
    label: p.label,
    rounds: [],
  }));

  for (let r = 0; r < CONVERSATION_6.length; r++) {
    const results = await runRound(r + 1, CONVERSATION_6[r], userIds, conversationId);
    for (let i = 0; i < PERSONALITIES_6.length; i++) {
      allResults[i].rounds.push(results[i]);
    }
  }

  // ===== 输出完整报告 =====
  console.log('\n\n');
  console.log('='.repeat(120));
  console.log('六人格同消息对比测试报告');
  console.log('='.repeat(120));

  // 格式辅助
  function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + '...' : s; }

  // 按轮次输出
  for (let r = 0; r < CONVERSATION_6.length; r++) {
    console.log(`\n${'─'.repeat(100)}`);
    console.log(`第 ${r+1} 轮: "${CONVERSATION_6[r]}"`);
    console.log(`${'─'.repeat(100)}`);

    for (const pr of allResults) {
      const round = pr.rounds[r];
      const reactionShort = trunc(round.reactionLayer.replace(/\[.*?\]/g, '').trim(), 80);
      const companionShort = trunc(round.companionLayer.replace(/\[.*?\]/g, '').trim(), 80);
      const deepShort = trunc(round.deepContent.replace(/[\n\r]+/g, ' ').trim(), 120);
      
      console.log(`\n${pr.label}`);
      console.log(`  Reaction: ${reactionShort || '(空)'}`);
      if (companionShort) console.log(`  Companion: ${companionShort}`);
      console.log(`  Deep(${round.deepChars}c): ${deepShort || '(超时/空)'}`);
    }
  }

  // 总统计
  console.log('\n\n');
  console.log('='.repeat(120));
  console.log('数据总览');
  console.log('='.repeat(120));
  console.log(`总计: ${CONVERSATION_6.length} 轮 × 6 人格 = ${CONVERSATION_6.length * 6} 次对话`);
  console.log('');

  for (const pr of allResults) {
    const totalDeepChars = pr.rounds.reduce((s, r) => s + r.deepChars, 0);
    const avgDeepChars = Math.round(totalDeepChars / pr.rounds.length);
    const successCount = pr.rounds.filter(r => r.deepSuccess).length;
    console.log(`${pr.label}: avg=${avgDeepChars}c, success=${successCount}/${pr.rounds.length}`);
  }

  console.log('\n测试完成 ✅');
}

main().catch(console.error);