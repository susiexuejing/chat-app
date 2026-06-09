/**
 * 六人格测试 - 续跑第6~10轮
 */
const BASE_URL = 'http://localhost:9091';
const DEEP_TIMEOUT_MS = 40000;

const PERSONALITIES = [
  { id: 'clever-fox',          label: '🦊 狐狸(CBT)' },
  { id: 'warm-bear',           label: '🐻 熊(人本)' },
  { id: 'wise-owl',            label: '🦉 猫头鹰(精神分析)' },
  { id: 'emotion-elf',         label: '🧚 精灵(EFT)' },
  { id: 'philosophical-dolphin', label: '🐬 海豚(存在主义)' },
  { id: 'family-elephant',    label: '🐘 象(家庭治疗)' },
];

const CONVERSATION = [
  // Rounds 1-5 already done
  "我现在做什么都怕做错，追求完美到累",
  "有时候会突然心慌，感觉喘不过气",
  "我试过冥想，但坚持不下来",
  "朋友说我太敏感了，但我觉得他们不懂",
  "其实我就想要有人能真正理解我",
];

async function pollDeep(sessionId: string): Promise<string> {
  return new Promise(resolve => {
    let deep = '';
    let finished = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { if (!finished) { controller.abort(); resolve(deep); } }, DEEP_TIMEOUT_MS);
    fetch(`${BASE_URL}/api/v1/chat/stream?sessionId=${sessionId}`, { signal: controller.signal })
      .then(async r => {
        const reader = r.body?.getReader();
        if (!reader) { clearTimeout(timer); resolve(deep); return; }
        const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try { const d = JSON.parse(line.slice(6)); if (d.type === 'deep' && d.content) deep += d.content; if (d.type === 'deep' && d.done) finished = true; } catch {}
          }
        }
        clearTimeout(timer); resolve(deep);
      }).catch(() => { clearTimeout(timer); resolve(deep); });
  });
}

async function main() {
  const userIds = PERSONALITIES.map(p => `six_test_${p.id}`);

  for (let r = 0; r < CONVERSATION.length; r++) {
    const msg = CONVERSATION[r];
    console.log(`\n=== 第 ${r+6}/10 轮 ===`);
    console.log(`消息: "${msg}"`);

    const startTime = Date.now();
    const responses = await Promise.all(
      PERSONALITIES.map((p, i) => 
        fetch(`${BASE_URL}/api/v1/chat/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleId: p.id, userId: userIds[i], message: msg }),
        }).then(r => r.json())
      )
    );
    console.log(`  API: ${Date.now()-startTime}ms`);

    const deepStart = Date.now();
    const deepResults = await Promise.all(responses.map(r => pollDeep(r.sessionId)));
    console.log(`  Deep: ${Date.now()-deepStart}ms`);

    for (let i = 0; i < PERSONALITIES.length; i++) {
      const len = deepResults[i].length;
      const first80 = deepResults[i].substring(0, 80).replace(/[\n\r]+/g, ' ');
      console.log(`  ${PERSONALITIES[i].label}: ${len}c → "${first80}..."`);
    }
  }

  console.log('\n✅ 第6~10轮完成');
}

main().catch(console.error);