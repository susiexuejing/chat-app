import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REGISTRY_URL = new URL('./fixed-pr-admission.profile.json', import.meta.url);
const REGISTRY_REPOSITORY_PATH = 'scripts/fixed-pr-admission.profile.json';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CHAT_TEST_PATH = /^client\/screens\/chat\/__tests__\/[A-Za-z0-9][A-Za-z0-9._-]*\.test\.(ts|tsx)$/;
const CANDIDATE_CONTROL_PLANE_PATHS = Object.freeze([
  '.github/workflows/protected-fixed-pr-admission.yml',
  '.github/workflows/release-gate.yml',
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/fixed-pr-admission.test.mjs',
  'scripts/ef111-scope.manifest.json',
  'scripts/fixed-pr-admission.mjs',
  'scripts/fixed-pr-admission.profile.json',
  'scripts/review-manifest.mjs',
]);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'kind', 'authority', 'records']);
const AUTHORITY_KEYS = Object.freeze(['repository', 'targetBranch', 'governanceSelfAdmission', 'recordOrder']);
const RECORD_KEYS = Object.freeze(['id', 'ticket', 'productQa', 'integration', 'baseAdvance', 'protectedGovernanceChain', 'regression', 'qaAuditReference']);
const PRODUCT_KEYS = Object.freeze(['headSha', 'parentSha', 'originalBaseSha', 'mergeBaseSha', 'patchId', 'paths', 'pathCount', 'pathDigest']);
const INTEGRATION_KEYS = Object.freeze(['headSha', 'parentSha', 'currentBaseSha', 'mergeBaseSha', 'patchId', 'sourceRepository', 'sourceBranch', 'targetBranch', 'paths', 'pathCount', 'pathDigest']);
const ADVANCE_KEYS = Object.freeze(['fromSha', 'toSha', 'commitCount', 'paths', 'pathCount', 'pathDigest', 'zeroProductPathOverlap']);
const LEGACY_PROTECTED_CHAIN_KEYS = Object.freeze([
  'kind',
  'historicProductBaseSha',
  'registryMergeSha',
  'registryHeadSha',
  'registryMergeParentShas',
  'registryPaths',
  'registryPathCount',
  'registryPathDigest',
  'correctiveParentSha',
  'correctiveMergeSha',
  'correctiveHeadSha',
  'correctiveMergeParentShas',
  'correctivePaths',
  'correctivePathCount',
  'correctivePathDigest',
  'authorityBootstrapParentSha',
  'authorityBootstrapPaths',
  'authorityBootstrapPathCount',
  'authorityBootstrapPathDigest',
  'permanentlyRejectedCandidateShas',
  'zeroProductPathOverlap',
]);
const SQUASH_PROTECTED_CHAIN_KEYS = Object.freeze([
  'kind',
  'anchorBaseSha',
  'anchorHeadSha',
  'anchorSourceBranch',
  'anchorMergeSha',
  'anchorMergeParentShas',
  'anchorPaths',
  'anchorPathCount',
  'anchorPathDigest',
  'permanentlyRejectedCandidateShas',
  'zeroProductPathOverlap',
]);
const REGRESSION_KEYS = Object.freeze(['selector', 'outputManifest']);
const MANIFEST_KEYS = Object.freeze(['schemaVersion', 'targetedRegressionIds', 'targetedTestPath', 'affectedTestPaths']);

function reject(reason) {
  throw new Error(`current-base integration admission rejected: ${reason}`);
}

function exact(value, expected, name) {
  if (value !== expected) reject(`${name} mismatch`);
}

function sha(value, name) {
  if (typeof value !== 'string' || !SHA.test(value)) reject(`invalid ${name}`);
}

function digest(value, name) {
  if (typeof value !== 'string' || !DIGEST.test(value)) reject(`invalid ${name}`);
}

function safeToken(value, name) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value) || value.includes('..') || value.includes('//')) reject(`invalid ${name}`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key, index) => key !== keys[index])) reject(`invalid ${name} keys`);
}

