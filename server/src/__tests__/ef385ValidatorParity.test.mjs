// Frozen PR169 output parity. Real reaction + validator modules, no provider I/O.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as nodeModule from 'node:module';
import vm from 'node:vm';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const fixture = new URL('./fixtures/ef385FrozenDeepCompositionValidator.json', import.meta.url);
const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const imports = { './firstTwoRoundsReaction': reaction };
// A line-array fixture preserves every original byte, including the final blank
// line, without introducing a trailing-blank-line patch or weakening whitespace rules.
const frozenSource = JSON.parse(await readFile(fixture, 'utf8')).join('\n');
const context = vm.createContext({});
const ts = nodeModule.stripTypeScriptTypes ? null : nodeModule.createRequire(import.meta.url)('typescript');
const frozenModule = new vm.SourceTextModule(nodeModule.stripTypeScriptTypes
  ? nodeModule.stripTypeScriptTypes(frozenSource, { mode: 'strip' })
  : ts.transpileModule(frozenSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText,
{ context });
await frozenModule.link(specifier => {
  assert.equal(specifier, './firstTwoRoundsReaction');
  return new vm.SyntheticModule(Object.keys(reaction), function () {
    for (const [name, value] of Object.entries(reaction)) this.setExport(name, value);
  }, { context });
});
await frozenModule.evaluate();
const baseline = frozenModule.namespace;
const validator = new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url);
const current = await loadTsModule(validator, imports);
const overload = '很多事情，脑子很乱，不知道从哪里开始说。';
const base = { roleId: 'clever-fox', userTurn: 1, userMessage: '今天整理了一张卡片。', source: 'cleaned' };
const ef41 = { userMessage: overload };
const rows = [];
function add(name, text, extra = {}) { rows.push({ name, input: { ...base, text, ...extra } }); }
add('plain trimmed', '  卡片上的内容仍然可以慢慢整理。\n');
add('plain exact acknowledgement', current.FIRST_TWO_ROUNDS_DEEP_FALLBACK);
add('plain equal EF41 default is still plain', current.EF41_DEEP_FALLBACK);
add('empty', '');
add('whitespace', ' \n\t ');
add('empty before exhausted budget', '  ', { visiblePrefix: '前'.repeat(121) });
add('single question rejected', '现在要说些什么？');
add('multiple optional questions rejected', '如果你愿意，先说哪件？还有什么?');
add('optional Chinese question', '如果你愿意，想说什么？');
add('optional ASCII question', '可以不回答，想说什么?');
add('budget before question', '问'.repeat(120) + '?');
add('raw persona', '我正在喝咖啡看窗外的树。');
add('raw history', '你以前说过这件事情。');
for (const term of ['心里沉', '沉重', '胸口', '胃里', '疲惫', '委屈', '难过', '伤心', '孤独', '焦虑', '害怕', '不安', '压抑', '耗竭', '撑不住']) {
  add(`raw inferred ${term}`, `你感到${term}。`);
  add(`grounded current ${term}`, `你说${term}。`, { userMessage: `我说${term}。` });
  add(`grounded session ${term}`, `你说${term}。`, { sameSessionUserMessages: [`我说${term}。`] });
}
add('raw before budget', '我正在喝咖啡。' + '字'.repeat(120));
add('raw discarded sentence still decisive', '我正在喝咖啡。卡片上的内容仍然可以慢慢整理。', ef41);
add('raw fallback cannot fit', '你感到难过。', { visiblePrefix: '前'.repeat(116) });
add('empty fallback cannot fit', '', { visiblePrefix: '前'.repeat(116) });
add('question fallback cannot fit', '?', { visiblePrefix: '前'.repeat(116) });
add('EF41 sentence', '卡片上的内容仍然可以慢慢整理。另一句话不会选入。', ef41);
add('EF41 filters short question invitation holding action joint', '好。要说什么？如果你愿意，慢慢说出来。我就在这里陪着你。你可以去看看那张卡片。你先把卡片整理好了。我们一起看看后面的文字。卡片上的内容仍然可以慢慢整理。', ef41);
add('EF41 default', '好。要说什么？', ef41);
add('EF41 whitespace default', ' \n ', ef41);
add('EF41 equal default selected as sentence', current.EF41_DEEP_FALLBACK, ef41);
add('EF41 default budget failure', '', { ...ef41, visiblePrefix: '前'.repeat(115) });
add('EF41 sentence budget failure', '卡片上的内容仍然可以慢慢整理。', { ...ef41, visiblePrefix: '前'.repeat(115) });
const joinedFact = '我正在```abcdefghijklmnop```喝咖啡看窗外的树。';
add('post-selection newly joined fact', joinedFact, ef41);
add('joined fact with insufficient fallback budget', joinedFact, { ...ef41, visiblePrefix: '前'.repeat(116) });
add('other role skips EF41 selection', '好。', { ...ef41, roleId: 'other-role' });
add('overload alone skips EF41 selection', '好。', { userMessage: '很多事情。' });
for (const [prefix, label] of [['前'.repeat(115), 'fallback exactly fits'], ['🙂'.repeat(116), 'fallback cannot fit'], ['前'.repeat(120), 'full'], ['前'.repeat(121), 'overfull'], ['中🙂，\n 文。\n', 'mixed']]) {
  const budget = 120 - Array.from(prefix).length;
  for (const size of new Set([Math.max(0, budget - 1), Math.max(0, budget), Math.max(0, budget + 1), 121])) {
    add(`codepoints ${label} ${size}`, '🙂'.repeat(size), { visiblePrefix: prefix });
  }
}
for (const size of [119, 120, 121]) add(`no prefix boundary ${size}`, '字'.repeat(size));
for (const turn of [-1, 0, 3, 10, Number.NaN]) {
  add(`outside first two turns untouched ${turn}`, '  我正在喝咖啡。你以前说过难过？？' + '🙂'.repeat(121) + '\n', { userTurn: turn, visiblePrefix: '前'.repeat(121) });
}

test('frozen baseline bytes remain the registered PR169 snapshot', async () => {
  assert.equal(createHash('sha256').update(frozenSource).digest('hex'), '24c7f390ee41804b0e3769c56cde3205d55a70cc2ca17ee512cb52c84f5ea29f');
});
for (const { name, input } of rows) {
  for (const source of ['cleaned', 'last-resort', 'reasoning']) {
    for (const userTurn of input.userTurn === 1 ? [1, 2] : [input.userTurn]) {
      test(`validator output parity: ${name} / ${source} / turn ${userTurn}`, () => {
        const value = { ...input, source, userTurn };
        const expected = baseline.validateEf41DeepOutput(value);
        const snapshot = JSON.stringify(value);
        assert.equal(current.validateEf41DeepOutput(value), expected);
        assert.equal(JSON.stringify(value), snapshot, 'does not mutate validator inputs');
      });
    }
  }
}
