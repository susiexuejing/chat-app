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
const releaseWorkflowUrl = new URL('../../.github/workflows/release-gate.yml', import.meta.url);
const DISK_REGISTRY = JSON.parse(await readFile(profileUrl, 'utf8'));

const PRODUCT_PATHS = Object.freeze([
  'client/screens/chat/__tests__/ef175-chat-ui-visual.test.tsx',
  'client/screens/chat/__tests__/ef177-chat-actions.test.tsx',
  'client/screens/chat/components/RoleHeader.tsx',
]);
const BASE_ADVANCE_PATHS = Object.freeze([
  '.gitleaks.toml',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/fixed-pr-admission.test.mjs',
  'scripts/fixed-pr-admission.mjs',
  'scripts/fixed-pr-admission.profile.json',
]);
const REGISTRY_PATHS = Object.freeze([
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/fixed-pr-admission.test.mjs',
  'scripts/fixed-pr-admission.profile.json',
]);
const CORRECTIVE_PATHS = Object.freeze([
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/fixed-pr-admission.test.mjs',
  'scripts/fixed-pr-admission.mjs',
  'scripts/fixed-pr-admission.profile.json',
]);
const QA_BASE = '2'.repeat(40);
const QA_HEAD = '1'.repeat(40);
const CURRENT_BASE = '3'.repeat(40);
const INTEGRATION_HEAD = '4'.repeat(40);
const PATCH_ID = '5'.repeat(40);
const REGISTRY_MERGE = '6'.repeat(40);
const REGISTRY_HEAD = '7'.repeat(40);
const CORRECTIVE_CANDIDATE = '8'.repeat(40);
const PROTECTED_BASE = '9'.repeat(40);
const PROTECTED_TREE = 'a'.repeat(40);
const PERMANENTLY_REJECTED = 'a1577f161d644dddcda6b6c6485a344d2869e9ae';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function registryWithRecord() {
  return {
    schemaVersion: 4,
    kind: 'base-owned-current-base-integration-registry',
    authority: {
      repository: 'susiexuejing/chat-app',
      targetBranch: 'dev',
      governanceSelfAdmission: 'forbidden',
      recordOrder: 'id-lf-ascending',
    },
    records: [{
      id: 'ef-107-current-base-fixture-v1',
      ticket: 'EF-107',
      productQa: {
        headSha: QA_HEAD,
        parentSha: QA_BASE,
        originalBaseSha: QA_BASE,
        mergeBaseSha: QA_BASE,
        patchId: PATCH_ID,
        paths: [...PRODUCT_PATHS],
        pathCount: PRODUCT_PATHS.length,
        pathDigest: canonicalPathDigest(PRODUCT_PATHS),
      },
      integration: {
        headSha: INTEGRATION_HEAD,
        parentSha: CURRENT_BASE,
        currentBaseSha: CURRENT_BASE,
        mergeBaseSha: CURRENT_BASE,
        patchId: PATCH_ID,
        sourceRepository: 'susiexuejing/chat-app',
        sourceBranch: 'cell2/ef107-current-base-fixture',
        targetBranch: 'dev',
        paths: [...PRODUCT_PATHS],
        pathCount: PRODUCT_PATHS.length,
        pathDigest: canonicalPathDigest(PRODUCT_PATHS),
      },
      baseAdvance: {
        fromSha: QA_BASE,
        toSha: CURRENT_BASE,
        commitCount: 17,
        paths: [...BASE_ADVANCE_PATHS],
        pathCount: BASE_ADVANCE_PATHS.length,
        pathDigest: canonicalPathDigest(BASE_ADVANCE_PATHS),
        zeroProductPathOverlap: true,
      },
      protectedGovernanceChain: {
        productBaseSha: CURRENT_BASE,
        registryMergeSha: REGISTRY_MERGE,
        registryHeadSha: REGISTRY_HEAD,
        registryMergeParentShas: [CURRENT_BASE, REGISTRY_HEAD],
        registryPaths: [...REGISTRY_PATHS],
        registryPathCount: REGISTRY_PATHS.length,
        registryPathDigest: canonicalPathDigest(REGISTRY_PATHS),
        correctiveParentSha: REGISTRY_MERGE,
        correctivePaths: [...CORRECTIVE_PATHS],
        correctivePathCount: CORRECTIVE_PATHS.length,
        correctivePathDigest: canonicalPathDigest(CORRECTIVE_PATHS),
        permanentlyRejectedCandidateShas: [PERMANENTLY_REJECTED],
        zeroProductPathOverlap: true,
      },
      regression: {
        selector: 'chat-ui-jest-path',
        outputManifest: {
          schemaVersion: 2,
          targetedRegressionIds: ['chat-ui-jest-path'],
          targetedTestPath: null,
          affectedTestPaths: PRODUCT_PATHS.slice(0, 2),
        },
      },
      qaAuditReference: 'EF-107:independent-qa:fixture',
    }],
  };
}

