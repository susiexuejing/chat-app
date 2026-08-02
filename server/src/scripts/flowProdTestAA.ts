// @ts-nocheck
// attachment_anxiety 快速测试 - 30s超时
const BASE_URL = 'http://localhost:9091';

async function readDeep(sessionId: string): Promise<string> {
  return new Promise(resolve => {
    const url = `${BASE_URL}/api/v1/chat/stream?sessionId=${sessionId}`;
    let deep = '';
    let finished = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { if (!finished) { controller.abort(); resolve(deep || '(超时)'); } }, 35000);
    fetch(url, { signal: controller.signal })
      .then(async r => {
        const reader = r.body?.getReader();
        if (!reader) { clearTimeout(timer); resolve('(无可读流)'); return; }
        const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (const line of buf.split('\n').filter(l => l.startsWith('data: '))) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'deep' && d.content) deep += d.content;
              if (d.type === 'deep' && d.done) finished = true;
            } catch(e) {}
          }
          buf = '';
        }
        clearTimeout(timer); resolve(deep);
      }).catch(() => { clearTimeout(timer); resolve(deep || '(连接错误)'); });
  });
}

const msgs = [
  '他今天一整天都没回我消息，以前从来不会这样的',
  '他是不是不喜欢我了，我是不是做错了什么',
  '我一直在想是不是我太粘人了，把他推开了',
  '我好害怕他又一次丢下我，就像以前那样',
];

async function main() {
  // Only test the 4th round (most interesting - shows the flow path)
  // To save time, just test R4 which has the strongest anxiety signal
  const i = 3; // R4
  const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  console.log(`会话ID: ${conversationId}`);
  const res = await fetch(`${BASE_URL}/api/v1/chat/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId: 'warm-bear', userId: 'prod_aa_v4', message: msgs[i], conversationId, requestId }),
  }).then(r => r.json());
  console.log(`[R${i+1}] sessionId=${res.sessionId}`);
  console.log(`  Message: "${msgs[i]}"`);
  const deep = await readDeep(res.sessionId);
  console.log(`  Deep: ${deep}`);
  console.log(`  Deep chars: ${deep.length}`);
}

main().catch(console.error);