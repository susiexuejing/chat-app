import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILE_URL = new URL('./fixed-pr-admission.profile.json', import.meta.url);
const PROFILE_REPOSITORY_PATH = 'scripts/fixed-pr-admission.profile.json';
const SHA = /^[0-9a-f]{40}$/;
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
const FIXED = Object.freeze({
  authorityFloorSha: 'a15d9e5e64761c9ab2cc5ae77d0ed1a13748505d',
  pullRequestNumber: 101,
  headPolicy: 'fixed-head-exact-parent-and-base-advance',
  headSha: 'cccf87a33e454535f086174f75fd97a87e2c8968',
  parentSha: '105a71db994e8a579923b309bd3f7aad7b70ecab',
  originalBaseSha: '105a71db994e8a579923b309bd3f7aad7b70ecab',
  currentBaseSha: 'a15d9e5e64761c9ab2cc5ae77d0ed1a13748505d',
  ancestryShas: [
    '105a71db994e8a579923b309bd3f7aad7b70ecab',
    'cccf87a33e454535f086174f75fd97a87e2c8968',
  ],
  patchId: '13048554cc0abb329720a51fe69d0afbeb0a05d0',
  sourceRepository: 'susiexuejing/chat-app',
  sourceBranch: 'cell1/ef177-history-new-conversation-r1',
  targetBranch: 'dev',
  paths: [
    'client/screens/chat/__tests__/ef175-chat-ui-visual.test.tsx',
    'client/screens/chat/__tests__/ef177-chat-actions.test.tsx',
    'client/screens/chat/components/RoleHeader.tsx',
  ],
  pathDigest: 'bf26951b5124f1da6b22894c9e07ec673b1cf6e6bf355cf07066f4f3f2de4ceb',
  releaseGateRoute: 'base-owned-review-manifest',
  allowedTargetBaseAdvancePaths: [
    '.gitleaks.toml',
    'scripts/__tests__/ef111-review-manifest.test.mjs',
    'scripts/__tests__/ef94-ci-release-gate.test.mjs',
    'scripts/__tests__/fixed-pr-admission.test.mjs',
    'scripts/ef111-scope.manifest.json',
    'scripts/fixed-pr-admission.mjs',
    'scripts/fixed-pr-admission.profile.json',
    'scripts/review-manifest.mjs',
    'server/src/__tests__/ef75-anonymous-session.test.ts',
    'server/src/__tests__/ef75-chat-ownership.test.ts',
    'server/src/__tests__/ef75-conversation-ownership.test.ts',
    'server/src/index.ts',
    'server/src/routes/conversations.ts',
    'server/src/security/anonymousSession.ts',
    'server/src/storage/database/migrations/004_create_conversation_owner_bindings.sql',
    'server/src/storage/database/rds-owner-binding-store.ts',
    'server/src/storage/database/rds-runtime-config.ts',
  ],
});

function reject(reason) {
  throw new Error(`fixed successor admission rejected: ${reason}`);
}

function exact(value, expected, name) {
  if (value !== expected) reject(`${name} mismatch`);
}

function sha(value, name) {
  if (typeof value !== 'string' || !SHA.test(value)) reject(`invalid ${name}`);
}