function acceptedEvent(eventName = 'pull_request_target') {
  const record = registryWithRecord().records[0];
  return {
    eventName,
    pullRequest: {
      number: 123,
      head: {
        sha: record.integration.headSha,
        ref: record.integration.sourceBranch,
        repoFullName: record.integration.sourceRepository,
      },
      base: {
        sha: PROTECTED_BASE,
        ref: record.integration.targetBranch,
        repoFullName: record.integration.sourceRepository,
      },
    },
  };
}

function acceptedEvidence() {
  const record = registryWithRecord().records[0];
  return {
    protectedBaseCheckoutSha: PROTECTED_BASE,
    productOriginalBaseIncludedInCurrentBase: true,
    candidateResolvedSha: record.integration.headSha,
    candidateParentShas: [record.integration.currentBaseSha],
    candidateMergeBaseSha: record.integration.currentBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths: [...record.baseAdvance.paths],
    baseAdvanceCommitCount: record.baseAdvance.commitCount,
    registryMergeIncludedInProtectedBase: true,
    registryMergeParentShas: [...record.protectedGovernanceChain.registryMergeParentShas],
    registryMergePaths: [...record.protectedGovernanceChain.registryPaths],
    registryMergeCommitCount: 2,
    correctiveCandidateSha: CORRECTIVE_CANDIDATE,
    protectedBaseParentShas: [REGISTRY_MERGE, CORRECTIVE_CANDIDATE],
    correctiveCandidateParentShas: [REGISTRY_MERGE],
    protectedBaseTreeSha: PROTECTED_TREE,
    correctiveCandidateTreeSha: PROTECTED_TREE,
    protectedGovernanceCommitCount: 2,
    protectedGovernancePaths: [...record.protectedGovernanceChain.correctivePaths],
    registryPresentAtBase: true,
    registryMatchesBase: true,
    candidateProvidedAuthority: false,
  };
}

function rejected(mutator, expression, eventName = 'pull_request_target') {
  const registry = registryWithRecord();
  const event = acceptedEvent(eventName);
  const evidence = acceptedEvidence();
  mutator({ registry, event, evidence, record: registry.records[0] });
  assert.throws(() => validateAdmission(registry, event, evidence, { expectedEventName: eventName }), expression);
}

