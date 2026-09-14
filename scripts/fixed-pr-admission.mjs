import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const PROTECTED_CHAIN_KEYS = Object.freeze([
  'productBaseSha',
  'registryMergeSha',
  'registryHeadSha',
  'registryMergeParentShas',
  'registryPaths',
  'registryPathCount',
  'registryPathDigest',
  'correctiveParentSha',
  'correctivePaths',
  'correctivePathCount',
  'correctivePathDigest',
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
  exactKeys(record.protectedGovernanceChain, PROTECTED_CHAIN_KEYS, 'protected governance chain');
  const chain = record.protectedGovernanceChain;
  sha(chain.productBaseSha, 'protected governance product Base SHA');
  sha(chain.registryMergeSha, 'protected governance registry merge SHA');
  sha(chain.registryHeadSha, 'protected governance registry Head SHA');
  sha(chain.correctiveParentSha, 'protected governance corrective parent SHA');
  exact(chain.productBaseSha, integration.currentBaseSha, 'protected governance product Base');
  exact(chain.correctiveParentSha, chain.registryMergeSha, 'protected governance corrective parent/registry merge');
  if (!Array.isArray(chain.registryMergeParentShas) || chain.registryMergeParentShas.length !== 2) {
    reject('registry merge must have exactly two parents');
  }
  chain.registryMergeParentShas.forEach((entry, index) => sha(entry, `registry merge parent ${index + 1} SHA`));
  if (!sameArray(chain.registryMergeParentShas, [chain.productBaseSha, chain.registryHeadSha])) {
    reject('registry merge parent topology mismatch');
  }
  validatePathContract({ paths: chain.registryPaths, pathCount: chain.registryPathCount, pathDigest: chain.registryPathDigest }, 'registry governance');
  validatePathContract({ paths: chain.correctivePaths, pathCount: chain.correctivePathCount, pathDigest: chain.correctivePathDigest }, 'corrective governance');
  if (chain.zeroProductPathOverlap !== true
    || [...chain.registryPaths, ...chain.correctivePaths].some(entry => integration.paths.includes(entry))) {
    reject('protected governance chain overlaps product paths');
  }
  if (!Array.isArray(chain.permanentlyRejectedCandidateShas) || chain.permanentlyRejectedCandidateShas.length === 0) {
    reject('missing permanently rejected governance candidates');
  }
  chain.permanentlyRejectedCandidateShas.forEach((entry, index) => sha(entry, `permanently rejected candidate ${index + 1} SHA`));
  if (new Set(chain.permanentlyRejectedCandidateShas).size !== chain.permanentlyRejectedCandidateShas.length
    || chain.permanentlyRejectedCandidateShas.some((entry, index) => index > 0 && chain.permanentlyRejectedCandidateShas[index - 1].localeCompare(entry) >= 0)) {
    reject('permanently rejected candidates are not canonical SHA-sorted unique entries');
  }
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
  if (registry.schemaVersion !== 4 || registry.kind !== 'base-owned-current-base-integration-registry') reject('malformed registry');
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
  const expectedEventName = options.expectedEventName ?? 'pull_request_target';
  exact(event?.eventName, expectedEventName, 'event');
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
  sha(pullRequest.base?.sha, 'target Base SHA');
  const chain = record.protectedGovernanceChain;
  exact(evidence?.protectedBaseCheckoutSha, pullRequest.base.sha, 'protected Base checkout SHA');
  if (chain.permanentlyRejectedCandidateShas.includes(pullRequest.base.sha)
    || chain.permanentlyRejectedCandidateShas.includes(evidence?.correctiveCandidateSha)) {
    reject('permanently rejected governance candidate');
  }
  exact(evidence?.candidateResolvedSha, integration.headSha, 'candidate resolved SHA');
  if (!evidence?.productOriginalBaseIncludedInCurrentBase) reject('product original Base is not included in protected Base');
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
  if (!evidence.registryMergeIncludedInProtectedBase) reject('registry merge is not included in protected Base');
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
  sha(evidence.correctiveCandidateSha, 'corrective Candidate SHA');
  if (!Array.isArray(evidence.protectedBaseParentShas)
    || !sameArray(evidence.protectedBaseParentShas, [chain.correctiveParentSha, evidence.correctiveCandidateSha])) {
    reject('corrective merge parent topology mismatch');
  }
  if (!Array.isArray(evidence.correctiveCandidateParentShas)
    || !sameArray(evidence.correctiveCandidateParentShas, [chain.correctiveParentSha])) {
    reject('corrective Candidate must be single-parent registry merge');
  }
  sha(evidence.protectedBaseTreeSha, 'protected Base tree SHA');
  sha(evidence.correctiveCandidateTreeSha, 'corrective Candidate tree SHA');
  exact(evidence.protectedBaseTreeSha, evidence.correctiveCandidateTreeSha, 'corrective merge tree');
  exact(evidence.protectedGovernanceCommitCount, 2, 'protected governance chain commit count');
  if (!Array.isArray(evidence.protectedGovernancePaths)) reject('missing corrective governance paths');
  const correctiveDigest = canonicalPathDigest(evidence.protectedGovernancePaths);
  if (!sameArray(evidence.protectedGovernancePaths, chain.correctivePaths)
    || evidence.protectedGovernancePaths.length !== chain.correctivePathCount
    || correctiveDigest !== chain.correctivePathDigest) {
    reject('corrective governance path set or digest mismatch');
  }
  if (evidence.protectedGovernancePaths.some(entry => integration.paths.includes(entry))) {
    reject('corrective governance overlaps product paths');
  }
  if (!evidence.registryPresentAtBase) reject('authority registry absent from protected Base');
  if (!evidence.registryMatchesBase) reject('authority registry differs from protected Base');
  if (evidence.candidateProvidedAuthority === true) reject('candidate-provided authority is forbidden');
  return { accepted: true, record };
}

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSucceeded(args, cwd = process.cwd()) {
  try { execFileSync('git', args, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

function gitPatchId(baseSha, headSha, cwd = process.cwd()) {
  const patch = execFileSync('git', ['diff', '--no-ext-diff', '--binary', `${baseSha}..${headSha}`], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = execFileSync('git', ['patch-id', '--stable'], {
    cwd, encoding: 'utf8', input: patch, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const [patchId, resolvedHead, ...extra] = result.split(/\s+/);
  if (!SHA.test(patchId ?? '') || resolvedHead !== '0000000000000000000000000000000000000000' || extra.length !== 0) {
    reject('candidate patch ID unavailable');
  }
  return patchId;
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

function evidenceFromRepositories({ record, event, rawRegistry, candidateRoot }) {
  const baseSha = event.pullRequest?.base?.sha;
  const headSha = event.pullRequest?.head?.sha;
  const chain = record.protectedGovernanceChain;
  const registryAtBase = typeof baseSha === 'string'
    ? (() => { try { return git(['show', `${baseSha}:${REGISTRY_REPOSITORY_PATH}`]); } catch { return null; } })()
    : null;
  const revision = typeof headSha === 'string'
    ? git(['rev-list', '--parents', '-n', '1', headSha], candidateRoot).split(/\s+/)
    : [];
  const candidateResolvedSha = revision.shift();
  const changedPaths = typeof headSha === 'string'
    ? git(['diff', '--name-only', record.integration.currentBaseSha, headSha], candidateRoot).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b))
    : [];
  const baseAdvancePaths = typeof baseSha === 'string'
    ? git(['diff', '--name-only', record.baseAdvance.fromSha, record.baseAdvance.toSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b))
    : [];
  const baseAdvanceCommitCount = typeof baseSha === 'string'
    ? Number(git(['rev-list', '--count', `${record.baseAdvance.fromSha}..${record.baseAdvance.toSha}`]))
    : -1;
  const registryMergeRevision = git(['rev-list', '--parents', '-n', '1', chain.registryMergeSha]).split(/\s+/);
  registryMergeRevision.shift();
  const registryMergePaths = git(['diff', '--name-only', chain.productBaseSha, chain.registryMergeSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b));
  const protectedBaseRevision = typeof baseSha === 'string'
    ? git(['rev-list', '--parents', '-n', '1', baseSha]).split(/\s+/)
    : [];
  protectedBaseRevision.shift();
  const correctiveCandidateSha = protectedBaseRevision[1];
  const correctiveCandidateRevision = typeof correctiveCandidateSha === 'string'
    ? git(['rev-list', '--parents', '-n', '1', correctiveCandidateSha]).split(/\s+/)
    : [];
  correctiveCandidateRevision.shift();
  return {
    protectedBaseCheckoutSha: git(['rev-parse', 'HEAD']),
    productOriginalBaseIncludedInCurrentBase: typeof baseSha === 'string'
      && gitSucceeded(['merge-base', '--is-ancestor', record.productQa.originalBaseSha, baseSha]),
    candidateResolvedSha,
    candidateParentShas: revision,
    candidateMergeBaseSha: git(['merge-base', baseSha, headSha], candidateRoot),
    candidatePatchId: gitPatchId(record.integration.currentBaseSha, headSha, candidateRoot),
    changedPaths,
    candidateControlPlanePaths: changedPaths.filter(entry => CANDIDATE_CONTROL_PLANE_PATHS.includes(entry)),
    baseAdvancePaths,
    baseAdvanceCommitCount,
    registryMergeIncludedInProtectedBase: typeof baseSha === 'string'
      && gitSucceeded(['merge-base', '--is-ancestor', chain.registryMergeSha, baseSha]),
    registryMergeParentShas: registryMergeRevision,
    registryMergePaths,
    registryMergeCommitCount: Number(git(['rev-list', '--count', `${chain.productBaseSha}..${chain.registryMergeSha}`])),
    correctiveCandidateSha,
    protectedBaseParentShas: protectedBaseRevision,
    correctiveCandidateParentShas: correctiveCandidateRevision,
    protectedBaseTreeSha: typeof baseSha === 'string' ? git(['rev-parse', `${baseSha}^{tree}`]) : '',
    correctiveCandidateTreeSha: typeof correctiveCandidateSha === 'string' ? git(['rev-parse', `${correctiveCandidateSha}^{tree}`]) : '',
    protectedGovernanceCommitCount: typeof baseSha === 'string'
      ? Number(git(['rev-list', '--count', `${chain.correctiveParentSha}..${baseSha}`]))
      : -1,
    protectedGovernancePaths: typeof baseSha === 'string'
      ? git(['diff', '--name-only', chain.correctiveParentSha, baseSha]).split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b))
      : [],
    registryPresentAtBase: registryAtBase !== null,
    registryMatchesBase: registryAtBase !== null && sameValue(registryAtBase, rawRegistry.trim()),
    candidateProvidedAuthority: false,
  };
}

function releaseGateArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--release-gate-output' || argv[2] !== '--candidate-root' || !argv[1] || !argv[3]) {
    reject('invalid release gate arguments');
  }
  return { output: path.resolve(argv[1]), candidateRoot: path.resolve(argv[3]) };
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
  if (process.argv.length > 2) {
    const { output, candidateRoot } = releaseGateArguments(process.argv.slice(2));
    if (!isFixedSuccessorAttempt(validatedRegistry, event)) {
      process.stdout.write('current-base integration admission not applicable\n');
      process.exitCode = 2;
      return;
    }
    const record = selectRecord(validatedRegistry, event);
    const evidence = evidenceFromRepositories({ record, event, rawRegistry, candidateRoot });
    validateAdmission(validatedRegistry, event, evidence, { expectedEventName: 'pull_request' });
    await writeFile(output, `${JSON.stringify(fixedSuccessorRegressionManifest(validatedRegistry, event), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write('current-base integration release gate admission accepted\n');
    return;
  }
  const record = selectRecord(validatedRegistry, event);
  const evidence = evidenceFromRepositories({ record, event, rawRegistry, candidateRoot: process.cwd() });
  validateAdmission(validatedRegistry, event, evidence);
  process.stdout.write('current-base integration admission accepted\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'current-base integration admission rejected'}\n`);
    process.exitCode = 1;
  });
}
