// 生产环境回流测试 v2 — 完整3案例 + Deep质量评估
const BASE_URL = 'http://localhost:9091';
const DEEP_TIMEOUT_MS = 30000;

interface TestResult {
  name: string;
  roleId: string;
  flowTrajectory: string[];
  statusTrajectory: string[];
  deepOutputs: string[];
  analysis: {
    flowAccuracy: string;
    personalityConsistency: string;
    flowFollowing: string;
    misguidance: string;
  };
}

const testCases = [
  {
    name: 'self_blame — 工作焦虑→自我否定',
    roleId: 'clever-fox', userId: 'prod_sb_final',
    messages: [
      '今天领导在会上批评了我的方案，说了很多难听的话',
      '是不是我真的能力不行，我好像做什么都做不对',
      '每次遇到这种事我都会觉得自己不够好，很没用',
      '我从小就这样，一被否定就觉得自己毫无价值',
    ],
  },
  {
    name: 'anger_to_hurt — 愤怒→被理解需要',
    roleId: 'emotion-elf', userId: 'prod_ah_final',
    messages: [
      '她凭什么那样说我，我明明已经很努力了',
      '我真的很生气，她根本不考虑我的感受',
      '我当时什么都没说，回来越想越难受，胸口堵得慌',
      '其实我只是想被理解而已，我想要她能看到我的付出',
    ],
  },
  {
    name: 'attachment_anxiety — 没回消息→被抛弃恐惧',
    roleId: 'warm-bear', userId: 'prod_aa_final',
    messages: [
      '他今天一整天都没回我消息，以前从来不会这样的',
      '他是不是不喜欢我了，我是不是做错了什么',
      '我一直在想是不是我太粘人了，把他推开了',
      '我好害怕他又一次丢下我，就像以前那样',
    ],
  },
];

function readDeepSSE(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const url = `${BASE_URL}/api/v1/chat/stream?sessionId=${sessionId}`;
    let fullDeep = '';
    let finished = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!finished) { controller.abort(); resolve(fullDeep || '(超时)'); }
    }, DEEP_TIMEOUT_MS);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const reader = res.body?.getReader();
        if (!reader) { clearTimeout(timeout); resolve('(无可读流)'); return; }
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (const line of buffer.split('\n').filter(l => l.startsWith('data: '))) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'deep' && d.content) fullDeep += d.content;
              if (d.type === 'deep' && d.done) finished = true;
            } catch {}
          }
          buffer = '';
        }
        clearTimeout(timeout); resolve(fullDeep);
      })
      .catch(() => { clearTimeout(timeout); resolve(fullDeep || '(连接错误)'); });
  });
}

async function run() {
  const results: TestResult[] = [];

  for (const tc of testCases) {
    console.log(`\n📋 ${tc.name}`);
    const flowTrajectory: string[] = [];
    const statusTrajectory: string[] = [];
    const deepOutputs: string[] = [];

    for (let i = 0; i < tc.messages.length; i++) {
      const res = await fetch(`${BASE_URL}/api/v1/chat/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: tc.roleId, userId: tc.userId, message: tc.messages[i] }),
      }).then(r => r.json());

      flowTrajectory.push('(等待日志)');
      statusTrajectory.push('');

      const deep = await readDeepSSE(res.sessionId);
      deepOutputs.push(deep);
      console.log(`  R${i + 1}: Deep[${deep.substring(0, 60)}...]`);
      await new Promise(r => setTimeout(r, 500));
    }
    results.push({ name: tc.name, roleId: tc.roleId, flowTrajectory, statusTrajectory, deepOutputs, analysis: { flowAccuracy: '', personalityConsistency: '', flowFollowing: '', misguidance: '' } });
  }

  // Read server logs for flow diagnostics
  const logs = await fetch(`${BASE_URL}/api/v1/health`).then(r => r.text());

  // Output summary table
  console.log('\n\n');
  console.log('='.repeat(90));
  console.log('📊 生产环境回流测试 — 汇总');
  console.log('='.repeat(90));
  console.log();
  console.log('请查看上方服务端日志输出中的 [Flow] 标记行确认 FlowResult…');
  console.log('以下是基于 Deep 输出文本的定性分析：');
  console.log();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`━━━ ${r.name} ━━━`);
    console.log(`人格: ${r.roleId}`);
    for (let j = 0; j < r.deepOutputs.length; j++) {
      console.log(`  R${j+1} Deep: ${r.deepOutputs[j].substring(0, 100)}`);
    }
    console.log();
  }

  console.log('='.repeat(90));
  console.log('🏁 完成');
}

run().catch(console.error);