test('on-disk authority grants only the frozen EF-177 current-Base product identity', () => {
  assert.deepEqual(validateProfile(DISK_REGISTRY), DISK_REGISTRY);
  assert.equal(DISK_REGISTRY.records.length, 1);
  assert.deepEqual(DISK_REGISTRY.records[0], {
    id: 'ef-177-fa24d37-current-base-v1',
    ticket: 'EF-177',
    productQa: {
      headSha: 'fa24d37ddb9d57a97708e1b5bc9cfaadf0e11410',
      parentSha: 'fed71b289db431370f8789163d7d3c5602936689',
      originalBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
      mergeBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
      patchId: '13048554cc0abb329720a51fe69d0afbeb0a05d0',
      paths: [...PRODUCT_PATHS],
      pathCount: PRODUCT_PATHS.length,
      pathDigest: canonicalPathDigest(PRODUCT_PATHS),
    },
    integration: {
      headSha: 'fa24d37ddb9d57a97708e1b5bc9cfaadf0e11410',
      parentSha: 'fed71b289db431370f8789163d7d3c5602936689',
      currentBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
      mergeBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
      patchId: '13048554cc0abb329720a51fe69d0afbeb0a05d0',
      sourceRepository: 'susiexuejing/chat-app',
      sourceBranch: 'cell1/ef177-currentbase-fa24d37',
      targetBranch: 'dev',
      paths: [...PRODUCT_PATHS],
      pathCount: PRODUCT_PATHS.length,
      pathDigest: canonicalPathDigest(PRODUCT_PATHS),
    },
    baseAdvance: {
      fromSha: 'fed71b289db431370f8789163d7d3c5602936689',
      toSha: 'fed71b289db431370f8789163d7d3c5602936689',
      commitCount: 0,
      paths: [],
      pathCount: 0,
      pathDigest: canonicalPathDigest([]),
      zeroProductPathOverlap: true,
    },
    protectedGovernanceChain: {
      productBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
      registryMergeSha: 'd95ecc6eb125f069b3510f2875e0b620a330bc52',
      registryHeadSha: 'da3c35e8eab5097750bee9d0163c8b7be4ddd430',
      registryMergeParentShas: [
        'fed71b289db431370f8789163d7d3c5602936689',
        'da3c35e8eab5097750bee9d0163c8b7be4ddd430',
      ],
      registryPaths: [...REGISTRY_PATHS],
      registryPathCount: REGISTRY_PATHS.length,
      registryPathDigest: canonicalPathDigest(REGISTRY_PATHS),
      correctiveParentSha: 'd95ecc6eb125f069b3510f2875e0b620a330bc52',
      correctivePaths: [...CORRECTIVE_PATHS],
      correctivePathCount: CORRECTIVE_PATHS.length,
      correctivePathDigest: canonicalPathDigest(CORRECTIVE_PATHS),
      permanentlyRejectedCandidateShas: [PERMANENTLY_REJECTED],
      zeroProductPathOverlap: true,
    },
    regression: {
      selector: 'chat-ui-jest-path',
      outputManifest: {
        schemaVersion: 2,
        targetedRegressionIds: ['chat-ui-jest-path'],
        targetedTestPath: null,
        affectedTestPaths: PRODUCT_PATHS.slice(0, 2),
      },
    },
    qaAuditReference: 'EF-177:independent-r2-qa:fa24d37ddb9d57a97708e1b5bc9cfaadf0e11410',
  });

  const record = DISK_REGISTRY.records[0];
  const event = {
    eventName: 'pull_request_target',
    pullRequest: {
      number: 126,
      head: {
        sha: record.integration.headSha,
        ref: record.integration.sourceBranch,
        repoFullName: record.integration.sourceRepository,
      },
      base: {
        sha: PROTECTED_BASE,
        ref: record.integration.targetBranch,
        repoFullName: record.integration.sourceRepository,
      },
    },
  };
  const evidence = {
    protectedBaseCheckoutSha: PROTECTED_BASE,
    productOriginalBaseIncludedInCurrentBase: true,
    candidateResolvedSha: record.integration.headSha,
    candidateParentShas: [record.integration.currentBaseSha],
    candidateMergeBaseSha: record.integration.currentBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths: [],
    baseAdvanceCommitCount: 0,
    registryMergeIncludedInProtectedBase: true,
    registryMergeParentShas: [...record.protectedGovernanceChain.registryMergeParentShas],
    registryMergePaths: [...record.protectedGovernanceChain.registryPaths],
    registryMergeCommitCount: 2,
    correctiveCandidateSha: CORRECTIVE_CANDIDATE,
    protectedBaseParentShas: [record.protectedGovernanceChain.registryMergeSha, CORRECTIVE_CANDIDATE],
    correctiveCandidateParentShas: [record.protectedGovernanceChain.registryMergeSha],
    protectedBaseTreeSha: PROTECTED_TREE,
    correctiveCandidateTreeSha: PROTECTED_TREE,
    protectedGovernanceCommitCount: 2,
    protectedGovernancePaths: [...record.protectedGovernanceChain.correctivePaths],
    registryPresentAtBase: true,
    registryMatchesBase: true,
    candidateProvidedAuthority: false,
  };
  assert.equal(validateAdmission(DISK_REGISTRY, event, evidence).accepted, true);
  assert.equal(validateAdmission(DISK_REGISTRY, { ...event, eventName: 'pull_request' }, evidence, { expectedEventName: 'pull_request' }).accepted, true);
  assert.throws(() => validateAdmission(DISK_REGISTRY, { ...event, pullRequest: { ...event.pullRequest, head: { ...event.pullRequest.head, sha: '0'.repeat(40) } } }, evidence), /integration head SHA/);
  assert.throws(() => validateAdmission(DISK_REGISTRY, { ...event, pullRequest: { ...event.pullRequest, head: { ...event.pullRequest.head, ref: 'cell1/ef177-wrong' } } }, evidence), /no unique Base-owned registry match/);
  assert.throws(() => validateAdmission(DISK_REGISTRY, event, { ...evidence, candidateProvidedAuthority: true }), /candidate-provided authority/);
});