function sameValue(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function canonicalPathDigest(paths) {
  if (!Array.isArray(paths) || paths.length === 0
    || paths.some(entry => typeof entry !== 'string' || entry.length === 0 || entry.includes('\\') || entry.includes('\r') || entry.includes('\n'))) {
    reject('invalid path set');
  }
  const canonical = [...paths].sort((left, right) => left.localeCompare(right));
  if (new Set(canonical).size !== canonical.length || canonical.some((entry, index) => entry !== paths[index])) {
    reject('paths are not canonical LF-sorted unique entries');
  }
  return createHash('sha256').update(canonical.join('\n'), 'utf8').digest('hex');
}

export function validateProfile(profile) {
  if (!profile || profile.schemaVersion !== 1 || profile.kind !== 'integrated-successor-pr-admission' || profile.ticket !== 'EF-177') {
    reject('malformed profile');
  }
  if (profile.governanceSelfAdmission !== 'forbidden') reject('self-admission is not forbidden');
  if (!Array.isArray(profile.legacyPullRequestNumbers)
    || profile.legacyPullRequestNumbers.length !== 2
    || profile.legacyPullRequestNumbers[0] !== 93
    || profile.legacyPullRequestNumbers[1] !== 99) {
    reject('legacy PRs #93 and #99 are not explicitly rejected');
  }
  sha(profile.authorityFloorSha, 'authority floor SHA');
  exact(profile.authorityFloorSha, FIXED.authorityFloorSha, 'authority floor SHA');
  const product = profile.product;
  if (!product) reject('missing product profile');
  sha(product.headSha, 'product head SHA');
  sha(product.parentSha, 'product parent SHA');
  sha(product.originalBaseSha, 'product original base SHA');
  sha(product.currentBaseSha, 'product current base SHA');
  sha(product.patchId, 'product patch ID');
  if (product.pullRequestNumber !== FIXED.pullRequestNumber
    || product.headPolicy !== FIXED.headPolicy
    || product.headSha !== FIXED.headSha
    || product.parentSha !== FIXED.parentSha
    || product.originalBaseSha !== FIXED.originalBaseSha
    || product.currentBaseSha !== FIXED.currentBaseSha
    || product.patchId !== FIXED.patchId
    || product.sourceRepository !== FIXED.sourceRepository
    || product.sourceBranch !== FIXED.sourceBranch
    || product.targetBranch !== FIXED.targetBranch
    || product.releaseGateRoute !== FIXED.releaseGateRoute) {
    reject('malformed fixed product identity');
  }
  if (!Array.isArray(product.ancestryShas)
    || product.ancestryShas.length !== FIXED.ancestryShas.length
    || product.ancestryShas.some((entry, index) => {
      sha(entry, `product ancestry SHA ${index + 1}`);
      return entry !== FIXED.ancestryShas[index];
    })
    || product.ancestryShas[0] !== product.originalBaseSha
    || product.ancestryShas.at(-2) !== product.parentSha
    || product.ancestryShas.at(-1) !== product.headSha) {
    reject('malformed fixed product ancestry');
  }
  if (!Array.isArray(product.paths) || product.pathCount !== product.paths.length
    || product.paths.length !== FIXED.paths.length
    || product.paths.some((entry, index) => entry !== FIXED.paths[index])
    || product.pathDigest !== FIXED.pathDigest
    || canonicalPathDigest(product.paths) !== product.pathDigest) {
    reject('malformed fixed path contract');
  }
  if (!Array.isArray(product.allowedTargetBaseAdvancePaths)
    || product.allowedTargetBaseAdvancePaths.length !== FIXED.allowedTargetBaseAdvancePaths.length
    || product.allowedTargetBaseAdvancePaths.some((entry, index) => entry !== FIXED.allowedTargetBaseAdvancePaths[index])
    || canonicalPathDigest(product.allowedTargetBaseAdvancePaths) !== canonicalPathDigest(FIXED.allowedTargetBaseAdvancePaths)) {
    reject('malformed target base advance contract');
  }
  return profile;
}

export function isFixedSuccessorAttempt(profileInput, event) {
  const profile = validateProfile(profileInput);
  const head = event?.pullRequest?.head;
  return head?.ref === profile.product.sourceBranch
    && profile.product.releaseGateRoute !== 'base-owned-review-manifest';
}

export function fixedSuccessorRegressionManifest(profileInput) {
  const profile = validateProfile(profileInput);
  if (profile.product.releaseGateRoute === 'base-owned-review-manifest') {
    reject('release gate must use Base-owned review manifest');
  }
  reject('unsupported release gate route');
}

export function validateAdmission(profileInput, event, evidence, options = {}) {
  const profile = validateProfile(profileInput);
  const expectedEventName = options.expectedEventName ?? 'pull_request_target';
  if (event?.eventName !== expectedEventName) reject('unexpected event');
  const pullRequest = event.pullRequest;
  if (!pullRequest || !Number.isInteger(pullRequest.number)) reject('missing pull request identity');
  if (profile.legacyPullRequestNumbers.includes(pullRequest.number)) reject('legacy PR rejected');
  const product = profile.product;
  exact(pullRequest.number, product.pullRequestNumber, 'pull request number');
  sha(pullRequest.head?.sha, 'product head SHA');
  exact(pullRequest.head.sha, product.headSha, 'product head SHA');
  exact(pullRequest.head?.ref, product.sourceBranch, 'source branch');
  exact(pullRequest.head?.repoFullName, product.sourceRepository, 'source repository');
  exact(pullRequest.base?.ref, product.targetBranch, 'target branch');
  exact(pullRequest.base?.repoFullName, product.sourceRepository, 'target repository');
  sha(pullRequest.base?.sha, 'target base SHA');
  exact(pullRequest.base.sha, product.currentBaseSha, 'target current base SHA');
  exact(evidence?.protectedBaseCheckoutSha, pullRequest.base.sha, 'protected base checkout SHA');
  exact(evidence?.candidateResolvedSha, pullRequest.head.sha, 'candidate resolved SHA');
  if (!evidence?.authorityFloorIncluded) reject('authority floor not integrated into target base');
  if (!evidence?.productOriginalBaseIncludedInTargetBase) reject('fixed product original base not integrated into target base');
  if (!Array.isArray(evidence.candidateParentShas) || evidence.candidateParentShas.length !== 1) {
    reject('candidate must have exactly one parent');
  }
  exact(evidence.candidateParentShas[0], product.parentSha, 'candidate parent SHA');
  if (!Array.isArray(evidence.candidateAncestryShas)
    || evidence.candidateAncestryShas.length !== product.ancestryShas.length
    || evidence.candidateAncestryShas.some((entry, index) => entry !== product.ancestryShas[index])) {
    reject('candidate ancestry chain mismatch');
  }
  exact(evidence.candidateMergeBaseSha, product.originalBaseSha, 'candidate merge-base SHA');
  exact(evidence.candidatePatchId, product.patchId, 'candidate patch ID');
  if (!Array.isArray(evidence.changedPaths)) reject('missing changed paths');
  if (!Array.isArray(evidence.candidateControlPlanePaths) || evidence.candidateControlPlanePaths.length !== 0) {
    reject('candidate self-authorization or control-plane change');
  }
  const observedDigest = canonicalPathDigest(evidence.changedPaths);
  if (evidence.changedPaths.length !== product.pathCount
    || observedDigest !== product.pathDigest
    || evidence.changedPaths.some((entry, index) => entry !== product.paths[index])) {
    reject('changed path set or digest mismatch');
  }
  if (!Array.isArray(evidence.targetBaseAdvancePaths)) reject('missing target base advance paths');
  const targetBaseAdvanceDigest = canonicalPathDigest(evidence.targetBaseAdvancePaths);
  if (evidence.targetBaseAdvancePaths.some(entry => product.paths.includes(entry))) {
    reject('target base overlaps fixed product paths');
  }
  if (evidence.targetBaseAdvancePaths.length !== product.allowedTargetBaseAdvancePaths.length
    || targetBaseAdvanceDigest !== canonicalPathDigest(product.allowedTargetBaseAdvancePaths)
    || evidence.targetBaseAdvancePaths.some((entry, index) => entry !== product.allowedTargetBaseAdvancePaths[index])) {
    reject('target base does not match exact EF194 governance path set');
  }
  if (!evidence.profilePresentAtBase) reject('authority profile absent from target base');
  if (!evidence.profileMatchesBase) reject('authority profile differs from target base');
  return { accepted: true, profile };
}

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSucceeded(args, cwd = process.cwd()) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitPatchId(baseSha, headSha, cwd = process.cwd()) {
  const patch = execFileSync('git', ['diff', '--no-ext-diff', '--binary', `${baseSha}..${headSha}`], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = execFileSync('git', ['patch-id', '--stable'], {
    cwd,
    encoding: 'utf8',
    input: patch,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const [patchId, resolvedHead, ...extra] = result.split(/\s+/);
  if (!SHA.test(patchId ?? '') || resolvedHead !== '0000000000000000000000000000000000000000' || extra.length !== 0) {
    reject('candidate patch ID unavailable');
  }
  return patchId;
}

function firstParentChain(headSha, expectedLength, cwd = process.cwd()) {
  const reverseChain = [headSha];
  let cursor = headSha;
  for (let index = 1; index < expectedLength; index += 1) {
    const revision = git(['rev-list', '--parents', '-n', '1', cursor], cwd).split(/\s+/);
    if (revision.length !== 2 || revision[0] !== cursor) return [];
    cursor = revision[1];
    reverseChain.push(cursor);
  }
  return reverseChain.reverse();
}

function eventFromPayload(githubEvent) {
  const baseSha = githubEvent.pull_request?.base?.sha;
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
        sha: baseSha,
        ref: githubEvent.pull_request?.base?.ref,
        repoFullName: githubEvent.pull_request?.base?.repo?.full_name,
      },
    },
  };
}

function evidenceFromRepositories({ profile, event, rawProfile, candidateRoot }) {
  const baseSha = event.pullRequest?.base?.sha;
  const headSha = event.pullRequest?.head?.sha;
  const profileAtBase = typeof baseSha === 'string'
    ? (() => {
      try { return git(['show', `${baseSha}:${PROFILE_REPOSITORY_PATH}`]); } catch { return null; }
    })()
    : null;
  const revision = typeof headSha === 'string'
    ? git(['rev-list', '--parents', '-n', '1', headSha], candidateRoot).split(/\s+/)
    : [];
  const candidateResolvedSha = revision.shift();
  const changedPaths = typeof headSha === 'string'
    ? git(['diff', '--name-only', profile.product.originalBaseSha, headSha], candidateRoot).split('\n').filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];
  const targetBaseAdvancePaths = typeof baseSha === 'string'
    ? git(['diff', '--name-only', profile.product.originalBaseSha, baseSha]).split('\n').filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];
  return {
    protectedBaseCheckoutSha: git(['rev-parse', 'HEAD']),
    authorityFloorIncluded: typeof baseSha === 'string' && gitSucceeded(['merge-base', '--is-ancestor', profile.authorityFloorSha, baseSha]),
    productOriginalBaseIncludedInTargetBase: typeof baseSha === 'string' && gitSucceeded(['merge-base', '--is-ancestor', profile.product.originalBaseSha, baseSha]),
    candidateResolvedSha,
    candidateParentShas: revision,
    candidateAncestryShas: typeof headSha === 'string'
      ? firstParentChain(headSha, profile.product.ancestryShas.length, candidateRoot)
      : [],
    candidateMergeBaseSha: git(['merge-base', baseSha, headSha], candidateRoot),
    candidatePatchId: gitPatchId(profile.product.parentSha, headSha, candidateRoot),
    changedPaths,
    targetBaseAdvancePaths,
    candidateControlPlanePaths: changedPaths.filter(entry => CANDIDATE_CONTROL_PLANE_PATHS.includes(entry)),
    profilePresentAtBase: profileAtBase !== null,
    profileMatchesBase: profileAtBase !== null && sameValue(profileAtBase, rawProfile.trim()),
  };
}

function releaseGateArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--release-gate-output' || argv[2] !== '--candidate-root' || !argv[1] || !argv[3]) {
    reject('invalid release gate arguments');
  }
  return { output: path.resolve(argv[1]), candidateRoot: path.resolve(argv[3]) };
}

async function main() {
  const rawEvent = process.env.GITHUB_EVENT_PATH
    ? await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')
    : null;
  if (!rawEvent) reject('missing GitHub event payload');
  let githubEvent;
  try {
    githubEvent = JSON.parse(rawEvent);
  } catch {
    reject('malformed GitHub event payload');
  }
  const rawProfile = await readFile(PROFILE_URL, 'utf8');
  let profile;
  try {
    profile = JSON.parse(rawProfile);
  } catch {
    reject('malformed profile');
  }
  const validatedProfile = validateProfile(profile);
  const event = eventFromPayload(githubEvent);
  if (process.argv.length > 2) {
    const { output, candidateRoot } = releaseGateArguments(process.argv.slice(2));
    if (!isFixedSuccessorAttempt(validatedProfile, event)) {
      process.stdout.write('fixed successor admission not applicable\n');
      process.exitCode = 2;
      return;
    }
    const evidence = evidenceFromRepositories({ profile: validatedProfile, event, rawProfile, candidateRoot });
    validateAdmission(validatedProfile, event, evidence, { expectedEventName: 'pull_request' });
    await writeFile(output, `${JSON.stringify(fixedSuccessorRegressionManifest(validatedProfile), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write('fixed successor release gate admission accepted\n');
    return;
  }
  const evidence = evidenceFromRepositories({ profile: validatedProfile, event, rawProfile, candidateRoot: process.cwd() });
  validateAdmission(validatedProfile, event, evidence);
  process.stdout.write('fixed successor admission accepted\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'fixed successor admission rejected'}\n`);
    process.exitCode = 1;
  });
}
