// ═══════════════════════════════════════════════════════════════
// EmotionFlow Phase 5 — Change System 概念层测试
// 模拟3条消息序列，输出每轮的 ChangeSnapshot + 趋势分析
// ═══════════════════════════════════════════════════════════════

import { analyzeFlow, resetAllFlowBuffers, recordChange, getChangeBlock, resetAllChangeHistory } from '../flows/index';
import { loadChangeHistoryFromFile } from '../flows/changeSystem';

// ─── 测试用例 ───────────────────────────────────────────

interface TestCase {
  name: string;
  roleId: string;
  userId: string;
  messages: string[];
  description: string;
}

const testCases: TestCase[] = [
  {
    name: 'self_blame 归因变化 — 从外归到内归',
    roleId: 'clever-fox',
    userId: 'change_test_sb',
    messages: [
      '领导在会上批评了我的方案',
      '他说的那些话太难听了，我觉得很不公平',
      '但仔细想想，可能真的是我做得不够好',
      '我从小就这样，一被否定就觉得自己没用',
    ],
    description: '外部事件→外归因→内归因→长期模式 → 归因轴应有大幅偏移'
  },
  {
    name: 'anger_to_hurt 流向深化 — 从愤怒到需要',
    roleId: 'emotion-elf',
    userId: 'change_test_ah',
    messages: [
      '她凭什么那样说我，太不公平了',
      '我真的很生气，越想越气',
      '其实我只是想被理解而已',
    ],
    description: '愤怒→情绪爆发→需要暴露 → 流向应逐渐深化'
  },
  {
    name: 'chaos_to_structure 行动力变化 — 从乱到行动',
    roleId: 'warm-bear',
    userId: 'change_test_cs',
    messages: [
      '我脑子很乱，好多事挤在一起',
      '我完全不知道从哪说起',
      '你能帮我理一理吗',
    ],
    description: '混乱→卡住→求助 → 行动力应逐步恢复'
  },
];

// ─── 测试运行 ───────────────────────────────────────────

function runTest(tc: TestCase): void {
  console.log('─'.repeat(80));
  console.log(`📋 测试: ${tc.name}`);
  console.log(`   人格: ${tc.roleId}`);
  console.log(`   描述: ${tc.description}`);
  console.log();

  // 重置缓冲区 + 变化档案
  resetAllFlowBuffers();
  resetAllChangeHistory();

  const flowResults: string[] = [];

  for (let i = 0; i < tc.messages.length; i++) {
    const msg = tc.messages[i];
    const round = i + 1;

    // 1. Flow System
    const fr = analyzeFlow(tc.userId, tc.roleId, msg);
    const pf = fr.primaryFlow;
    const pfLabel = pf ? `${pf.flowType}(conf=${pf.confidence.toFixed(2)}, str=${pf.strength.toFixed(2)})` : '(none)';
    flowResults.push(pf?.flowType || 'none');

    // 2. Change System
    const snapshot = recordChange(tc.userId, tc.roleId, fr);
    const dirLabel = snapshot
      ? `方向=${snapshot.patternDelta.directionChange}, Δcog=${snapshot.positionDelta.cognitionDelta.toFixed(2)}, Δatt=${snapshot.positionDelta.attributionDelta.toFixed(2)}, Δage=${snapshot.positionDelta.agencyDelta.toFixed(2)}, Δabs=${snapshot.positionDelta.abstractionDelta.toFixed(2)}`
      : '(首次记录)';

    console.log(`  [第${round}轮] "${msg.substring(0, 25)}..."`);
    console.log(`    └─ Flow: cog=${fr.position.cognition.toFixed(2)}, att=${fr.position.attribution.toFixed(2)}, age=${fr.position.agency.toFixed(2)}, abs=${fr.position.abstraction}`);
    console.log(`    └─ Pattern: ${pfLabel}`);
    console.log(`    └─ Change: ${dirLabel}`);
    console.log();
  }

  // 趋势分析
  const history = loadChangeHistoryFromFile(tc.userId, tc.roleId);
  if (history?.trendAnalysis) {
    const t = history.trendAnalysis;
    console.log(`  📊 趋势分析（${tc.messages.length}轮）:`);
    console.log(`    └─ 自责变化: ${t.selfBlameChange.toFixed(2)} (${t.selfBlameChange < -0.1 ? '⬆ 加重' : t.selfBlameChange > 0.1 ? '⬇ 减轻' : '➡ 稳定'})`);
    console.log(`    └─ 行动力变化: ${t.agencyChange.toFixed(2)} (${t.agencyChange > 0.1 ? '⬆ 提升' : t.agencyChange < -0.1 ? '⬇ 减弱' : '➡ 稳定'})`);
    console.log(`    └─ 模式觉察变化: ${t.reflectionChange.toFixed(2)} (${t.reflectionChange > 0.3 ? '⬆ 显著提升' : t.reflectionChange > 0.1 ? '⬆ 提升' : t.reflectionChange < -0.1 ? '⬇ 减弱' : '➡ 稳定'})`);
    console.log(`    └─ Flow深度趋势: ${t.flowDepthTrend.toFixed(1)}`);
  }

  // 格式化 Change Block
  const changeBlock = getChangeBlock(tc.userId, tc.roleId);
  if (changeBlock) {
    console.log(`\n  📋 Change Block（Deep Prompt注入内容）:`);
    console.log(changeBlock);
  }

  console.log();
  console.log(`  流向轨迹: ${flowResults.join(' → ')}`);
  console.log();
}

// ─── 主程序 ─────────────────────────────────────────────

console.log('='.repeat(80));
console.log('🧪 EmotionFlow Phase 5 — Change System 概念层测试');
console.log('='.repeat(80));
console.log();

for (const tc of testCases) {
  runTest(tc);
}

console.log('='.repeat(80));
console.log('🏁 Change System 概念层测试完成');
console.log('='.repeat(80));