test('same registry record admits both protected and release gate identities', () => {
  const registry = registryWithRecord();
  assert.equal(validateAdmission(registry, acceptedEvent(), acceptedEvidence()).accepted, true);
  assert.equal(validateAdmission(registry, acceptedEvent('pull_request'), acceptedEvidence(), { expectedEventName: 'pull_request' }).accepted, true);
  assert.equal(isFixedSuccessorAttempt(registry, acceptedEvent('pull_request')), true);
});

test('release output is exactly the Base-owned selector manifest', () => {
  const registry = registryWithRecord();
  const manifest = fixedSuccessorRegressionManifest(registry, acceptedEvent('pull_request'));
  assert.deepEqual(manifest, registry.records[0].regression.outputManifest);
  manifest.affectedTestPaths.pop();
  assert.equal(registry.records[0].regression.outputManifest.affectedTestPaths.length, 2);
});

test('registry enforces schema version, exact keys, self-admission prohibition, and canonical record order', () => {
  const wrongSchema = registryWithRecord();
  wrongSchema.schemaVersion = 1;
  assert.throws(() => validateProfile(wrongSchema), /malformed registry/);
  const extraKey = registryWithRecord();
  extraKey.extra = true;
  assert.throws(() => validateProfile(extraKey), /registry keys/);
  const selfAdmitting = registryWithRecord();
  selfAdmitting.authority.governanceSelfAdmission = 'allowed';
  assert.throws(() => validateProfile(selfAdmitting), /self-admission/);
  const extraAuthorityKey = registryWithRecord();
  extraAuthorityKey.authority.fallback = 'allowed';
  assert.throws(() => validateProfile(extraAuthorityKey), /authority keys/);
  const extraRecordKey = registryWithRecord();
  extraRecordKey.records[0].fallback = true;
  assert.throws(() => validateProfile(extraRecordKey), /registry record keys/);
  const missingRecordId = registryWithRecord();
  delete missingRecordId.records[0].id;
  assert.throws(() => validateProfile(missingRecordId), /canonical ID-sorted|registry record keys/);
  const unordered = registryWithRecord();
  const second = clone(unordered.records[0]);
  second.id = 'aa-earlier';
  second.integration.headSha = '6'.repeat(40);
  second.integration.sourceBranch = 'cell2/another';
  unordered.records.push(second);
  assert.throws(() => validateProfile(unordered), /canonical ID-sorted/);
});

test('registry rejects duplicate source and Head identities', () => {
  const duplicateSource = registryWithRecord();
  const second = clone(duplicateSource.records[0]);
  second.id = 'zz-second';
  second.integration.headSha = '6'.repeat(40);
  duplicateSource.records.push(second);
  assert.throws(() => validateProfile(duplicateSource), /duplicate integration source/);
  const duplicateHead = registryWithRecord();
  const third = clone(duplicateHead.records[0]);
  third.id = 'zz-third';
  third.integration.sourceBranch = 'cell2/different';
  duplicateHead.records.push(third);
  assert.throws(() => validateProfile(duplicateHead), /duplicate integration head/);
});

