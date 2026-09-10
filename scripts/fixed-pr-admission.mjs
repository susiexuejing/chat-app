import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PROFILE_URL = new URL('./fixed-pr-admission.profile.json', import.meta.url);
const PROFILE_REPOSITORY_PATH = 'scripts/fixed-pr-admission.profile.json';
const SHA = /^[0-9a-f]{40}$/;
const FIXED = Object.freeze({
  authorityFloorSha: '5468fefbf9400726e1c7c3a9daa146be608fb916',
  headSha: '12048a16386edf34e6527341ffda64181d98e4ce',
  originalSha: '2284f0479316e3eb5a29b86854c82792aaa5a1c5',
  sourceRepository: 'susiexuejing/chat-app',
  sourceBranch: 'cell3/ef-161-web-same-origin-backend',
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
  if (!profile || profile.schemaVersion !== 1 || profile.kind !== 'fixed-successor-pr-admission' || profile.ticket !== 'EF-161') {
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
  for (const [name, value] of Object.entries({
    productHeadSha: product.headSha,
    productDirectParentSha: product.directParentSha,
    productOriginalMergeBaseSha: product.originalMergeBaseSha,
  })) sha(value, name);
  if (product.headSha !== FIXED.headSha
    || product.directParentSha !== FIXED.originalSha
    || product.originalMergeBaseSha !== FIXED.originalSha
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

export function validateAdmission(profileInput, event, evidence) {
  const profile = validateProfile(profileInput);
  if (event?.eventName !== 'pull_request_target') reject('unexpected event');
  const pullRequest = event.pullRequest;
  if (!pullRequest || !Number.isInteger(pullRequest.number)) reject('missing pull request identity');
  if (profile.legacyPullRequestNumbers.includes(pullRequest.number)) reject('legacy PR rejected');
  const product = profile.product;
  exact(pullRequest.head?.sha, product.headSha, 'product head SHA');
  exact(pullRequest.head?.ref, product.sourceBranch, 'source branch');
  exact(pullRequest.head?.repoFullName, product.sourceRepository, 'source repository');
  exact(pullRequest.base?.ref, product.targetBranch, 'target branch');
  exact(pullRequest.base?.repoFullName, product.sourceRepository, 'target repository');
  sha(pullRequest.base?.sha, 'target base SHA');
  exact(evidence?.protectedBaseCheckoutSha, pullRequest.base.sha, 'protected base checkout SHA');
  if (!evidence?.authorityFloorIncluded) reject('authority floor not integrated into target base');
  exact(evidence.productDirectParentSha, product.directParentSha, 'product parent SHA');
  exact(evidence.productMergeBaseSha, product.originalMergeBaseSha, 'product merge-base SHA');
  if (!Array.isArray(evidence.changedPaths)) reject('missing changed paths');
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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSucceeded(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  const product = validateProfile(profile).product;
  const baseSha = githubEvent.pull_request?.base?.sha;
  const event = {
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
  const profileAtBase = typeof baseSha === 'string'
    ? (() => {
      try { return git(['show', `${baseSha}:${PROFILE_REPOSITORY_PATH}`]); } catch { return null; }
    })()
    : null;
  const evidence = {
    protectedBaseCheckoutSha: git(['rev-parse', 'HEAD']),
    authorityFloorIncluded: typeof baseSha === 'string' && gitSucceeded(['merge-base', '--is-ancestor', profile.authorityFloorSha, baseSha]),
    productDirectParentSha: git(['rev-parse', `${product.headSha}^`]),
    productMergeBaseSha: git(['merge-base', product.originalMergeBaseSha, product.headSha]),
    changedPaths: git(['diff', '--name-only', product.originalMergeBaseSha, product.headSha]).split('\n').filter(Boolean).sort((left, right) => left.localeCompare(right)),
    targetedRegression: product.targetedRegression,
    profilePresentAtBase: profileAtBase !== null,
    profileMatchesBase: profileAtBase !== null && sameValue(profileAtBase, rawProfile.trim()),
  };
  validateAdmission(profile, event, evidence);
  process.stdout.write('fixed successor admission accepted\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'fixed successor admission rejected'}\n`);
    process.exitCode = 1;
  });
}