function sameValue(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

export function canonicalPathDigest(paths) {
  if (!Array.isArray(paths)
    || paths.some(entry => typeof entry !== 'string' || entry.length === 0
      || entry.startsWith('/') || entry.includes('\\') || entry.includes('\r') || entry.includes('\n') || entry.includes('..'))) {
    reject('invalid path set');
  }
  const canonical = [...paths].sort((left, right) => left.localeCompare(right));
  if (new Set(canonical).size !== canonical.length || canonical.some((entry, index) => entry !== paths[index])) {
    reject('paths are not canonical LF-sorted unique entries');
  }
  return createHash('sha256').update(canonical.join('\n'), 'utf8').digest('hex');
}

function validatePathContract(value, name, options = {}) {
  if (!Array.isArray(value.paths) || (!options.allowEmpty && value.paths.length === 0)
    || value.pathCount !== value.paths.length) reject(`invalid ${name} path count`);
  digest(value.pathDigest, `${name} path digest`);
  exact(canonicalPathDigest(value.paths), value.pathDigest, `${name} path digest`);
}

function validateRegression(regression) {
  exactKeys(regression, REGRESSION_KEYS, 'regression');
  exact(regression.selector, 'chat-ui-jest-path', 'regression selector');
  exactKeys(regression.outputManifest, MANIFEST_KEYS, 'regression output manifest');
  const manifest = regression.outputManifest;
  exact(manifest.schemaVersion, 2, 'regression manifest schema');
  if (!sameArray(manifest.targetedRegressionIds, ['chat-ui-jest-path'])) reject('invalid targeted regression IDs');
  if (manifest.targetedTestPath !== null) reject('targeted test path must be null');
  if (!Array.isArray(manifest.affectedTestPaths) || manifest.affectedTestPaths.length === 0
    || manifest.affectedTestPaths.length > 3
    || manifest.affectedTestPaths.some(entry => !CHAT_TEST_PATH.test(entry))) reject('invalid affected test paths');
  canonicalPathDigest(manifest.affectedTestPaths);
}

function validateRejectedCandidates(value) {
  if (!Array.isArray(value) || value.length === 0) reject('missing permanently rejected governance candidates');
  value.forEach((entry, index) => sha(entry, `permanently rejected candidate ${index + 1} SHA`));
  if (new Set(value).size !== value.length
    || value.some((entry, index) => index > 0 && value[index - 1].localeCompare(entry) >= 0)) {
    reject('permanently rejected candidates are not canonical SHA-sorted unique entries');
  }
}

function validateProtectedGovernanceChain(chain, productQa, integration) {
  if (chain?.kind === 'legacy-two-parent-merge') {
    exactKeys(chain, LEGACY_PROTECTED_CHAIN_KEYS, 'legacy protected governance chain');
    sha(chain.historicProductBaseSha, 'protected governance historic product Base SHA');
    sha(chain.registryMergeSha, 'protected governance registry merge SHA');
    sha(chain.registryHeadSha, 'protected governance registry Head SHA');
    sha(chain.correctiveParentSha, 'protected governance corrective parent SHA');
    sha(chain.correctiveMergeSha, 'protected governance corrective merge SHA');
    sha(chain.correctiveHeadSha, 'protected governance corrective Head SHA');
    sha(chain.authorityBootstrapParentSha, 'authority Bootstrap parent SHA');
    exact(chain.historicProductBaseSha, productQa.originalBaseSha, 'protected governance historic product Base');
    exact(chain.correctiveParentSha, chain.registryMergeSha, 'protected governance corrective parent/registry merge');
    exact(chain.authorityBootstrapParentSha, chain.correctiveMergeSha, 'authority Bootstrap parent/corrective merge');
    if (!Array.isArray(chain.registryMergeParentShas) || chain.registryMergeParentShas.length !== 2) {
      reject('registry merge must have exactly two parents');
    }
    chain.registryMergeParentShas.forEach((entry, index) => sha(entry, `registry merge parent ${index + 1} SHA`));
    if (!sameArray(chain.registryMergeParentShas, [chain.historicProductBaseSha, chain.registryHeadSha])) {
      reject('registry merge parent topology mismatch');
    }
    validatePathContract({ paths: chain.registryPaths, pathCount: chain.registryPathCount, pathDigest: chain.registryPathDigest }, 'registry governance');
    validatePathContract({ paths: chain.correctivePaths, pathCount: chain.correctivePathCount, pathDigest: chain.correctivePathDigest }, 'corrective governance');
    if (!Array.isArray(chain.correctiveMergeParentShas)
      || !sameArray(chain.correctiveMergeParentShas, [chain.correctiveParentSha, chain.correctiveHeadSha])) {
      reject('corrective merge parent topology mismatch');
    }
    validatePathContract({
      paths: chain.authorityBootstrapPaths,
      pathCount: chain.authorityBootstrapPathCount,
      pathDigest: chain.authorityBootstrapPathDigest,
    }, 'authority Bootstrap governance');
    if (chain.zeroProductPathOverlap !== true
      || [...chain.registryPaths, ...chain.correctivePaths, ...chain.authorityBootstrapPaths]
        .some(entry => integration.paths.includes(entry))) {
      reject('protected governance chain overlaps product paths');
    }
    validateRejectedCandidates(chain.permanentlyRejectedCandidateShas);
    return chain;
  }
  if (chain?.kind === 'squash-merge') {
    exactKeys(chain, SQUASH_PROTECTED_CHAIN_KEYS, 'squash protected governance anchor');
    sha(chain.anchorBaseSha, 'squash anchor Base SHA');
    sha(chain.anchorHeadSha, 'squash anchor Head SHA');
    safeToken(chain.anchorSourceBranch, 'squash anchor source branch');
    sha(chain.anchorMergeSha, 'squash anchor merge SHA');
    if (!Array.isArray(chain.anchorMergeParentShas) || !sameArray(chain.anchorMergeParentShas, [chain.anchorBaseSha])) {
      reject('squash anchor merge parent topology mismatch');
    }
    validatePathContract({ paths: chain.anchorPaths, pathCount: chain.anchorPathCount, pathDigest: chain.anchorPathDigest }, 'squash anchor governance');
    if (chain.zeroProductPathOverlap !== true || chain.anchorPaths.some(entry => integration.paths.includes(entry))) {
      reject('squash anchor overlaps product paths');
    }
    validateRejectedCandidates(chain.permanentlyRejectedCandidateShas);
    return chain;
  }
  reject('unknown protected governance anchor kind');
}

function validateRecord(record, authority) {
  exactKeys(record, RECORD_KEYS, 'registry record');
  safeToken(record.id, 'record ID');
  safeToken(record.ticket, 'ticket');
  exactKeys(record.productQa, PRODUCT_KEYS, 'product QA identity');
  const productQa = record.productQa;
  sha(productQa.headSha, 'product QA head SHA');
  sha(productQa.parentSha, 'product QA parent SHA');
  sha(productQa.originalBaseSha, 'product QA original Base SHA');
  sha(productQa.mergeBaseSha, 'product QA merge-base SHA');
  sha(productQa.patchId, 'product QA patch ID');
  exact(productQa.parentSha, productQa.originalBaseSha, 'product QA parent/original Base');
  exact(productQa.mergeBaseSha, productQa.originalBaseSha, 'product QA merge-base');
  validatePathContract(productQa, 'product QA');
  exactKeys(record.integration, INTEGRATION_KEYS, 'integration identity');
  const integration = record.integration;
  sha(integration.headSha, 'integration head SHA');
  sha(integration.parentSha, 'integration parent SHA');
  sha(integration.currentBaseSha, 'integration current Base SHA');
  sha(integration.mergeBaseSha, 'integration merge-base SHA');
  sha(integration.patchId, 'integration patch ID');
  safeToken(integration.sourceRepository, 'source repository');
  safeToken(integration.sourceBranch, 'source branch');
  safeToken(integration.targetBranch, 'target branch');
  exact(integration.sourceRepository, authority.repository, 'source repository');
  exact(integration.targetBranch, authority.targetBranch, 'target branch');
  exact(integration.parentSha, integration.currentBaseSha, 'integration parent/current Base');
  exact(integration.mergeBaseSha, integration.currentBaseSha, 'integration merge-base/current Base');
  exact(integration.patchId, productQa.patchId, 'QA/integration stable patch ID');
  validatePathContract(integration, 'integration');
  if (!sameArray(integration.paths, productQa.paths) || integration.pathDigest !== productQa.pathDigest) {
    reject('QA/integration product path contract mismatch');
  }
  exactKeys(record.baseAdvance, ADVANCE_KEYS, 'Base advance');
  const advance = record.baseAdvance;
  sha(advance.fromSha, 'Base advance from SHA');
  sha(advance.toSha, 'Base advance to SHA');
  exact(advance.fromSha, productQa.originalBaseSha, 'Base advance origin');
  exact(advance.toSha, integration.currentBaseSha, 'Base advance destination');
  if (!Number.isSafeInteger(advance.commitCount) || advance.commitCount < 0) reject('invalid Base advance commit count');
  validatePathContract(advance, 'Base advance', { allowEmpty: true });
  if ((advance.fromSha === advance.toSha && (advance.commitCount !== 0 || advance.paths.length !== 0))
    || (advance.fromSha !== advance.toSha && advance.commitCount === 0)) {
    reject('inconsistent zero Base advance');
  }
  if (advance.zeroProductPathOverlap !== true || advance.paths.some(entry => integration.paths.includes(entry))) reject('Base advance overlaps product paths');
  validateProtectedGovernanceChain(record.protectedGovernanceChain, productQa, integration);
  validateRegression(record.regression);
  if (!record.regression.outputManifest.affectedTestPaths.every(entry => integration.paths.includes(entry))) {
    reject('regression test is outside product paths');
  }
  if (typeof record.qaAuditReference !== 'string' || record.qaAuditReference.length === 0 || /[\r\n]/.test(record.qaAuditReference)) {
    reject('invalid QA audit reference');
  }
  return record;
}

export function validateProfile(registry) {
  exactKeys(registry, REGISTRY_KEYS, 'registry');
  if (registry.schemaVersion !== 5 || registry.kind !== 'base-owned-current-base-integration-registry') reject('malformed registry');
  exactKeys(registry.authority, AUTHORITY_KEYS, 'registry authority');
  safeToken(registry.authority.repository, 'authority repository');
  safeToken(registry.authority.targetBranch, 'authority target branch');
  exact(registry.authority.governanceSelfAdmission, 'forbidden', 'governance self-admission');
  exact(registry.authority.recordOrder, 'id-lf-ascending', 'record order');
  if (!Array.isArray(registry.records)) reject('invalid registry records');
  const ids = registry.records.map(record => record?.id);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length
    || ids.some((id, index) => index > 0 && ids[index - 1].localeCompare(id) >= 0)) {
    reject('records are not canonical ID-sorted unique entries');
  }
  registry.records.forEach(record => validateRecord(record, registry.authority));
  const sources = registry.records.map(record => `${record.integration.sourceRepository}\n${record.integration.sourceBranch}\n${record.integration.targetBranch}`);
  if (new Set(sources).size !== sources.length) reject('duplicate integration source identity');
  const heads = registry.records.map(record => record.integration.headSha);
  if (new Set(heads).size !== heads.length) reject('duplicate integration head identity');
  return registry;
}

