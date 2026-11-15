// Offline identity-disclosure regression only: no provider request or runtime-quality claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const prompt = await loadTsModule(new URL('../flows/deepSystemPromptBuilder.ts', import.meta.url), { './ef41DeepCompositionValidator': validator });
const server = await loadTsModule(new URL('../roles/psychologistRoles.ts', import.meta.url), {});
const client = await loadTsModule(new URL('../../../client/screens/chat/constants/roles.ts', import.meta.url), {});
const credentialClaim = /博士|硕士|学士|大学|毕业|深造|\\d+\\s*年|担任.{0,10}(治疗师|咨询师)/;

for (const [source, roles] of [['server', server.PSYCHOLOGIST_ROLES], ['client', client.DEFAULT_ROLES]]) {
  test(source + ' retains six personas with explicit non-credential identity and boundary', () => {
    assert.equal(roles.length, 6);
    assert.equal(new Set(roles.map(role => role.id)).size, 6);
    for (const role of roles) {
      assert.match(role.professionalBackground.education, /AI 虚构陪伴角色，没有真实学历、执业资格或任职经历/);
      assert.match(role.professionalBackground.workExperience, /不能替代专业咨询或治疗/);
      assert.doesNotMatch(JSON.stringify(role), credentialClaim);
      assert.match(role.systemPrompt, /AI/);
    }
  });
}
for (const role of client.DEFAULT_ROLES) {
  test(role.id + ' ordinary later-turn prompt has no invented degree or clinical tenure', () => {
    const text = prompt.buildDeepSystemPrompt(role.id, role.name, '', undefined, null, undefined, null, undefined, 3);
    assert.doesNotMatch(text, credentialClaim);
    assert.match(text, /没有真实学历、执业资格、任职经历或临床经验/);
    assert.match(text, /不得声称拥有上述资历/);
  });
}
test('DEV and ordinary entry prompts still omit role biographies', () => {
  for (const turn of [1, 2]) {
    const text = prompt.buildDeepSystemPrompt('clever-fox', '聪明狐狸', '', undefined, null, undefined, null, undefined, turn);
    assert.doesNotMatch(text, /职业背景|教育背景|核心生存策略/);
  }
  const text = prompt.buildDeepSystemPrompt('clever-fox', '聪明狐狸', '', undefined, null, undefined, null, undefined, 3, '', { userTurn: 3, hasContext: true, deepMaxChars: 120 });
  assert.match(text, /不是真人或医师/);
  assert.doesNotMatch(text, /职业背景|教育背景|核心生存策略/);
});
test('role modals label identity and boundary without educational or employment headings', async () => {
  for (const file of ['RoleIntroModal.tsx', 'RoleDetailModal.tsx']) {
    const text = await readFile(new URL('../../../client/screens/chat/components/' + file, import.meta.url), 'utf8');
    assert.match(text, /身份说明/);
    assert.match(text, /能力边界/);
    assert.doesNotMatch(text, /(?:title|label)="(?:教育背景|工作背景|工作经历|职业背景)"/);
  }
});
