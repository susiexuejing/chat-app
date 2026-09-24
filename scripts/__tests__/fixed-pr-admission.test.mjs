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
const AUTHORITY_BOOTSTRAP_PATHS = Object.freeze([
  '.github/workflows/protected-fixed-pr-admission.yml',
  '.github/workflows/release-gate.yml',
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
const CORRECTIVE_MERGE = '9'.repeat(40);
const AUTHORITY_BOOTSTRAP_CANDIDATE = 'b'.repeat(40);
const PROTECTED_BASE = 'c'.repeat(40);
const PROTECTED_TREE = 'a'.repeat(40);
const PERMANENTLY_REJECTED = 'a1577f161d644dddcda6b6c6485a344d2869e9ae';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function registryWithRecord() {
  return {
    schemaVersion: 5,
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
        kind: 'legacy-two-parent-merge',
        historicProductBaseSha: QA_BASE,
        registryMergeSha: REGISTRY_MERGE,
        registryHeadSha: REGISTRY_HEAD,
        registryMergeParentShas: [QA_BASE, REGISTRY_HEAD],
        registryPaths: [...REGISTRY_PATHS],
        registryPathCount: REGISTRY_PATHS.length,
        registryPathDigest: canonicalPathDigest(REGISTRY_PATHS),
        correctiveParentSha: REGISTRY_MERGE,
        correctiveMergeSha: CORRECTIVE_MERGE,
        correctiveHeadSha: CORRECTIVE_CANDIDATE,
        correctiveMergeParentShas: [REGISTRY_MERGE, CORRECTIVE_CANDIDATE],
        correctivePaths: [...CORRECTIVE_PATHS],
        correctivePathCount: CORRECTIVE_PATHS.length,
        correctivePathDigest: canonicalPathDigest(CORRECTIVE_PATHS),
        authorityBootstrapParentSha: CORRECTIVE_MERGE,
        authorityBootstrapPaths: [...AUTHORITY_BOOTSTRAP_PATHS],
        authorityBootstrapPathCount: AUTHORITY_BOOTSTRAP_PATHS.length,
        authorityBootstrapPathDigest: canonicalPathDigest(AUTHORITY_BOOTSTRAP_PATHS),
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
    authoritySnapshotSha: PROTECTED_BASE,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    productOriginalBaseIncludedInAuthoritySnapshot: true,
    candidateResolvedSha: record.integration.headSha,
    candidateParentShas: [record.integration.currentBaseSha],
    candidateMergeBaseSha: record.integration.currentBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths: [...record.baseAdvance.paths],
    baseAdvanceCommitCount: record.baseAdvance.commitCount,
    registryMergeIncludedInAuthoritySnapshot: true,
    registryMergeParentShas: [...record.protectedGovernanceChain.registryMergeParentShas],
    registryMergePaths: [...record.protectedGovernanceChain.registryPaths],
    registryMergeCommitCount: 2,
    correctiveMergeIncludedInAuthoritySnapshot: true,
    correctiveMergeSha: CORRECTIVE_MERGE,
    correctiveMergeParentShas: [REGISTRY_MERGE, CORRECTIVE_CANDIDATE],
    correctiveCandidateSha: CORRECTIVE_CANDIDATE,
    correctiveCandidateParentShas: [REGISTRY_MERGE],
    correctiveMergeTreeSha: PROTECTED_TREE,
    correctiveCandidateTreeSha: PROTECTED_TREE,
    correctiveGovernanceCommitCount: 2,
    correctiveGovernancePaths: [...record.protectedGovernanceChain.correctivePaths],
    authorityBootstrapParentIncludedInSnapshot: true,
    authoritySnapshotParentShas: [CORRECTIVE_MERGE, AUTHORITY_BOOTSTRAP_CANDIDATE],
    authorityBootstrapCandidateSha: AUTHORITY_BOOTSTRAP_CANDIDATE,
    authorityBootstrapCandidateParentShas: [CORRECTIVE_MERGE],
    authoritySnapshotTreeSha: PROTECTED_TREE,
    authorityBootstrapCandidateTreeSha: PROTECTED_TREE,
    authorityBootstrapCommitCount: 2,
    authorityBootstrapPaths: [...record.protectedGovernanceChain.authorityBootstrapPaths],
    registryPresentAtSnapshot: true,
    registryMatchesSnapshot: true,
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

test('on-disk authority preserves EF-177 legacy identity and adds the exact EF-107 squash anchor', () => {
  assert.deepEqual(validateProfile(DISK_REGISTRY), DISK_REGISTRY);
  assert.deepEqual(DISK_REGISTRY.records.map(record => record.id), [
    'ef-107-1d61b510-current-base-v1',
    'ef-177-fa24d37-current-base-v1',
    'ef-235-pr-138-feda824d-protected-dev-v1',
  ]);
  const ef107 = DISK_REGISTRY.records[0];
  assert.equal(ef107.integration.headSha, '1d61b510043e76b295aca9d989a961a20e590d1b');
  assert.equal(ef107.integration.parentSha, '30d50f74d36094e1a7a34fa5b291b94bcc71098a');
  assert.equal(ef107.integration.patchId, '5dc77fc28805e1a466c508fbe74f12d541180193');
  assert.equal(ef107.integration.sourceBranch, 'cell2/ef107-currentbase-1d61b510');
  assert.equal(ef107.integration.pathDigest, '861c3f91719e85e8bfaf707ac587fbf528c1a7c4197744ac83f5aee6f98b5483');
  assert.deepEqual(ef107.protectedGovernanceChain, {
    kind: 'squash-merge',
    anchorBaseSha: '589ff543efd25df794d10ca8d6bd95a05881b3b6',
    anchorHeadSha: '99faca39e2cfa517e8ab9da12e113987291b3c77',
    anchorSourceBranch: 'cell2/ef177-advanced-base-governance-99faca39',
    anchorMergeSha: '82e26d45213068130c226cadc1acf76f99856843',
    anchorMergeParentShas: ['589ff543efd25df794d10ca8d6bd95a05881b3b6'],
    anchorPaths: [...CORRECTIVE_PATHS],
    anchorPathCount: CORRECTIVE_PATHS.length,
    anchorPathDigest: canonicalPathDigest(CORRECTIVE_PATHS),
    permanentlyRejectedCandidateShas: [PERMANENTLY_REJECTED],
    zeroProductPathOverlap: true,
  });
  assert.deepEqual(DISK_REGISTRY.records[1], {
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
      kind: 'legacy-two-parent-merge',
      historicProductBaseSha: 'fed71b289db431370f8789163d7d3c5602936689',
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
      correctiveMergeSha: 'b968adb3318d3f91aba34d14d3511be77f03d438',
      correctiveHeadSha: 'fbaa3cb8920f1e5d613b6050386be9c2a92a61d8',
      correctiveMergeParentShas: [
        'd95ecc6eb125f069b3510f2875e0b620a330bc52',
        'fbaa3cb8920f1e5d613b6050386be9c2a92a61d8',
      ],
      correctivePaths: [...CORRECTIVE_PATHS],
      correctivePathCount: CORRECTIVE_PATHS.length,
      correctivePathDigest: canonicalPathDigest(CORRECTIVE_PATHS),
      authorityBootstrapParentSha: 'b968adb3318d3f91aba34d14d3511be77f03d438',
      authorityBootstrapPaths: [...AUTHORITY_BOOTSTRAP_PATHS],
      authorityBootstrapPathCount: AUTHORITY_BOOTSTRAP_PATHS.length,
      authorityBootstrapPathDigest: canonicalPathDigest(AUTHORITY_BOOTSTRAP_PATHS),
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

  const record = DISK_REGISTRY.records[1];
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
    authoritySnapshotSha: PROTECTED_BASE,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    productOriginalBaseIncludedInAuthoritySnapshot: true,
    candidateResolvedSha: record.integration.headSha,
    candidateParentShas: [record.integration.currentBaseSha],
    candidateMergeBaseSha: record.integration.currentBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths: [],
    baseAdvanceCommitCount: 0,
    registryMergeIncludedInAuthoritySnapshot: true,
    registryMergeParentShas: [...record.protectedGovernanceChain.registryMergeParentShas],
    registryMergePaths: [...record.protectedGovernanceChain.registryPaths],
    registryMergeCommitCount: 2,
    correctiveMergeIncludedInAuthoritySnapshot: true,
    correctiveMergeSha: record.protectedGovernanceChain.correctiveMergeSha,
    correctiveMergeParentShas: [...record.protectedGovernanceChain.correctiveMergeParentShas],
    correctiveCandidateSha: record.protectedGovernanceChain.correctiveHeadSha,
    correctiveCandidateParentShas: [record.protectedGovernanceChain.correctiveParentSha],
    correctiveMergeTreeSha: PROTECTED_TREE,
    correctiveCandidateTreeSha: PROTECTED_TREE,
    correctiveGovernanceCommitCount: 2,
    correctiveGovernancePaths: [...record.protectedGovernanceChain.correctivePaths],
    authorityBootstrapParentIncludedInSnapshot: true,
    authoritySnapshotParentShas: [record.protectedGovernanceChain.authorityBootstrapParentSha, AUTHORITY_BOOTSTRAP_CANDIDATE],
    authorityBootstrapCandidateSha: AUTHORITY_BOOTSTRAP_CANDIDATE,
    authorityBootstrapCandidateParentShas: [record.protectedGovernanceChain.authorityBootstrapParentSha],
    authoritySnapshotTreeSha: PROTECTED_TREE,
    authorityBootstrapCandidateTreeSha: PROTECTED_TREE,
    authorityBootstrapCommitCount: 2,
    authorityBootstrapPaths: [...record.protectedGovernanceChain.authorityBootstrapPaths],
    registryPresentAtSnapshot: true,
    registryMatchesSnapshot: true,
    candidateProvidedAuthority: false,
  };
  assert.equal(validateAdmission(DISK_REGISTRY, event, evidence).accepted, true);
  assert.throws(() => validateAdmission(DISK_REGISTRY, { ...event, eventName: 'pull_request' }, evidence), /event mismatch/);
  assert.throws(() => validateAdmission(DISK_REGISTRY, { ...event, pullRequest: { ...event.pullRequest, head: { ...event.pullRequest.head, sha: '0'.repeat(40) } } }, evidence), /integration head SHA/);
  assert.throws(() => validateAdmission(DISK_REGISTRY, { ...event, pullRequest: { ...event.pullRequest, head: { ...event.pullRequest.head, ref: 'cell1/ef177-wrong' } } }, evidence), /no unique Base-owned registry match/);
  assert.throws(() => validateAdmission(DISK_REGISTRY, event, { ...evidence, candidateProvidedAuthority: true }), /candidate-provided authority/);
});

test('EF-235 is a single, exact PR #138 admission with its independent 12/12 R2 QA', () => {
  const record = DISK_REGISTRY.records[2];
  assert.deepEqual(record, {
    id: 'ef-235-pr-138-feda824d-protected-dev-v1',
    ticket: 'EF-235',
    pullRequest: {
      number: 138,
      sourceBranch: 'candidate/ef235-owner-binding-bootstrap-successor',
      sourceRepository: 'susiexuejing/chat-app',
      targetBranch: 'dev',
      targetRepository: 'susiexuejing/chat-app',
    },
    identity: {
      headSha: 'feda824d23d3e1291edf0b6dfefcc13fc8f8bc3b',
      parentSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      baseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      mergeBaseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      patchId: 'f4cd68ba3ac0e29df59f03237e60d77a6f83ae50',
      paths: [
        'server/src/__tests__/ef75-chat-ownership.test.ts',
        'server/src/index.ts',
        'server/src/storage/database/protected-owner-binding-bootstrap.ts',
      ],
      pathCount: 3,
      pathDigest: '790adbe4059d695e918bbaec0c23e4c78428ae4d767a42ee1e5438e49f517896',
    },
    independentQa: {
      kind: 'independent-r2',
      headSha: 'feda824d23d3e1291edf0b6dfefcc13fc8f8bc3b',
      baseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      pathDigest: '790adbe4059d695e918bbaec0c23e4c78428ae4d767a42ee1e5438e49f517896',
      passed: 12,
      total: 12,
    },
  });
  const event = {
    eventName: 'pull_request_target',
    pullRequest: {
      number: 138,
      head: { sha: record.identity.headSha, ref: record.pullRequest.sourceBranch, repoFullName: record.pullRequest.sourceRepository },
      base: { sha: record.identity.baseSha, ref: 'dev', repoFullName: record.pullRequest.targetRepository },
    },
  };
  const evidence = {
    protectedBaseCheckoutSha: record.identity.baseSha,
    authoritySnapshotSha: record.identity.baseSha,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    candidateResolvedSha: record.identity.headSha,
    candidateParentShas: [record.identity.parentSha],
    candidateMergeBaseSha: record.identity.mergeBaseSha,
    candidatePatchId: record.identity.patchId,
    changedPaths: [...record.identity.paths],
    candidateControlPlanePaths: [],
  };
  assert.equal(validateAdmission(DISK_REGISTRY, event, evidence).accepted, true);
  for (const mutate of [
    ({ event: candidate }) => { candidate.pullRequest.number = 139; },
    ({ event: candidate }) => { candidate.pullRequest.head.sha = '0'.repeat(40); },
    ({ event: candidate }) => { candidate.pullRequest.base.sha = '0'.repeat(40); },
    ({ evidence: candidate }) => { candidate.candidateParentShas = ['0'.repeat(40)]; },
    ({ evidence: candidate }) => { candidate.candidateMergeBaseSha = '0'.repeat(40); },
    ({ evidence: candidate }) => { candidate.candidatePatchId = '0'.repeat(40); },
    ({ evidence: candidate }) => { candidate.changedPaths = candidate.changedPaths.slice(0, 2); },
    ({ evidence: candidate }) => { candidate.candidateControlPlanePaths = ['scripts/fixed-pr-admission.mjs']; },
  ]) {
    const badEvent = clone(event);
    const badEvidence = clone(evidence);
    mutate({ event: badEvent, evidence: badEvidence });
    assert.throws(() => validateAdmission(DISK_REGISTRY, badEvent, badEvidence), /rejected/);
  }
  for (const mutate of [
    profile => { profile.records[2].ticket = 'EF-999'; },
    profile => { profile.records[2].identity.baseSha = '0'.repeat(40); },
    profile => { profile.records[2].independentQa.passed = 11; },
    profile => { profile.records[2].independentQa.extra = true; },
    profile => { profile.records.push(clone(profile.records[2])); },
  ]) {
    const profile = clone(DISK_REGISTRY);
    mutate(profile);
    assert.throws(() => validateProfile(profile), /EF-235|canonical ID-sorted/);
  }
});

test('same registry record admits both protected pull_request_target gates', () => {
  const registry = registryWithRecord();
  assert.equal(validateAdmission(registry, acceptedEvent(), acceptedEvidence()).accepted, true);
  assert.equal(isFixedSuccessorAttempt(registry, acceptedEvent()), true);
});

test('EF-107 squash anchor is exact and fails closed for topology, identity, and scope mutations', () => {
  const registry = clone(DISK_REGISTRY);
  const record = registry.records[0];
  const chain = record.protectedGovernanceChain;
  const event = {
    eventName: 'pull_request_target',
    pullRequest: {
      number: 132,
      head: {
        sha: record.integration.headSha,
        ref: record.integration.sourceBranch,
        repoFullName: record.integration.sourceRepository,
      },
      base: {
        sha: PROTECTED_BASE,
        ref: 'dev',
        repoFullName: record.integration.sourceRepository,
      },
    },
  };
  const evidence = {
    protectedBaseCheckoutSha: PROTECTED_BASE,
    authoritySnapshotSha: PROTECTED_BASE,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    productOriginalBaseIncludedInAuthoritySnapshot: true,
    candidateResolvedSha: record.integration.headSha,
    candidateParentShas: [record.integration.currentBaseSha],
    candidateMergeBaseSha: record.integration.mergeBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths: [...record.baseAdvance.paths],
    baseAdvanceCommitCount: record.baseAdvance.commitCount,
    anchorMergeIncludedInAuthoritySnapshot: true,
    anchorBaseSha: chain.anchorBaseSha,
    anchorHeadSha: chain.anchorHeadSha,
    anchorSourceBranch: chain.anchorSourceBranch,
    anchorMergeSha: chain.anchorMergeSha,
    anchorMergeParentShas: [...chain.anchorMergeParentShas],
    anchorHeadParentShas: [chain.anchorBaseSha],
    anchorMergeTreeSha: PROTECTED_TREE,
    anchorHeadTreeSha: PROTECTED_TREE,
    anchorCommitCount: 1,
    anchorPaths: [...chain.anchorPaths],
    registryPresentAtSnapshot: true,
    registryMatchesSnapshot: true,
    candidateProvidedAuthority: false,
  };
  assert.equal(validateAdmission(registry, event, evidence).accepted, true);
  evidence.anchorMergeParentShas = ['f'.repeat(40)];
  assert.throws(() => validateAdmission(registry, event, evidence), /squash anchor merge parent topology/);

  const wrongHead = clone(DISK_REGISTRY);
  wrongHead.records[0].protectedGovernanceChain.anchorHeadSha = 'f'.repeat(40);
  assert.doesNotThrow(() => validateProfile(wrongHead));
  assert.throws(() => validateAdmission(wrongHead, event, { ...evidence, anchorMergeParentShas: [...chain.anchorMergeParentShas] }), /squash anchor Head SHA/);

  const wrongTopology = clone(DISK_REGISTRY);
  wrongTopology.records[0].protectedGovernanceChain.anchorMergeParentShas = ['f'.repeat(40)];
  assert.throws(() => validateProfile(wrongTopology), /squash anchor merge parent topology/);
  assert.throws(() => validateAdmission(registry, event, {
    ...evidence,
    anchorMergeParentShas: [...chain.anchorMergeParentShas],
    anchorPaths: [...chain.anchorPaths, 'scripts/unapproved.mjs'].sort((a, b) => a.localeCompare(b)),
  }), /squash anchor governance path set/);
  const extraKey = clone(DISK_REGISTRY);
  extraKey.records[0].protectedGovernanceChain.extra = true;
  assert.throws(() => validateProfile(extraKey), /squash protected governance anchor keys/);
});

test('release output is exactly the Base-owned selector manifest', () => {
  const registry = registryWithRecord();
  const manifest = fixedSuccessorRegressionManifest(registry, acceptedEvent());
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

test('event identity rejects wrong Head, source, target, repository, and event but ignores stale event Base SHA', () => {
  rejected(({ event }) => { event.pullRequest.head.sha = '6'.repeat(40); }, /integration head/);
  const staleBase = acceptedEvent();
  staleBase.pullRequest.base.sha = '6'.repeat(40);
  assert.equal(validateAdmission(registryWithRecord(), staleBase, acceptedEvidence()).accepted, true);
  rejected(({ event }) => { event.pullRequest.head.ref = 'cell2/wrong'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.pullRequest.base.ref = 'main'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.pullRequest.head.repoFullName = 'other/repo'; }, /no unique Base-owned registry match/);
  rejected(({ event }) => { event.eventName = 'push'; }, /event mismatch/);
});

test('protected governance chain accepts only the registry, corrective, and authority Bootstrap merge chain', () => {
  rejected(({ evidence }) => { evidence.registryMergeIncludedInAuthoritySnapshot = false; }, /registry merge is not included/);
  rejected(({ evidence }) => { evidence.registryMergeParentShas.reverse(); }, /registry merge parent topology/);
  rejected(({ evidence }) => { evidence.registryMergeCommitCount = 3; }, /registry merge commit count/);
  rejected(({ evidence }) => { evidence.registryMergePaths.push('scripts/unapproved-registry.mjs'); }, /registry governance path set/);
  rejected(({ evidence }) => { evidence.correctiveMergeIncludedInAuthoritySnapshot = false; }, /corrective merge is not included/);
  rejected(({ evidence }) => { evidence.correctiveMergeParentShas.reverse(); }, /corrective merge parent topology/);
  rejected(({ evidence }) => { evidence.correctiveCandidateParentShas = [REGISTRY_MERGE, CURRENT_BASE]; }, /single-parent registry merge/);
  rejected(({ evidence }) => { evidence.correctiveMergeTreeSha = 'b'.repeat(40); }, /corrective merge tree/);
  rejected(({ evidence }) => { evidence.correctiveGovernanceCommitCount = 3; }, /corrective governance chain commit count/);
  rejected(({ evidence }) => { evidence.correctiveGovernancePaths.push('scripts/unapproved-corrective.mjs'); }, /corrective governance path set/);
  rejected(({ evidence }) => { evidence.authoritySnapshotParentShas.reverse(); }, /authority Bootstrap merge parent topology/);
  rejected(({ evidence }) => { evidence.authorityBootstrapCandidateParentShas = [CORRECTIVE_MERGE, CURRENT_BASE]; }, /single-parent corrective merge/);
  rejected(({ evidence }) => { evidence.authoritySnapshotTreeSha = 'd'.repeat(40); }, /authority Bootstrap merge tree/);
  rejected(({ evidence }) => { evidence.authorityBootstrapCommitCount = 3; }, /authority Bootstrap chain commit count/);
  rejected(({ evidence }) => { evidence.authorityBootstrapPaths.push('scripts/unapproved-v4.mjs'); }, /authority Bootstrap governance path set/);
});

test('the failed a1577f corrective Candidate is permanently rejected', () => {
  rejected(({ evidence }) => {
    evidence.correctiveCandidateSha = PERMANENTLY_REJECTED;
  }, /permanently rejected governance candidate/);
  rejected(({ evidence }) => {
    evidence.authorityBootstrapCandidateSha = PERMANENTLY_REJECTED;
  }, /permanently rejected governance candidate/);
  rejected(({ evidence }) => {
    evidence.authoritySnapshotSha = PERMANENTLY_REJECTED;
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
  record.protectedGovernanceChain.historicProductBaseSha = CURRENT_BASE;
  record.protectedGovernanceChain.registryMergeParentShas[0] = CURRENT_BASE;
  record.baseAdvance.fromSha = CURRENT_BASE;
  record.baseAdvance.commitCount = 0;
  record.baseAdvance.paths = [];
  record.baseAdvance.pathCount = 0;
  record.baseAdvance.pathDigest = canonicalPathDigest([]);
  const evidence = acceptedEvidence();
  evidence.registryMergeParentShas[0] = CURRENT_BASE;
  evidence.baseAdvanceCommitCount = 0;
  evidence.baseAdvancePaths = [];
  evidence.productOriginalBaseIncludedInAuthoritySnapshot = true;
  assert.equal(validateAdmission(registry, acceptedEvent(), evidence).accepted, true);
  record.baseAdvance.commitCount = 1;
  assert.throws(() => validateProfile(registry), /inconsistent zero Base advance/);
});

test('candidate-supplied or candidate-modified authority is always rejected', () => {
  rejected(({ evidence }) => { evidence.candidateProvidedAuthority = true; }, /candidate-provided authority/);
  rejected(({ evidence }) => { evidence.candidateControlPlanePaths = ['scripts/fixed-pr-admission.profile.json']; }, /self-authorization/);
  rejected(({ evidence }) => { evidence.registryPresentAtSnapshot = false; }, /absent/);
  rejected(({ evidence }) => { evidence.registryMatchesSnapshot = false; }, /differs/);
  rejected(({ evidence }) => { evidence.candidateFilesRead = true; }, /candidate file content/);
  rejected(({ evidence }) => { evidence.eventFieldsUsedAsDataOnly = false; }, /data only/);
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
  assert.match(workflow, /^  pull_request_target:\n    types: \[opened, reopened, synchronize, ready_for_review\]\n    branches:\n      - dev$/m);
  assert.match(workflow, /^permissions:\n  contents: read\n  pull-requests: read$/m);
  assert.match(workflow, /ref: refs\/heads\/dev/);
  assert.match(workflow, /EXPECTED_WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(workflow, /path: authority/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /working-directory: authority/);
  assert.match(workflow, /EF_AUTHORITY_SNAPSHOT_SHA: \$\{\{ steps\.authority_snapshot\.outputs\.sha \}\}/);
  assert.match(workflow, /node scripts\/fixed-pr-admission\.mjs/);
  assert.doesNotMatch(workflow, /pull_request\.head|pnpm|npm|yarn|install|cache|artifact|secrets|id-token|write|deploy/i);
});

test('release gate performs authority-only admission and never executes product regressions', async () => {
  const workflow = await readFile(releaseWorkflowUrl, 'utf8');
  assert.match(workflow, /^  pull_request_target:\n    types: \[opened, reopened, synchronize, ready_for_review\]\n    branches:\n      - dev$/m);
  assert.match(workflow, /^permissions:\n  contents: read\n  pull-requests: read$/m);
  assert.match(workflow, /ref: refs\/heads\/dev/);
  assert.match(workflow, /EXPECTED_WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(workflow, /working-directory: authority[\s\S]*EF_AUTHORITY_SNAPSHOT_SHA:[\s\S]*node scripts\/fixed-pr-admission\.mjs/);
  assert.doesNotMatch(workflow, /candidate|pull_request\.head|pnpm|npm|yarn|install|cache|artifact|secrets|id-token|test:release|jest|tsc|deploy/i);
});


test('EF-235 protected archive admits PR #141 only when every recorded identity field matches', () => {
  const record = DISK_REGISTRY.records.find(entry => entry.pullRequest?.number === 141);
  assert.ok(record);
  const event = {
    eventName: 'pull_request_target',
    pullRequest: {
      number: record.pullRequest.number,
      head: {
        sha: record.identity.headSha,
        ref: record.pullRequest.sourceBranch,
        repoFullName: record.pullRequest.sourceRepository,
      },
      base: {
        sha: record.identity.baseSha,
        ref: record.pullRequest.targetBranch,
        repoFullName: record.pullRequest.targetRepository,
      },
    },
  };
  const evidence = {
    protectedBaseCheckoutSha: record.identity.baseSha,
    authoritySnapshotSha: record.identity.baseSha,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    candidateResolvedSha: record.identity.headSha,
    candidateParentShas: [record.identity.parentSha],
    candidateMergeBaseSha: record.identity.mergeBaseSha,
    candidatePatchId: record.identity.patchId,
    changedPaths: [...record.identity.paths],
    candidateControlPlanePaths: [],
  };

  assert.equal(validateAdmission(DISK_REGISTRY, event, evidence).accepted, true);
  assert.throws(() => validateAdmission(
    DISK_REGISTRY,
    { ...event, pullRequest: { ...event.pullRequest, number: 142 } },
    evidence,
  ), /no unique Base-owned registry match/);
  assert.throws(() => validateAdmission(
    DISK_REGISTRY,
    { ...event, pullRequest: { ...event.pullRequest, head: { ...event.pullRequest.head, sha: '0'.repeat(40) } } },
    evidence,
  ), /EF-235 head SHA/);
  const duplicate = clone(DISK_REGISTRY);
  duplicate.records.push(clone(record));
  assert.throws(() => validateProfile(duplicate), /canonical ID-sorted|duplicate fixed pull request identity/);
});