test('QA product and integration identities are separate but patch and paths must be equivalent', () => {
  const registry = registryWithRecord();
  assert.notEqual(registry.records[0].productQa.headSha, registry.records[0].integration.headSha);
  const wrongPatch = registryWithRecord();
  wrongPatch.records[0].integration.patchId = '6'.repeat(40);
  assert.throws(() => validateProfile(wrongPatch), /stable patch ID/);
  const wrongPaths = registryWithRecord();
  wrongPaths.records[0].integration.paths = wrongPaths.records[0].integration.paths.slice(0, 2);
  wrongPaths.records[0].integration.pathCount = 2;
  wrongPaths.records[0].integration.pathDigest = canonicalPathDigest(wrongPaths.records[0].integration.paths);
  assert.throws(() => validateProfile(wrongPaths), /product path contract/);
});

test('integration identity requires current Base as exact parent and merge-base', () => {
  const wrongParent = registryWithRecord();
  wrongParent.records[0].integration.parentSha = '6'.repeat(40);
  assert.throws(() => validateProfile(wrongParent), /parent\/current Base/);
  const wrongMergeBase = registryWithRecord();
  wrongMergeBase.records[0].integration.mergeBaseSha = '6'.repeat(40);
  assert.throws(() => validateProfile(wrongMergeBase), /merge-base\/current Base/);
  rejected(({ evidence }) => { evidence.candidateParentShas = []; }, /exactly one parent/);
  rejected(({ evidence }) => { evidence.candidateParentShas = [CURRENT_BASE, QA_BASE]; }, /exactly one parent/);
  rejected(({ evidence }) => { evidence.candidateParentShas = [QA_BASE]; }, /candidate parent/);
  rejected(({ evidence }) => { evidence.candidateMergeBaseSha = QA_BASE; }, /candidate merge-base/);
});

test('event identity rejects wrong Head, Base, source, target, repository, and event', () => {
  rejected(({ event }) => { event.pullRequest.head.sha = '6'.repeat(40); }, /integration head/);
  rejected(({ event }) => { event.pullRequest.base.sha = '6'.repeat(40); }, /protected Base checkout/);
  rejected(({ event }) => { event.pullRequest.head.ref = 'cell2/wrong'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.pullRequest.base.ref = 'main'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.pullRequest.head.repoFullName = 'other/repo'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.eventName = 'push'; }, /event mismatch/);
});

test('protected governance chain accepts only one audited registry merge plus one Bootstrap corrective merge', () => {
  rejected(({ evidence }) => { evidence.registryMergeIncludedInProtectedBase = false; }, /registry merge is not included/);
  rejected(({ evidence }) => { evidence.registryMergeParentShas.reverse(); }, /registry merge parent topology/);
  rejected(({ evidence }) => { evidence.registryMergeCommitCount = 3; }, /registry merge commit count/);
  rejected(({ evidence }) => { evidence.registryMergePaths.push('scripts/unapproved-registry.mjs'); }, /registry governance path set/);
  rejected(({ evidence }) => { evidence.protectedBaseParentShas.reverse(); }, /corrective merge parent topology/);
  rejected(({ evidence }) => { evidence.correctiveCandidateParentShas = [REGISTRY_MERGE, CURRENT_BASE]; }, /single-parent registry merge/);
  rejected(({ evidence }) => { evidence.protectedBaseTreeSha = 'b'.repeat(40); }, /corrective merge tree/);
  rejected(({ evidence }) => { evidence.protectedGovernanceCommitCount = 3; }, /protected governance chain commit count/);
  rejected(({ evidence }) => { evidence.protectedGovernancePaths.push('scripts/unapproved-corrective.mjs'); }, /corrective governance path set/);
  rejected(({ evidence }) => { evidence.protectedGovernancePaths.push(PRODUCT_PATHS[0]); evidence.protectedGovernancePaths.sort(); }, /corrective governance path set|overlaps product paths/);
});

test('the failed a1577f corrective Candidate is permanently rejected', () => {
  rejected(({ evidence }) => {
    evidence.correctiveCandidateSha = PERMANENTLY_REJECTED;
    evidence.protectedBaseParentShas[1] = PERMANENTLY_REJECTED;
  }, /permanently rejected governance candidate/);
  rejected(({ event, evidence }) => {
    event.pullRequest.base.sha = PERMANENTLY_REJECTED;
    evidence.protectedBaseCheckoutSha = PERMANENTLY_REJECTED;
  }, /permanently rejected governance candidate/);
});

