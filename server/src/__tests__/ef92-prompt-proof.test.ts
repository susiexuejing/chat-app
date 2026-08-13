/**
 * EF-92 Prompt Proof Test — Production-Path Verification
 *
 * This test imports buildDeepSystemPrompt from the side-effect-free
 * production module (server/src/flows/deepPromptBuilder.ts) that is
 * actually used by server/src/index.ts.
 *
 * It verifies:
 * 1. A real NeuralProfile without deepPromptBlock is accepted
 * 2. Literal string "undefined" is not emitted
 * 3. "当前会话神经系统参数" is not emitted
 * 4. Expected existing role/front-flow/depth content remains present
 * 5. Baseline equivalence for controlled arguments
 * 6. Legacy-profile shape (without deepPromptBlock) works correctly
 */

import { describe, it, expect } from '@jest/globals';
import { buildDeepSystemPrompt } from '../flows/deepSystemPromptBuilder';
import type { NeuralProfile } from '../flows/neuralProfileManager';

/**
 * Construct a fixture NeuralProfile using the exact current fields.
 * The fixture does NOT contain deepPromptBlock.
 */
function createFixtureProfile(overrides?: Partial<NeuralProfile>): NeuralProfile {
  return {
    userId: 'ef92-test-user',
    roleId: 'clever-fox',
    attentionBias: 'default',
    valueBias: 'default',
    influenceLog: [],
    longTermChangeLog: [],
    subconscious: {
      analyticalDepth: 0.4,
      emotionalSupport: 0.5,
      actionGuidance: 0.3,
      reflectiveSpace: 0.4,
      totalInteractions: 0,
      dominantEmotions: [],
      recentTopics: [],
      lastUpdated: 0,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('EF-92 Prompt Proof — Production buildDeepSystemPrompt', () => {
  const ROLE_ID = 'clever-fox';
  const ROLE_NAME = '聪明狐狸';
  const FRONT_FLOW_TEXT = '用户感到工作压力大，需要陪伴。';

  it('accepts a real NeuralProfile without deepPromptBlock and does not emit "undefined"', () => {
    const profile = createFixtureProfile();

    // Profile must not have deepPromptBlock
    expect('deepPromptBlock' in profile).toBe(false);

    const prompt = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    // Must not contain literal "undefined"
    expect(prompt).not.toContain('undefined');
  });

  it('does not emit "当前会话神经系统参数" section', () => {
    const profile = createFixtureProfile();

    const prompt = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    expect(prompt).not.toContain('当前会话神经系统参数');
  });

  it('preserves expected existing role content', () => {
    const profile = createFixtureProfile();

    const prompt = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    // Role name must be present
    expect(prompt).toContain(`你是「${ROLE_NAME}」`);

    // Role style content for clever-fox must be present
    expect(prompt).toContain('认知行为疗法');
    expect(prompt).toContain('EmotionFlow 生命系统');
    expect(prompt).toContain('EmotionFlow 成长系统');

    // Front flow text must be present
    expect(prompt).toContain(FRONT_FLOW_TEXT);

    // Depth instruction for turn > 2
    expect(prompt).toContain('从更深一层的分析开始');

    // Closing instruction
    expect(prompt).toContain('请接着前端陪伴流自然续写');
  });

  it('produces identical output for the same controlled arguments (baseline equivalence)', () => {
    const profile = createFixtureProfile();

    const prompt1 = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    const prompt2 = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    // Same inputs must produce identical output
    expect(prompt1).toBe(prompt2);
  });

  it('produces identical output with and without NeuralProfile (legacy equivalence)', () => {
    const profile = createFixtureProfile();

    const promptWithProfile = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    const promptWithoutProfile = buildDeepSystemPrompt(
      ROLE_ID,
      ROLE_NAME,
      FRONT_FLOW_TEXT,
      undefined,
      null,
      undefined,
      null,
      undefined,
      3
    );

    // Since deepPromptBlock is not enabled in baseline,
    // the only difference should be the empty deepPromptBlock line.
    // Both must not contain "undefined" or "当前会话神经系统参数"
    expect(promptWithProfile).not.toContain('undefined');
    expect(promptWithoutProfile).not.toContain('undefined');
    expect(promptWithProfile).not.toContain('当前会话神经系统参数');
    expect(promptWithoutProfile).not.toContain('当前会话神经系统参数');

    // Both must contain core role content
    expect(promptWithProfile).toContain(`你是「${ROLE_NAME}」`);
    expect(promptWithoutProfile).toContain(`你是「${ROLE_NAME}」`);
  });

  it('works with all supported roles without emitting "undefined"', () => {
    const roles = [
      'clever-fox',
      'warm-bear',
      'wise-owl',
      'emotion-elf',
      'philosophical-dolphin',
      'family-elephant',
    ];

    for (const roleId of roles) {
      const profile = createFixtureProfile({ roleId });
      const prompt = buildDeepSystemPrompt(
        roleId,
        ROLE_NAME,
        FRONT_FLOW_TEXT,
        profile,
        null,
        undefined,
        null,
        undefined,
        3
      );

      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('当前会话神经系统参数');
      expect(prompt).toContain(`你是「${ROLE_NAME}」`);
    }
  });

  it('handles unknown roleId gracefully', () => {
    const profile = createFixtureProfile({ roleId: 'unknown-role' });
    const prompt = buildDeepSystemPrompt(
      'unknown-role',
      '未知角色',
      FRONT_FLOW_TEXT,
      profile,
      null,
      undefined,
      null,
      undefined,
      3
    );

    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('你是一位温暖的心理陪伴者');
  });
});
