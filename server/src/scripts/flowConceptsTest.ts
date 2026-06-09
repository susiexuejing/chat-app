// ═══════════════════════════════════════════════════════════════
// EmotionFlow V4 — Flow System 概念层测试
// 验证 10 个 Flow Pattern 在模拟消息序列中是否能正确匹配
// ═══════════════════════════════════════════════════════════════

import { analyzeFlow, resetAllFlowBuffers, formatFlowResult } from '../flows/index';

// ─── 测试数据 ────────────────────────────────────────────

interface TestCase {
  name: string;
  expectedPattern: string;
  roleId: string;
  messages: string[];
}

const testCases: TestCase[] = [
  // 1. self_blame: 外部事件 → 自我否定
  {
    name: 'self_blame — 领导没回 → 我不好',
    expectedPattern: 'self_blame',
    roleId: 'clever-fox',
    messages: [
      '领导没回我消息',
      '是不是我做错了什么',
      '我是不是能力不行',
      '从小到大我都这样，一遇到事就觉得是自己不好',
    ],
  },
  // 2. attachment_anxiety: 关系不确定 → 被抛弃感
  {
    name: 'attachment_anxiety — 没回消息 → 不被在乎',
    expectedPattern: 'attachment_anxiety',
    roleId: 'warm-bear',
    messages: [
      '他没回我消息',
      '他是不是不喜欢我了',
      '我是不是不重要了',
      '我害怕被丢下',
    ],
  },
  // 3. anger_to_hurt: 愤怒 → 委屈
  {
    name: 'anger_to_hurt — 他凭什么 → 其实我只是',
    expectedPattern: 'anger_to_hurt',
    roleId: 'emotion-elf',
    messages: [
      '他凭什么这么对我',
      '我真的很生气',
      '他一点都不考虑我的感受',
      '其实我只是想被理解而已',
    ],
  },
  // 4. control_to_helplessness: 控制努力 → 无力感
  {
    name: 'control_to_helplessness — 试了很多 → 都没用',
    expectedPattern: 'control_to_helplessness',
    roleId: 'clever-fox',
    messages: [
      '我一直想解决这个问题',
      '我试了好多方法',
      '我都按步骤做了',
      '什么都没用，我改变不了',
    ],
  },
  // 5. analysis_to_feeling: 分析 → 感受
  {
    name: 'analysis_to_feeling — 道理都懂 → 胸口堵',
    expectedPattern: 'analysis_to_feeling',
    roleId: 'wise-owl',
    messages: [
      '道理我都懂，按理说我不该焦虑的',
      '我知道这是认知偏差，应该调整',
      '我明白是我自己想太多',
      '但我胸口还是堵，心里很难受',
    ],
  },
  // 6. chaos_to_structure: 混乱 → 结构化
  {
    name: 'chaos_to_structure — 脑子乱 → 帮我理理',
    expectedPattern: 'chaos_to_structure',
    roleId: 'clever-fox',
    messages: [
      '我脑子很乱',
      '好多事挤在一起，理不清',
      '我完全不知道从哪说起',
      '你能帮我理一理吗，先说哪件事',
    ],
  },
  // 7. avoidance_to_action: 停滞 → 微行动
  {
    name: 'avoidance_to_action — 不想做 → 先洗个澡',
    expectedPattern: 'avoidance_to_action',
    roleId: 'warm-bear',
    messages: [
      '我什么都不想做',
      '就躺在床上发呆',
      '我知道应该做点什么',
      '后来我逼自己去洗了个澡',
      '洗完好像好一点点',
    ],
  },
  // 8. external_blame_to_self_contact: 抱怨外界 → 看见自己
  {
    name: 'external_blame_to_self_contact — 他们太过分 → 我只是想被尊重',
    expectedPattern: 'external_blame_to_self_contact',
    roleId: 'family-elephant',
    messages: [
      '他们太过分了',
      '每次都这样，不考虑我的感受',
      '凭什么要我让步',
      '其实我只是想被尊重而已',
    ],
  },
  // 9. surface_event_to_deep_pattern: 表层事件 → 长期模式
  {
    name: 'surface_event_to_deep_pattern — 这次被否定 → 我从来都这样',
    expectedPattern: 'surface_event_to_deep_pattern',
    roleId: 'wise-owl',
    messages: [
      '今天被领导说了几句',
      '当场我什么都没说',
      '回来发现特别在意',
      '我意识到我不是在意这次的事',
      '是我每次被否定都会这样，从小到大都是这个模式',
    ],
  },
  // 10. emptiness_to_meaning: 空心感 → 意义探索
  {
    name: 'emptiness_to_meaning — 没意思 → 到底想要什么',
    expectedPattern: 'emptiness_to_meaning',
    roleId: 'philosophical-dolphin',
    messages: [
      '感觉什么都没意思',
      '每天都是重复，很空',
      '我不知道活着为了什么',
      '我想知道到底什么对我重要',
    ],
  },
];