test('profile rejects governance topology, path, overlap, and rejected-SHA ambiguity', () => {
  const wrongRegistryTopology = registryWithRecord();
  wrongRegistryTopology.records[0].protectedGovernanceChain.registryMergeParentShas.reverse();
  assert.throws(() => validateProfile(wrongRegistryTopology), /registry merge parent topology/);
  const wrongCorrectiveParent = registryWithRecord();
  wrongCorrectiveParent.records[0].protectedGovernanceChain.correctiveParentSha = CURRENT_BASE;
  assert.throws(() => validateProfile(wrongCorrectiveParent), /corrective parent\/registry merge/);
  const overlap = registryWithRecord();
  overlap.records[0].protectedGovernanceChain.correctivePaths.push(PRODUCT_PATHS[0]);
  overlap.records[0].protectedGovernanceChain.correctivePaths.sort();
  overlap.records[0].protectedGovernanceChain.correctivePathCount += 1;
  overlap.records[0].protectedGovernanceChain.correctivePathDigest = canonicalPathDigest(overlap.records[0].protectedGovernanceChain.correctivePaths);
  assert.throws(() => validateProfile(overlap), /overlaps product paths/);
  const duplicatedRejected = registryWithRecord();
  duplicatedRejected.records[0].protectedGovernanceChain.permanentlyRejectedCandidateShas.push(PERMANENTLY_REJECTED);
  assert.throws(() => validateProfile(duplicatedRejected), /not canonical/);
});

test('observed patch must match both the QA product and integration records', () => {
  rejected(({ evidence }) => { evidence.candidatePatchId = '6'.repeat(40); }, /QA product patch equivalence/);
  rejected(({ registry }) => { registry.records[0].productQa.patchId = '6'.repeat(40); }, /stable patch ID/);
});

test('changed product paths and their digest are exact, canonical, and unchanged from QA', () => {
  rejected(({ evidence }) => { evidence.changedPaths = PRODUCT_PATHS.slice(0, 2); }, /changed path set/);
  rejected(({ evidence }) => { evidence.changedPaths.push('client/unapproved.ts'); }, /changed path set/);
  rejected(({ evidence }) => { evidence.changedPaths.reverse(); }, /canonical/);
  rejected(({ registry }) => { registry.records[0].integration.pathDigest = '6'.repeat(64); }, /integration path digest/);
});

test('Base advancement count, paths, digest, and zero-overlap are exact', () => {
  rejected(({ evidence }) => { evidence.baseAdvanceCommitCount += 1; }, /commit count/);
  rejected(({ evidence }) => { evidence.baseAdvancePaths = evidence.baseAdvancePaths.slice(1); }, /Base advance path set/);
  rejected(({ evidence }) => { evidence.baseAdvancePaths.reverse(); }, /canonical/);
  const overlap = registryWithRecord();
  overlap.records[0].baseAdvance.paths = [...overlap.records[0].baseAdvance.paths, PRODUCT_PATHS[0]].sort((a, b) => a.localeCompare(b));
  overlap.records[0].baseAdvance.pathCount = overlap.records[0].baseAdvance.paths.length;
  overlap.records[0].baseAdvance.pathDigest = canonicalPathDigest(overlap.records[0].baseAdvance.paths);
  assert.throws(() => validateProfile(overlap), /overlaps product paths/);
  const flag = registryWithRecord();
  flag.records[0].baseAdvance.zeroProductPathOverlap = false;
  assert.throws(() => validateProfile(flag), /overlaps product paths/);
});

test('zero Base advancement is represented explicitly without a fabricated path', () => {
  const registry = registryWithRecord();
  const record = registry.records[0];
  record.productQa.parentSha = CURRENT_BASE;
  record.productQa.originalBaseSha = CURRENT_BASE;
  record.productQa.mergeBaseSha = CURRENT_BASE;
  record.baseAdvance.fromSha = CURRENT_BASE;
  record.baseAdvance.commitCount = 0;
  record.baseAdvance.paths = [];
  record.baseAdvance.pathCount = 0;
  record.baseAdvance.pathDigest = canonicalPathDigest([]);
  const evidence = acceptedEvidence();
  evidence.baseAdvanceCommitCount = 0;
  evidence.baseAdvancePaths = [];
  evidence.productOriginalBaseIncludedInCurrentBase = true;
  assert.equal(validateAdmission(registry, acceptedEvent(), evidence).accepted, true);
  record.baseAdvance.commitCount = 1;
  assert.throws(() => validateProfile(registry), /inconsistent zero Base advance/);
});

