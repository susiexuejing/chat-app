import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILE_URL = new URL('./fixed-pr-admission.profile.json', import.meta.url);
const PROFILE_REPOSITORY_PATH = 'scripts/fixed-pr-admission.profile.json';
const RELEASE_GATE_SCOPE_ID = 'ef-194-ef161-fixed-successor-release-gate-v1';
const SHA = /^[0-9a-f]{40}$/;
const CANDIDATE_CONTROL_PLANE_PATHS = Object.freeze([
  '.github/workflows/protected-fixed-pr-admission.yml',
  '.github/workflows/release-gate.yml',
  'scripts/fixed-pr-admission.mjs',
  'scripts/fixed-pr-admission.profile.json',
]);
const FIXED = Object.freeze({
  authorityFloorSha: '63761f81e7a8e05472812e7a95674bb34d6c3d57',
  headPolicy: 'event-head-single-parent-of-protected-base',
  patchId: '24321ba636082a1963c8be5ddc9add2915eb4e59',
  sourceRepository: 'susiexuejing/chat-app',
  sourceBranch: 'cell3/ef-161-current-dev-integration',
  targetBranch: 'dev',
  paths: [
    'client/screens/chat/__tests__/ef75-ownership-production-path.test.tsx',
    'client/screens/chat/stores/sessionStore.ts',
  ],
  pathDigest: 'a3fb653a81b68dd607f6cba114c6743c7453d973754783e76ea4177bb2c6bc29',
  targetedRegression: 'client/screens/chat/__tests__/ef75-ownership-production-path.test.tsx',
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
  if (!profile || profile.schemaVersion !== 1 || profile.kind !== 'integrated-successor-pr-admission' || profile.ticket !== 'EF-161') {
    reject('malformed profile');
  }
  if (profile.governanceSelfAdmission !== 'forbidden') reject('self-admission is not forbidden');
  if (!Array.isArray(profile.legacyPullRequestNumbers) || profile.legacyPullRequestNumbers.length !== 1 || profile.legacyPullRequestNumbers[0] !== 93) {
    reject('legacy PR #93 is not explicitly rejected');
  }
  sha(profile.authorityFloorSha, 'authority floor SHA');
  exact(profile.authorityFloorSha, FIXED.authorityFloorSha, 'authority floor SHA');
  const product = profile.product;
  if (!product) reject('missing product profile');
  sha(product.patchId, 'product patch ID');
  if (product.headPolicy !== FIXED.headPolicy
    || product.patchId !== FIXED.patchId
    || product.sourceRepository !== FIXED.sourceRepository
    || product.sourceBranch !== FIXED.sourceBranch
    || product.targetBranch !== FIXED.targetBranch
    || product.targetedRegression !== FIXED.targetedRegression) {
    reject('malformed fixed product identity');
  }
  if (!Array.isArray(product.paths) || product.pathCount !== product.paths.length
    || !product.paths.includes(product.targetedRegression)
    || product.paths.length !== FIXED.paths.length
    || product.paths.some((entry, index) => entry !== FIXED.paths[index])
    || product.pathDigest !== FIXED.pathDigest
    || canonicalPathDigest(product.paths) !== product.pathDigest) {
    reject('malformed fixed path contract');
  }
  return profile;
}

export function isFixedSuccessorAttempt(profileInput, event) {
  const profile = validateProfile(profileInput);
  const head = event?.pullRequest?.head;
  return head?.ref === profile.product.sourceBranch;
}

export function fixedSuccessorRegressionManifest(profileInput) {
  const profile = validateProfile(profileInput);
  return {
    schemaVersion: 1,
    kind: 'fixed-successor-release-gate-regression',
    scopeId: RELEASE_GATE_SCOPE_ID,
    targetedRegressionIds: ['chat-ui-jest-path'],
    targetedTestPath: profile.product.targetedRegression,
    affectedTestPaths: null,
  };
}

export function validateAdmission(profileInput, event, evidence, options = {}) {
  const profile = validateProfile(profileInput);
  const expectedEventName = options.expectedEventName ?? 'pull_request_target';
  if (event?.eventName !== expectedEventName) reject('unexpected event');
  const pullRequest = event.pullRequest;
  if (!pullRequest || !Number.isInteger(pullRequest.number)) reject('missing pull request identity');
  if (profile.legacyPullRequestNumbers.includes(pullRequest.number)) reject('legacy PR rejected');
  const product = profile.product;
  sha(pullRequest.head?.sha, 'product head SHA');
  exact(pullRequest.head?.ref, product.sourceBranch, 'source branch');
  exact(pullRequest.head?.repoFullName, product.sourceRepository, 'source repository');
  exact(pullRequest.base?.ref, product.targetBranch, 'target branch');
  exact(pullRequest.base?.repoFullName, product.sourceRepository, 'target repository');
  sha(pullRequest.base?.sha, 'target base SHA');
  exact(evidence?.protectedBaseCheckoutSha, pullRequest.base.sha, 'protected base checkout SHA');
  exact(evidence?.candidateResolvedSha, pullRequest.head.sha, 'candidate resolved SHA');
  if (!evidence?.authorityFloorIncluded) reject('authority floor not integrated into target base');
  if (!Array.isArray(evidence.candidateParentShas) || evidence.candidateParentShas.length !== 1) {
    reject('candidate must have exactly one parent');
  }
  exact(evidence.candidateParentShas[0], pullRequest.base.sha, 'candidate parent SHA');
  exact(evidence.candidateMergeBaseSha, pullRequest.base.sha, 'candidate merge-base SHA');
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
  exact(evidence.targetedRegression, product.targetedRegression, 'targeted regression');
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

function gitPatchId(headSha, cwd = process.cwd()) {
  const patch = execFileSync('git', ['show', '--pretty=email', '--no-ext-diff', '--binary', headSha], {
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
  if (!SHA.test(patchId ?? '') || resolvedHead !== headSha || extra.length !== 0) {
    reject('candidate patch ID unavailable');
  }
  return patchId;
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
  const changedPaths = typeof baseSha === 'string' && typeof headSha === 'string'
    ? git(['diff', '--name-only', baseSha, headSha], candidateRoot).split('\n').filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];
  return {
    protectedBaseCheckoutSha: git(['rev-parse', 'HEAD']),
    authorityFloorIncluded: typeof baseSha === 'string' && gitSucceeded(['merge-base', '--is-ancestor', profile.authorityFloorSha, baseSha]),
    candidateResolvedSha,
    candidateParentShas: revision,
    candidateMergeBaseSha: git(['merge-base', baseSha, headSha], candidateRoot),
    candidatePatchId: gitPatchId(headSha, candidateRoot),
    changedPaths,
    candidateControlPlanePaths: changedPaths.filter(entry => CANDIDATE_CONTROL_PLANE_PATHS.includes(entry)),
    targetedRegression: profile.product.targetedRegression,
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
