import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalPathDigest, validateAdmission, validateProfile } from '../fixed-pr-admission.mjs';

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
      number: 95,
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
    productDirectParentSha: PROFILE.product.directParentSha,
    productMergeBaseSha: PROFILE.product.originalMergeBaseSha,
    changedPaths: [...PROFILE.product.paths],
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

test('accepts only a fresh protected pull_request_target successor event after the authority profile is integrated', () => {
  assert.deepEqual(validateAdmission(PROFILE, acceptedEvent(), acceptedEvidence()).accepted, true);
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
  const wrongHead = clone(PROFILE);
  wrongHead.product.headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.throws(() => validateProfile(wrongHead), /fixed product identity/);
  rejected(({ evidence }) => { evidence.profilePresentAtBase = false; }, /absent/);
  rejected(({ evidence }) => { evidence.profileMatchesBase = false; }, /differs/);
});

test('rejects the legacy PR and unexpected events', () => {
  rejected(({ event }) => { event.pullRequest.number = 93; }, /legacy/);
  rejected(({ event }) => { event.eventName = 'pull_request'; }, /unexpected/);
  rejected(({ event }) => { event.eventName = 'push'; }, /unexpected/);
  rejected(({ event }) => { event.eventName = undefined; }, /unexpected/);
});

test('rejects successor identity mismatches', () => {
  rejected(({ event }) => { event.pullRequest.head.sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /head/);
  rejected(({ event }) => { event.pullRequest.head.ref = 'other'; }, /source branch/);
  rejected(({ event }) => { event.pullRequest.head.repoFullName = 'other/repo'; }, /source repository/);
  rejected(({ event }) => { event.pullRequest.base.ref = 'main'; }, /target branch/);
  rejected(({ event }) => { event.pullRequest.base.repoFullName = 'other/repo'; }, /target repository/);
});

test('rejects authority, parent, merge-base, paths, digest, and regression mismatches', () => {
  rejected(({ evidence }) => { evidence.authorityFloorIncluded = false; }, /authority floor/);
  rejected(({ evidence }) => { evidence.protectedBaseCheckoutSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /protected base checkout/);
  rejected(({ evidence }) => { evidence.productDirectParentSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /parent/);
  rejected(({ evidence }) => { evidence.productMergeBaseSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, /merge-base/);
  rejected(({ evidence }) => { evidence.changedPaths = [PROFILE.product.paths[0]]; }, /path set/);
  rejected(({ evidence }) => { evidence.changedPaths = [...PROFILE.product.paths, 'unexpected']; }, /path set/);
  rejected(({ evidence }) => { evidence.targetedRegression = 'client/other.test.tsx'; }, /targeted regression/);
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