test('candidate-supplied or candidate-modified authority is always rejected', () => {
  rejected(({ evidence }) => { evidence.candidateProvidedAuthority = true; }, /candidate-provided authority/);
  rejected(({ evidence }) => { evidence.candidateControlPlanePaths = ['scripts/fixed-pr-admission.profile.json']; }, /self-authorization/);
  rejected(({ evidence }) => { evidence.registryPresentAtBase = false; }, /absent/);
  rejected(({ evidence }) => { evidence.registryMatchesBase = false; }, /differs/);
});

test('regression selector and output manifest are exact and bounded to product tests', () => {
  const wrongSelector = registryWithRecord();
  wrongSelector.records[0].regression.selector = 'release-gate-contract';
  assert.throws(() => validateProfile(wrongSelector), /regression selector/);
  const wrongOutput = registryWithRecord();
  wrongOutput.records[0].regression.outputManifest.targetedRegressionIds = ['release-gate-contract'];
  assert.throws(() => validateProfile(wrongOutput), /targeted regression IDs/);
  const extraOutput = registryWithRecord();
  extraOutput.records[0].regression.outputManifest.fallback = true;
  assert.throws(() => validateProfile(extraOutput), /output manifest keys/);
  const externalTest = registryWithRecord();
  externalTest.records[0].regression.outputManifest.affectedTestPaths = ['client/screens/chat/__tests__/not-approved.test.ts'];
  assert.throws(() => validateProfile(externalTest), /outside product paths/);
  const duplicateTest = registryWithRecord();
  duplicateTest.records[0].regression.outputManifest.affectedTestPaths = [PRODUCT_PATHS[0], PRODUCT_PATHS[0]];
  assert.throws(() => validateProfile(duplicateTest), /canonical/);
});

test('QA audit reference is structurally recorded but does not authorize admission', () => {
  const registry = registryWithRecord();
  registry.records[0].qaAuditReference = 'EF-107:another-audit-record';
  assert.equal(validateAdmission(registry, acceptedEvent(), acceptedEvidence()).accepted, true);
  registry.records[0].qaAuditReference = '';
  assert.throws(() => validateProfile(registry), /QA audit reference/);
});

test('unknown source identity is not applicable to release routing and fails protected admission', () => {
  const registry = registryWithRecord();
  const event = acceptedEvent('pull_request');
  event.pullRequest.head.ref = 'cell2/unregistered';
  assert.equal(isFixedSuccessorAttempt(registry, event), false);
  event.eventName = 'pull_request_target';
  assert.throws(() => validateAdmission(registry, event, acceptedEvidence()), /no unique Base-owned registry match/);
});

test('protected admission workflow reads only protected Base authority and never candidate code', async () => {
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

test('release gate selects and verifies the same Base-owned record before executing its manifest', async () => {
  const workflow = await readFile(releaseWorkflowUrl, 'utf8');
  assert.match(workflow, /name: Select Base-owned fixed successor admission[\s\S]*working-directory: authority/);
  assert.match(workflow, /node scripts\/fixed-pr-admission\.mjs[\s\S]*--release-gate-output "\$RUNNER_TEMP\/ef194-fixed-successor-manifest\.json"[\s\S]*--candidate-root "\$GITHUB_WORKSPACE\/candidate"/);
  assert.match(workflow, /case "\$STATUS" in[\s\S]*0\)[\s\S]*accepted=true[\s\S]*2\)[\s\S]*accepted=false[\s\S]*\*\)[\s\S]*exit "\$STATUS"/);
  assert.match(workflow, /steps\.fixed_successor\.outputs\.accepted == 'true'[\s\S]*--manifest "\$RUNNER_TEMP\/ef194-fixed-successor-manifest\.json"/);
});