// ─── 测试执行 ────────────────────────────────────────────

function runTests(): void {
  let passed = 0;
  let failed = 0;
  const details: string[] = [];

  for (const tc of testCases) {
    resetAllFlowBuffers();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`📋 测试: ${tc.name}`);
    console.log(`期望匹配: ${tc.expectedPattern}`);
    console.log(`${'='.repeat(70)}\n`);

    const rounds: string[] = [];
    let finalResult: any = null;

    for (let i = 0; i < tc.messages.length; i++) {
      const msg = tc.messages[i];
      const result = analyzeFlow('test_user', tc.roleId, msg);
      finalResult = result;

      const pf = result.primaryFlow;
      const sf = result.secondaryFlow;

      const roundInfo = [
        `  [第${i + 1}轮] "${msg.substring(0, 30)}${msg.length > 30 ? '...' : ''}"`,
        `    Position: cog=${result.position.cognition.toFixed(2)} att=${result.position.attribution.toFixed(2)} age=${result.position.agency.toFixed(2)} abs=${result.position.abstraction}`,
        `    Status: ${result.status}`,
        `    Primary: ${pf ? `${pf.flowType} (conf=${pf.confidence.toFixed(3)}, str=${pf.strength.toFixed(3)})` : '(none)'}`,
      ];
      if (sf && pf && pf.confidence < 0.7) {
        roundInfo.push(`    Secondary: ${sf.flowType} (conf=${sf.confidence.toFixed(3)})`);
      }
      if (result.isMixed) roundInfo.push('    冲突: mixed');
      if (result.isTransitioning) roundInfo.push('    方向突变: ⚠');
      rounds.push(roundInfo.join('\n'));
      console.log(roundInfo.join('\n') + '\n');
    }

    // 判断最后一轮是否命中期望 pattern
    const hit = finalResult?.primaryFlow?.flowType === tc.expectedPattern;
    const mixed = finalResult?.isMixed;
    const none = !finalResult?.primaryFlow;

    if (hit) {
      passed++;
      console.log(`✅ 通过: 命中 ${tc.expectedPattern}`);
    } else if (mixed) {
      console.log(`⚠️ Mixed: 多流向冲突，未明确命中 ${tc.expectedPattern}`);
      // Mixed 不算严格失败
      details.push(`⚠️ Mixed: ${tc.name} → 多流向冲突 (${finalResult?.primaryFlow?.flowType || 'none'})`);
    } else if (none) {
      failed++;
      console.log(`❌ 失败: 未匹配到任何 Flow Pattern`);
      details.push(`❌ 无匹配: ${tc.name}`);
    } else {
      failed++;
      console.log(`❌ 失败: 期望=${tc.expectedPattern}, 实际=${finalResult?.primaryFlow?.flowType}`);
      details.push(`❌ 误配: ${tc.name} → ${finalResult?.primaryFlow?.flowType} (期望 ${tc.expectedPattern})`);
    }
  }

  // ─── 汇总 ──────────────────────────────────────────────

  const total = testCases.length;
  const rate = ((passed / total) * 100).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 概念层测试汇总`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  总案例: ${total}`);
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  if (details.length > 0) {
    console.log(`\n  详情:`);
    for (const d of details) {
      console.log(`    ${d}`);
    }
  }
  console.log(`\n  通过率: ${rate}% (${passed}/${total})`);
}

runTests();