function matchingRecords(registry, event) {
  const head = event?.pullRequest?.head;
  const base = event?.pullRequest?.base;
  return registry.records.filter(record => record.integration.sourceBranch === head?.ref
    && record.integration.sourceRepository === head?.repoFullName
    && record.integration.targetBranch === base?.ref
    && record.integration.sourceRepository === base?.repoFullName);
}

function selectRecord(registry, event) {
  const records = matchingRecords(registry, event);
  if (records.length !== 1) reject('no unique Base-owned registry match');
  return records[0];
}

export function isFixedSuccessorAttempt(profileInput, event) {
  const registry = validateProfile(profileInput);
  return matchingRecords(registry, event).length === 1;
}

export function fixedSuccessorRegressionManifest(profileInput, event) {
  const registry = validateProfile(profileInput);
  const record = selectRecord(registry, event);
  return JSON.parse(JSON.stringify(record.regression.outputManifest));
}

export function validateAdmission(profileInput, event, evidence, options = {}) {
  const registry = validateProfile(profileInput);
  exact(event?.eventName, 'pull_request_target', 'event');
  const pullRequest = event?.pullRequest;
  if (!pullRequest || !Number.isInteger(pullRequest.number) || pullRequest.number <= 0) reject('missing pull request identity');
  const record = selectRecord(registry, event);
  const integration = record.integration;
  sha(pullRequest.head?.sha, 'integration head SHA');
  exact(pullRequest.head.sha, integration.headSha, 'integration head SHA');
  exact(pullRequest.head.ref, integration.sourceBranch, 'source branch');
  exact(pullRequest.head.repoFullName, integration.sourceRepository, 'source repository');
  exact(pullRequest.base?.ref, integration.targetBranch, 'target branch');
  exact(pullRequest.base?.repoFullName, integration.sourceRepository, 'target repository');
  const chain = record.protectedGovernanceChain;
  const authoritySnapshotSha = options.authoritySnapshotSha ?? evidence?.authoritySnapshotSha;
  sha(authoritySnapshotSha, 'authority snapshot SHA');
  exact(evidence?.protectedBaseCheckoutSha, authoritySnapshotSha, 'protected authority snapshot checkout SHA');
  if ([authoritySnapshotSha, evidence?.correctiveCandidateSha, evidence?.authorityBootstrapCandidateSha, evidence?.anchorHeadSha]
    .some(candidateSha => chain.permanentlyRejectedCandidateShas.includes(candidateSha))) {
    reject('permanently rejected governance candidate');
  }
  if (evidence?.authoritySnapshotResolvedOnce !== true) reject('authority snapshot was not resolved exactly once');
  if (evidence?.authorityExecutionFromProtectedSnapshot !== true) reject('admission code is not from protected authority snapshot');
  if (evidence?.eventFieldsUsedAsDataOnly !== true) reject('pull request event fields are not data only');
  if (evidence?.candidateFilesRead !== false) reject('candidate file content was read by privileged admission');
  if (evidence?.candidateCodeExecutedBeforeAdmission !== false) reject('candidate code executed before admission');
  exact(evidence?.candidateResolvedSha, integration.headSha, 'candidate resolved SHA');
  if (!evidence?.productOriginalBaseIncludedInAuthoritySnapshot) reject('product original Base is not included in authority snapshot');
  if (!Array.isArray(evidence?.candidateParentShas) || evidence.candidateParentShas.length !== 1) reject('candidate must have exactly one parent');
  exact(evidence.candidateParentShas[0], integration.currentBaseSha, 'candidate parent SHA');
  exact(evidence.candidateMergeBaseSha, integration.currentBaseSha, 'candidate merge-base SHA');
  sha(evidence.candidatePatchId, 'candidate patch ID');
  exact(evidence.candidatePatchId, record.productQa.patchId, 'QA product patch equivalence');
  exact(evidence.candidatePatchId, integration.patchId, 'integration patch ID');
  if (!Array.isArray(evidence.changedPaths)) reject('missing changed paths');
  const changedDigest = canonicalPathDigest(evidence.changedPaths);
  if (!sameArray(evidence.changedPaths, integration.paths) || evidence.changedPaths.length !== integration.pathCount
    || changedDigest !== integration.pathDigest || changedDigest !== record.productQa.pathDigest) {
    reject('integration changed path set or digest mismatch');
  }
  if (!Array.isArray(evidence.candidateControlPlanePaths) || evidence.candidateControlPlanePaths.length !== 0) {
    reject('candidate self-authorization or control-plane change');
  }
  if (!Array.isArray(evidence.baseAdvancePaths)) reject('missing Base advance paths');
  const advanceDigest = canonicalPathDigest(evidence.baseAdvancePaths);
  if (!sameArray(evidence.baseAdvancePaths, record.baseAdvance.paths) || evidence.baseAdvancePaths.length !== record.baseAdvance.pathCount
    || advanceDigest !== record.baseAdvance.pathDigest) reject('Base advance path set or digest mismatch');
  exact(evidence.baseAdvanceCommitCount, record.baseAdvance.commitCount, 'Base advance commit count');
  if (evidence.baseAdvancePaths.some(entry => integration.paths.includes(entry))) reject('Base advance overlaps product paths');
  if (chain.kind === 'squash-merge') {
    if (!evidence.anchorMergeIncludedInAuthoritySnapshot) reject('squash anchor merge is not included in authority snapshot');
    exact(evidence.anchorBaseSha, chain.anchorBaseSha, 'squash anchor Base SHA');
    exact(evidence.anchorHeadSha, chain.anchorHeadSha, 'squash anchor Head SHA');
    exact(evidence.anchorSourceBranch, chain.anchorSourceBranch, 'squash anchor source branch');
    exact(evidence.anchorMergeSha, chain.anchorMergeSha, 'squash anchor merge SHA');
    if (!Array.isArray(evidence.anchorMergeParentShas)
      || !sameArray(evidence.anchorMergeParentShas, chain.anchorMergeParentShas)) {
      reject('squash anchor merge parent topology mismatch');
    }
    if (!Array.isArray(evidence.anchorHeadParentShas)
      || !sameArray(evidence.anchorHeadParentShas, [chain.anchorBaseSha])) {
      reject('squash anchor Head parent topology mismatch');
    }
    sha(evidence.anchorMergeTreeSha, 'squash anchor merge tree SHA');
    sha(evidence.anchorHeadTreeSha, 'squash anchor Head tree SHA');
    exact(evidence.anchorMergeTreeSha, evidence.anchorHeadTreeSha, 'squash anchor merge tree');
    exact(evidence.anchorCommitCount, 1, 'squash anchor commit count');
    if (!Array.isArray(evidence.anchorPaths)) reject('missing squash anchor governance paths');
    const anchorDigest = canonicalPathDigest(evidence.anchorPaths);
    if (!sameArray(evidence.anchorPaths, chain.anchorPaths)
      || evidence.anchorPaths.length !== chain.anchorPathCount
      || anchorDigest !== chain.anchorPathDigest) {
      reject('squash anchor governance path set or digest mismatch');
    }
    if (evidence.anchorPaths.some(entry => integration.paths.includes(entry))) {
      reject('squash anchor overlaps product paths');
    }
    if (!evidence.registryPresentAtSnapshot) reject('authority registry absent from protected snapshot');
    if (!evidence.registryMatchesSnapshot) reject('authority registry differs from protected snapshot');
    if (evidence.candidateProvidedAuthority === true) reject('candidate-provided authority is forbidden');
    return { accepted: true, record };
  }
  if (!evidence.registryMergeIncludedInAuthoritySnapshot) reject('registry merge is not included in authority snapshot');
  if (!Array.isArray(evidence.registryMergeParentShas)
    || !sameArray(evidence.registryMergeParentShas, chain.registryMergeParentShas)) {
    reject('registry merge parent topology mismatch');
  }
  if (!Array.isArray(evidence.registryMergePaths)) reject('missing registry governance paths');
  const registryDigest = canonicalPathDigest(evidence.registryMergePaths);
  if (!sameArray(evidence.registryMergePaths, chain.registryPaths)
    || evidence.registryMergePaths.length !== chain.registryPathCount
    || registryDigest !== chain.registryPathDigest) {
    reject('registry governance path set or digest mismatch');
  }
  exact(evidence.registryMergeCommitCount, 2, 'registry merge commit count');
  if (!evidence.correctiveMergeIncludedInAuthoritySnapshot) reject('corrective merge is not included in authority snapshot');
  exact(evidence.correctiveMergeSha, chain.correctiveMergeSha, 'corrective merge SHA');
  if (!Array.isArray(evidence.correctiveMergeParentShas)
    || !sameArray(evidence.correctiveMergeParentShas, chain.correctiveMergeParentShas)) {
    reject('corrective merge parent topology mismatch');
  }
  sha(evidence.correctiveCandidateSha, 'corrective Candidate SHA');
  exact(evidence.correctiveCandidateSha, chain.correctiveHeadSha, 'corrective Candidate SHA');
  if (!Array.isArray(evidence.correctiveCandidateParentShas)
    || !sameArray(evidence.correctiveCandidateParentShas, [chain.correctiveParentSha])) {
    reject('corrective Candidate must be single-parent registry merge');
  }
  sha(evidence.correctiveMergeTreeSha, 'corrective merge tree SHA');
  sha(evidence.correctiveCandidateTreeSha, 'corrective Candidate tree SHA');
  exact(evidence.correctiveMergeTreeSha, evidence.correctiveCandidateTreeSha, 'corrective merge tree');
  exact(evidence.correctiveGovernanceCommitCount, 2, 'corrective governance chain commit count');
  if (!Array.isArray(evidence.correctiveGovernancePaths)) reject('missing corrective governance paths');
  const correctiveDigest = canonicalPathDigest(evidence.correctiveGovernancePaths);
  if (!sameArray(evidence.correctiveGovernancePaths, chain.correctivePaths)
    || evidence.correctiveGovernancePaths.length !== chain.correctivePathCount
    || correctiveDigest !== chain.correctivePathDigest) {
    reject('corrective governance path set or digest mismatch');
  }
  if (evidence.correctiveGovernancePaths.some(entry => integration.paths.includes(entry))) {
    reject('corrective governance overlaps product paths');
  }
  if (!evidence.authorityBootstrapParentIncludedInSnapshot) reject('authority Bootstrap parent is not included in snapshot');
  if (!Array.isArray(evidence.authoritySnapshotParentShas)
    || !sameArray(evidence.authoritySnapshotParentShas, [chain.authorityBootstrapParentSha, evidence.authorityBootstrapCandidateSha])) {
    reject('authority Bootstrap merge parent topology mismatch');
  }
  sha(evidence.authorityBootstrapCandidateSha, 'authority Bootstrap Candidate SHA');
  if (!Array.isArray(evidence.authorityBootstrapCandidateParentShas)
    || !sameArray(evidence.authorityBootstrapCandidateParentShas, [chain.authorityBootstrapParentSha])) {
    reject('authority Bootstrap Candidate must be single-parent corrective merge');
  }
  sha(evidence.authoritySnapshotTreeSha, 'authority snapshot tree SHA');
  sha(evidence.authorityBootstrapCandidateTreeSha, 'authority Bootstrap Candidate tree SHA');
  exact(evidence.authoritySnapshotTreeSha, evidence.authorityBootstrapCandidateTreeSha, 'authority Bootstrap merge tree');
  exact(evidence.authorityBootstrapCommitCount, 2, 'authority Bootstrap chain commit count');
  if (!Array.isArray(evidence.authorityBootstrapPaths)) reject('missing authority Bootstrap governance paths');
  const authorityBootstrapDigest = canonicalPathDigest(evidence.authorityBootstrapPaths);
  if (!sameArray(evidence.authorityBootstrapPaths, chain.authorityBootstrapPaths)
    || evidence.authorityBootstrapPaths.length !== chain.authorityBootstrapPathCount
    || authorityBootstrapDigest !== chain.authorityBootstrapPathDigest) {
    reject('authority Bootstrap governance path set or digest mismatch');
  }
  if (evidence.authorityBootstrapPaths.some(entry => integration.paths.includes(entry))) {
    reject('authority Bootstrap governance overlaps product paths');
  }
  if (!evidence.registryPresentAtSnapshot) reject('authority registry absent from protected snapshot');
  if (!evidence.registryMatchesSnapshot) reject('authority registry differs from protected snapshot');
  if (evidence.candidateProvidedAuthority === true) reject('candidate-provided authority is forbidden');
  return { accepted: true, record };
}

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSucceeded(args, cwd = process.cwd()) {
  try { execFileSync('git', args, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

function eventFromPayload(githubEvent) {
  return {
    eventName: process.env.GITHUB_EVENT_NAME,
    pullRequest: {
      number: githubEvent.pull_request?.number,
      head: {
        sha: githubEvent.pull_request?.head?.sha,
        ref: githubEvent.pull_request?.head?.ref,
        repoFullName: githubEvent.pull_request?.head?.repo?.full_name,
      },
      base: {
        sha: githubEvent.pull_request?.base?.sha,
        ref: githubEvent.pull_request?.base?.ref,
        repoFullName: githubEvent.pull_request?.base?.repo?.full_name,
      },
    },
  };
}

function evidenceFromAuthority({ record, event, rawRegistry, authoritySnapshotSha }) {
  const chain = record.protectedGovernanceChain;
  const registryAtSnapshot = (() => {
    try { return git(['show', `${authoritySnapshotSha}:${REGISTRY_REPOSITORY_PATH}`]); } catch { return null; }
  })();
  const baseAdvancePaths = git(['diff', '--name-only', record.baseAdvance.fromSha, record.baseAdvance.toSha])
    .split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b));
  const commonEvidence = {
    protectedBaseCheckoutSha: git(['rev-parse', 'HEAD']),
    authoritySnapshotSha,
    authoritySnapshotResolvedOnce: true,
    authorityExecutionFromProtectedSnapshot: true,
    eventFieldsUsedAsDataOnly: true,
    candidateFilesRead: false,
    candidateCodeExecutedBeforeAdmission: false,
    productOriginalBaseIncludedInAuthoritySnapshot: gitSucceeded(['merge-base', '--is-ancestor', record.productQa.originalBaseSha, authoritySnapshotSha]),
    candidateResolvedSha: event.pullRequest.head.sha,
    candidateParentShas: [record.integration.parentSha],
    candidateMergeBaseSha: record.integration.mergeBaseSha,
    candidatePatchId: record.integration.patchId,
    changedPaths: [...record.integration.paths],
    candidateControlPlanePaths: [],
    baseAdvancePaths,
    baseAdvanceCommitCount: Number(git(['rev-list', '--count', `${record.baseAdvance.fromSha}..${record.baseAdvance.toSha}`])),
    registryPresentAtSnapshot: registryAtSnapshot !== null,
    registryMatchesSnapshot: registryAtSnapshot !== null && sameValue(registryAtSnapshot, rawRegistry.trim()),
    candidateProvidedAuthority: false,
  };
  if (chain.kind === 'squash-merge') {
    const anchorMergeParents = git(['rev-list', '--parents', '-n', '1', chain.anchorMergeSha]).split(/\s+/);
    anchorMergeParents.shift();
    const anchorHeadParents = git(['rev-list', '--parents', '-n', '1', chain.anchorHeadSha]).split(/\s+/);
    anchorHeadParents.shift();
    return {
      ...commonEvidence,
      anchorMergeIncludedInAuthoritySnapshot: gitSucceeded(['merge-base', '--is-ancestor', chain.anchorMergeSha, authoritySnapshotSha]),
      anchorBaseSha: chain.anchorBaseSha,
      anchorHeadSha: chain.anchorHeadSha,
      anchorSourceBranch: chain.anchorSourceBranch,
      anchorMergeSha: chain.anchorMergeSha,
      anchorMergeParentShas: anchorMergeParents,
      anchorHeadParentShas: anchorHeadParents,
      anchorMergeTreeSha: git(['rev-parse', `${chain.anchorMergeSha}^{tree}`]),
      anchorHeadTreeSha: git(['rev-parse', `${chain.anchorHeadSha}^{tree}`]),
      anchorCommitCount: Number(git(['rev-list', '--count', `${chain.anchorBaseSha}..${chain.anchorMergeSha}`])),
      anchorPaths: git(['diff', '--name-only', chain.anchorBaseSha, chain.anchorMergeSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b)),
    };
  }
  const registryMergeRevision = git(['rev-list', '--parents', '-n', '1', chain.registryMergeSha]).split(/\s+/);
  registryMergeRevision.shift();
  const registryMergePaths = git(['diff', '--name-only', chain.historicProductBaseSha, chain.registryMergeSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b));
  const correctiveMergeRevision = git(['rev-list', '--parents', '-n', '1', chain.correctiveMergeSha]).split(/\s+/);
  correctiveMergeRevision.shift();
  const correctiveCandidateRevision = git(['rev-list', '--parents', '-n', '1', chain.correctiveHeadSha]).split(/\s+/);
  correctiveCandidateRevision.shift();
  const authoritySnapshotRevision = git(['rev-list', '--parents', '-n', '1', authoritySnapshotSha]).split(/\s+/);
  authoritySnapshotRevision.shift();
  const authorityBootstrapCandidateSha = authoritySnapshotRevision[1];
  const authorityBootstrapCandidateRevision = typeof authorityBootstrapCandidateSha === 'string'
    ? git(['rev-list', '--parents', '-n', '1', authorityBootstrapCandidateSha]).split(/\s+/)
    : [];
  authorityBootstrapCandidateRevision.shift();
  return {
    ...commonEvidence,
    registryMergeIncludedInAuthoritySnapshot: gitSucceeded(['merge-base', '--is-ancestor', chain.registryMergeSha, authoritySnapshotSha]),
    registryMergeParentShas: registryMergeRevision,
    registryMergePaths,
    registryMergeCommitCount: Number(git(['rev-list', '--count', `${chain.historicProductBaseSha}..${chain.registryMergeSha}`])),
    correctiveMergeIncludedInAuthoritySnapshot: gitSucceeded(['merge-base', '--is-ancestor', chain.correctiveMergeSha, authoritySnapshotSha]),
    correctiveMergeSha: chain.correctiveMergeSha,
    correctiveMergeParentShas: correctiveMergeRevision,
    correctiveCandidateSha: chain.correctiveHeadSha,
    correctiveCandidateParentShas: correctiveCandidateRevision,
    correctiveMergeTreeSha: git(['rev-parse', `${chain.correctiveMergeSha}^{tree}`]),
    correctiveCandidateTreeSha: git(['rev-parse', `${chain.correctiveHeadSha}^{tree}`]),
    correctiveGovernanceCommitCount: Number(git(['rev-list', '--count', `${chain.correctiveParentSha}..${chain.correctiveMergeSha}`])),
    correctiveGovernancePaths: git(['diff', '--name-only', chain.correctiveParentSha, chain.correctiveMergeSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b)),
    authorityBootstrapParentIncludedInSnapshot: gitSucceeded(['merge-base', '--is-ancestor', chain.authorityBootstrapParentSha, authoritySnapshotSha]),
    authoritySnapshotParentShas: authoritySnapshotRevision,
    authorityBootstrapCandidateSha,
    authorityBootstrapCandidateParentShas: authorityBootstrapCandidateRevision,
    authoritySnapshotTreeSha: git(['rev-parse', `${authoritySnapshotSha}^{tree}`]),
    authorityBootstrapCandidateTreeSha: typeof authorityBootstrapCandidateSha === 'string'
      ? git(['rev-parse', `${authorityBootstrapCandidateSha}^{tree}`])
      : '',
    authorityBootstrapCommitCount: Number(git(['rev-list', '--count', `${chain.authorityBootstrapParentSha}..${authoritySnapshotSha}`])),
    authorityBootstrapPaths: git(['diff', '--name-only', chain.authorityBootstrapParentSha, authoritySnapshotSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
}

async function main() {
  const rawEvent = process.env.GITHUB_EVENT_PATH ? await readFile(process.env.GITHUB_EVENT_PATH, 'utf8') : null;
  if (!rawEvent) reject('missing GitHub event payload');
  let githubEvent;
  try { githubEvent = JSON.parse(rawEvent); } catch { reject('malformed GitHub event payload'); }
  const rawRegistry = await readFile(REGISTRY_URL, 'utf8');
  let registry;
  try { registry = JSON.parse(rawRegistry); } catch { reject('malformed registry'); }
  const validatedRegistry = validateProfile(registry);
  const event = eventFromPayload(githubEvent);
  if (process.argv.length !== 2) reject('invalid privileged admission arguments');
  const authoritySnapshotSha = process.env.EF_AUTHORITY_SNAPSHOT_SHA;
  sha(authoritySnapshotSha, 'authority snapshot SHA');
  exact(git(['rev-parse', 'HEAD']), authoritySnapshotSha, 'authority snapshot working tree');
  const record = selectRecord(validatedRegistry, event);
  const evidence = evidenceFromAuthority({ record, event, rawRegistry, authoritySnapshotSha });
  validateAdmission(validatedRegistry, event, evidence, { authoritySnapshotSha });
  process.stdout.write('current-base integration admission accepted\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'current-base integration admission rejected'}\n`);
    process.exitCode = 1;
  });
}
