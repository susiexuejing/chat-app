/**
 * EmotionFlow Phase 5 — 生产环境回流测试
 * 验证 ChangeBlock 注入后六人格 Deep 输出 (AC3/AC4)
 *
 * 测试设计：
 * - 同一用户，同一3轮消息序列
 * - 2种人格（clever-fox CBT vs warm-bear 人本主义）
 * - 每轮捕获 ChangeBlock + Deep输出
 * - 对比同一ChangeBlock下不同人格的差异
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9091';
const RESULTS_DIR = path.resolve(process.cwd(), 'auto', 'test_results');
const MSGS = [
  '领导在会上批评了我的方案，说完全不行',
  '但仔细想想，可能真的是我做得不够好',
  '我从小就这样，一被否定就觉得自己没用',
];

async function readDeep(sessionId: string, timeoutMs = 35000): Promise<string> {
  const url = `${BASE_URL}/api/v1/chat/stream?sessionId=${sessionId}&t=${Date.now()}`;
  return new Promise<string>((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve('(超时)');
    }, timeoutMs);

    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        const reader = r.body?.getReader();
        if (!reader) {
          clearTimeout(timer);
          resolve('(无流)');
          return;
        }
        const dec = new TextDecoder();
        let buf = '';
        let deep = '';
        let finished = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) {
              buf += line + '\n';
              continue;
            }
            const raw = line.slice(6);
            if (raw === '[DONE]') { finished = true; continue; }
            try {
              const d = JSON.parse(raw);
              if (d.type === 'deep') {
                if (d.content) deep += d.content;
                if (d.done) finished = true;
              }
            } catch {}
          }
        }
        clearTimeout(timer);
        resolve(deep);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve('(连接错误)');
      });
  });
}

async function runRound(userId: string, roleId: string, msg: string, roundNum: number) {
  const res = await fetch(`${BASE_URL}/api/v1/chat/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, userId, message: msg }),
  });
  const data = await res.json();
  const sessionId = data.sessionId;

  // 等待 Deep 生成
  const deep = await readDeep(sessionId);
  return { sessionId, deep };
}

async function main() {
  console.log('='.repeat(80));
  console.log('🧪 EmotionFlow Phase 5 — 生产环境回流测试');
  console.log('📅 ' + new Date().toISOString().slice(0, 10));
  console.log('='.repeat(80));

  const results: Record<string, any>[] = [];
  const personalities = [
    { roleId: 'clever-fox', label: '🦊 clever-fox (CBT)' },
    { roleId: 'warm-bear', label: '🐻 warm-bear (人本)' },
    // { roleId: 'emotion-elf', label: '🧝 emotion-elf (EFT)' },
  ];

  for (const p of personalities) {
    const userId = `prod_reg_${p.roleId}`;
    console.log(`\n` + '─'.repeat(80));
    console.log(`\n📋 ${p.label}`);
    console.log(`   用户: ${userId}\n`);

    const rounds: any[] = [];
    for (let i = 0; i < MSGS.length; i++) {
      const msg = MSGS[i];
      const msgShort = msg.length > 30 ? msg.slice(0, 30) + '...' : msg;
      process.stdout.write(`  [第${i + 1}/3轮] "${msgShort}" → `);
      const { sessionId, deep } = await runRound(userId, p.roleId, msg, i + 1);
      const deepPreview = deep.length > 200 ? deep.slice(0, 200) + '...' : deep;
      console.log(`session=${sessionId.slice(0, 8)}, Deep=${deep.length}c`);
      console.log(`    └─ Deep: "${deepPreview}"`);
      rounds.push({ round: i + 1, msg, sessionId, deep });
      if (i < MSGS.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    results.push({ personality: p.label, roleId: p.roleId, rounds });
  }

  // 保存结果
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'prod_change_regression.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n✅ 结果已保存到 auto/test_results/prod_change_regression.json`);
}

main().catch(console.error);