import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalPathDigest,
  fixedSuccessorRegressionManifest,
  isFixedSuccessorAttempt,
  validateAdmission,
  validateProfile,
} from '../fixed-pr-admission.mjs';

const profileUrl = new URL('../fixed-pr-admission.profile.json', import.meta.url);
const workflowUrl = new URL('../../.github/workflows/protected-fixed-pr-admission.yml', import.meta.url);
const PROFILE = JSON.parse(await readFile(profileUrl, 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function acceptedEvent() {
  return {
    eventName: 'pull_request_target',
    pullRequest: {
      number: 101,
      head: {
        sha: PROFILE.product.headSha,
        ref: PROFILE.product.sourceBranch,
        repoFullName: PROFILE.product.sourceRepository,
      },
      base: {
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ref: PROFILE.product.targetBranch,
        repoFullName: PROFILE.product.sourceRepository,
      },
    },
  };
}

function acceptedEvidence() {
  return {
    protectedBaseCheckoutSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    authorityFloorIncluded: true,
    productParentIncludedInTargetBase: true,
    candidateResolvedSha: PROFILE.product.headSha,
    candidateParentShas: [PROFILE.product.parentSha],
    candidateMergeBaseSha: PROFILE.product.parentSha,
    candidatePatchId: PROFILE.product.patchId,
    changedPaths: [...PROFILE.product.paths],
    targetBaseAdvancePaths: [...PROFILE.product.allowedTargetBaseAdvancePaths],
    candidateControlPlanePaths: [],
    targetedRegression: PROFILE.product.targetedRegression,
    profilePresentAtBase: true,
    profileMatchesBase: true,
  };
}

function rejected(mutator, expression) {
  const event = acceptedEvent();
  const evidence = acceptedEvidence();
  const profile = clone(PROFILE);
  mutator({ event, evidence, profile });
  assert.throws(() => validateAdmission(profile, event, evidence), expression);
}

test('accepts only the fixed replacement Candidate after the authority profile is integrated', () => {
  assert.deepEqual(validateAdmission(PROFILE, acceptedEvent(), acceptedEvidence()).accepted, true);
});

test('accepts a bounded subset of EF-194-only target Base advancement', () => {
  const evidence = acceptedEvidence();
  evidence.targetBaseAdvancePaths = [PROFILE.product.allowedTargetBaseAdvancePaths[0]];
  assert.deepEqual(validateAdmission(PROFILE, acceptedEvent(), evidence).accepted, true);
});

test('release gate accepts the same exact replacement identity only on ordinary pull_request', () => {
  const event = acceptedEvent();
  event.eventName = 'pull_request';
  assert.equal(isFixedSuccessorAttempt(PROFILE, event), true);
  assert.equal(validateAdmission(PROFILE, event, acceptedEvidence(), { expectedEventName: 'pull_request' }).accepted, true);
  event.pullRequest.head.sha = 'cccccccccccccccccccccccccccccccccccccccc';
  assert.equal(isFixedSuccessorAttempt(PROFILE, event), true);
  assert.throws(() => validateAdmission(PROFILE, event, acceptedEvidence(), { expectedEventName: 'pull_request' }), /product head SHA/);
});

test('unrelated pull requests remain on the legacy release gate path', () => {
  const event = acceptedEvent();
  event.eventName = 'pull_request';
  event.pullRequest.head.sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  event.pullRequest.head.ref = 'unrelated-branch';
  assert.equal(isFixedSuccessorAttempt(PROFILE, event), false);
});

test('fixed successor manifest selects only the frozen chat UI regression', () => {
  assert.deepEqual(fixedSuccessorRegressionManifest(PROFILE), {
    schemaVersion: 1,
    kind: 'fixed-successor-release-gate-regression',
    scopeId: 'ef-194-ef161-fixed-successor-release-gate-v1',
    targetedRegressionIds: ['chat-ui-jest-path'],
    targetedTestPath: PROFILE.product.targetedRegression,
    affectedTestPaths: null,
  });
});

test('uses the canonical LF-sorted path digest', () => {
  assert.equal(canonicalPathDigest(PROFILE.product.paths), PROFILE.product.pathDigest);
  assert.throws(() => canonicalPathDigest([...PROFILE.product.paths].reverse()), /canonical/);
});

test('rejects malformed, self-admitting, or missing authority profiles', () => {
  assert.throws(() => validateProfile(null), /malformed/);
  const selfAdmitting = clone(PROFILE);
  selfAdmitting.governanceSelfAdmission = 'allowed';
  assert.throws(() => validateProfile(selfAdmitting), /self-admission/);
  const wrongFloor = clone(PROFILE);
  wrongFloor.authorityFloorSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.throws(() => validateProfile(wrongFloor), /authority floor/);
  const wrongPolicy = clone(PROFILE);
  wrongPolicy.product.headPolicy = 'event-head-single-parent-of-protected-base';
  assert.throws(() => validateProfile(wrongPolicy), /fixed product identity/);
  const wrongHead = clone(PROFILE);
  wrongHead.product.headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.throws(() => validateProfile(wrongHead), /fixed product identity/);
  const wrongParent = clone(PROFILE);
  wrongParent.product.parentSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.throws(() => validateProfile(wrongParent), /fixed product identity/);
  const wrongPatch = clone(PROFILE);
  wrongPatch.product.patchId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.throws(() => validateProfile(wrongPatch), /fixed product identity/);
  const expandedBaseAdvance = clone(PROFILE);
  expandedBaseAdvance.product.allowedTargetBaseAdvancePaths.push('docs/unrelated.md');
  assert.throws(() => validateProfile(expandedBaseAdvance), /target base advance contract/);
  rejected(({ evidence }) => { evidence.profilePresentAtBase = false; }, /absent/);
  rejected(({ evidence }) => { evidence.profileMatchesBase = false; }, /differs/);
});

test('rejects legacy PRs #93 and #99 and unexpected events', () => {
  rejected(({ event }) => { event.pullRequest.number = 93; }, /legacy/);
  rejected(({ event }) => { event.pullRequest.number = 99; }, /legacy/);
  rejected(({ event }) => { event.eventName = 'pull_request'; }, /unexpected/);
  rejected(({ event }) => { event.eventName = 'push'; }, /unexpected/);
  rejected(({ event }) => { event.eventName = undefined; }, /unexpected/);
});

test('rejects successor identity mismatches', () => {
  rejected(({ event }) => { event.pullRequest.head.sha = 'cccccccccccccccccccccccccccccccccccccccc'; }, /product head SHA/);
  rejected(({ event }) => { event.pullRequest.head.ref = 'cell3\/ef-161-current-dev-integration'; }, /source branch/);
  rejected(({ event }) => { event.pullRequest.head.repoFullName = 'other/repo'; }, /source repository/);
  rejected(({ event }) => { event.pullRequest.base.ref = 'main'; }, /target branch/);
  rejected(({ event }) => { event.pullRequest.base.repoFullName = 'other/repo'; }, /target repository/);
});

test('rejects the superseded product Candidate and source identity', () => {
  rejected(({ event, evidence }) => {
    event.pullRequest.head.sha = '17caa29c9dfb2c3488986951171775a3e667651f';
    evidence.candidateResolvedSha = event.pullRequest.head.sha;
  }, /product head SHA/);
  rejected(({ event }) => {
    event.pullRequest.head.ref = 'cell3/ef-161-successor-105a71d';
  }, /source branch/);
  rejected(({ evidence }) => {
    evidence.candidateParentShas = ['105a71db994e8a579923b309bd3f7aad7b70ecab'];
  }, /parent/);
});

test('rejects authority, parent, merge-base, patch, paths, digest, and regression mismatches', () => {
  rejected(({ evidence }) => { evidence.authorityFloorIncluded = false; }, /authority floor/);
  rejected(({ evidence }) => { evidence.productParentIncludedInTargetBase = false; }, /fixed product parent/);
  rejected(({ evidence }) => { evidence.protectedBaseCheckoutSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /protected base checkout/);
  rejected(({ evidence }) => { evidence.candidateParentShas = []; }, /exactly one parent/);
  rejected(({ evidence }) => { evidence.candidateParentShas = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'dddddddddddddddddddddddddddddddddddddddd']; }, /exactly one parent/);
  rejected(({ evidence }) => { evidence.candidateParentShas = ['dddddddddddddddddddddddddddddddddddddddd']; }, /parent/);
  rejected(({ evidence }) => { evidence.candidateMergeBaseSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /merge-base/);
  rejected(({ evidence }) => { evidence.candidatePatchId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /patch ID/);
  rejected(({ evidence }) => { evidence.changedPaths = [PROFILE.product.paths[0]]; }, /path set/);
  rejected(({ evidence }) => { evidence.changedPaths = [...PROFILE.product.paths, 'unexpected']; }, /path set/);
  rejected(({ evidence }) => { evidence.changedPaths = [PROFILE.product.paths[0], PROFILE.product.paths[0]]; }, /canonical/);
  rejected(({ evidence }) => { evidence.targetedRegression = 'client/other.test.tsx'; }, /targeted regression/);
  rejected(({ evidence }) => { evidence.targetBaseAdvancePaths = ['docs/unrelated.md']; }, /non-EF194/);
  rejected(({ evidence }) => { evidence.targetBaseAdvancePaths = [PROFILE.product.paths[0]]; }, /overlaps fixed product/);
});

test('rejects candidate attempts to authorize itself or alter the control plane', () => {
  rejected(({ evidence }) => {
    evidence.candidateControlPlanePaths = ['scripts/fixed-pr-admission.profile.json'];
  }, /self-authorization/);
});

test('rejects targeted regression substitution or omission in the profile itself', () => {
  const missing = clone(PROFILE);
  missing.product.paths = [PROFILE.product.paths[1]];
  missing.product.pathCount = 1;
  missing.product.pathDigest = canonicalPathDigest(missing.product.paths);
  assert.throws(() => validateProfile(missing), /fixed path contract/);
  const substituted = clone(PROFILE);
  substituted.product.targetedRegression = PROFILE.product.paths[1];
  assert.throws(() => validateProfile(substituted), /fixed product identity/);
});

test('protected admission workflow is Base-owned, read-only, and never checks out candidate code', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /^name: Protected Fixed PR Admission$/m);
  assert.match(workflow, /^  pull_request_target:\n    branches:\n      - dev$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /path: authority/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /working-directory: authority/);
  assert.match(workflow, /node scripts\/fixed-pr-admission\.mjs/);
  assert.doesNotMatch(workflow, /pull_request\.head\.(sha|ref)|pnpm|npm|yarn|install|cache|artifact|secrets|write|deploy/i);
});

test('candidate-side replacement or removal cannot suppress protected Base admission', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const baseCheckout = workflow.indexOf('ref: ${{ github.event.pull_request.base.sha }}');
  const verifier = workflow.indexOf('node scripts/fixed-pr-admission.mjs');
  assert.ok(baseCheckout >= 0 && verifier > baseCheckout);
  assert.doesNotMatch(workflow, /Checkout candidate|github\.event\.pull_request\.head/);
  rejected(({ evidence }) => { evidence.profilePresentAtBase = false; }, /absent/);
  rejected(({ evidence }) => { evidence.profileMatchesBase = false; }, /differs/);
});
