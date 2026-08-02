// @ts-nocheck
// 生产环境 6人格 × 10轮 完整对话测试
// 每轮6人格并行，Deep超时25s

const BASE = 'https://chat.douhaoyu.cn/api/v1';
const ROLES = [
  { id: 'clever-fox', name: '🦊 狐狸(CBT)' },
  { id: 'warm-bear', name: '🐻 熊(人本)' },
  { id: 'wise-owl', name: '🦉 猫头鹰(精神分析)' },
  { id: 'emotion-elf', name: '🧚 精灵(EFT)' },
  { id: 'philosophical-dolphin', name: '🐬 海豚(存在主义)' },
  { id: 'family-elephant', name: '🐘 象(家庭治疗)' },
];

const MESSAGES = [
  '我最近总觉得很累',                         // R1
  '工作压力太大了，老板要求越来越高',          // R2
  '我对自己要求太高了，总觉得不够好',          // R3
  '小时候爸妈对我也很严格，从没表扬过我',      // R4
  '我现在做什么都怕做错，总想完美',            // R5
  '有时候会突然觉得很慌，心跳加速',            // R6
  '我试过冥想，但坚持不下来',                  // R7
  '朋友说我太敏感了，但我觉得他们不懂',        // R8
  '其实我想要有人能真正理解我',                // R9
  '我不知道自己到底想要什么',                  // R10
];

async function getDeep(sessionId: string, timeoutMs = 28000): Promise<string> {
  const url = `${BASE}/chat/stream?sessionId=${sessionId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let deep = '';
  try {
    const r = await fetch(url, { signal: controller.signal });
    const reader = r.body?.getReader();
    if (!reader) { clearTimeout(timer); return '(无SSE流)'; }
    const dec = new TextDecoder();
    let buf = '';
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
        } catch { }
      }
    }
    clearTimeout(timer);
    return deep || '(Deep内容为空)';
  } catch (e: any) {
    clearTimeout(timer);
    return deep || `(Deep超时/错误)`;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('EmotionFlow v1.0.0 — 生产环境 6人格 10轮对话测试');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('='.repeat(80));
  console.log('');

  const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  console.log(`会话ID: ${conversationId}`);

  for (let round = 0; round < MESSAGES.length; round++) {
    const msg = MESSAGES[round];
    console.log(`\n━━━ 第${round + 1}轮 ━━━ 用户: "${msg}"`);
    console.log('');

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // 并行发送给6人格
    const starts = ROLES.map(async (role) => {
      const res = await fetch(`${BASE}/chat/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: role.id, userId: 'prod_10r', message: msg, conversationId, requestId }),
      });
      const data = await res.json();
      return { role, sessionId: data.sessionId, reaction: data.reactionLayer || '', companion: data.companionLayer || '', frontFlow: data.frontFlowText || '' };
    });

    const results = await Promise.all(starts);
    const deeps = await Promise.all(results.map(r => getDeep(r.sessionId)));

    for (let i = 0; i < ROLES.length; i++) {
      const r = results[i];
      const deep = deeps[i];
      const deepShort = deep.length > 120 ? deep.substring(0, 120) + '...' : deep;
      const leaked = deep.includes('Here') || deep.toLowerCase().includes('thinking') || deep.length > 300;
      console.log(`${r.role.name}`);
      console.log(`  Reaction: ${r.reaction.substring(0, 50)}`);
      console.log(`  Companion: ${r.companion.substring(0, 60)}`);
      console.log(`  Deep[${deep.length}c${leaked ? ' ⚠️泄露' : ' ✅'}]: ${deepShort}`);
      console.log('');
    }
  }

  console.log('='.repeat(80));
  console.log('测试完成 ✅');
}

main().catch(e => console.error('Error:', e));