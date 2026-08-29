import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE_PATH = path.join(SCRIPT_ROOT, 'scripts/ef111-scope.manifest.json');
const SHA = /^[0-9a-f]{40}$/;
const DECLARATION_PREFIX = /^\s*review-scope\s*:/i;
const DECLARATION = /^Review-Scope: ([a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?)$/;
const LEGACY_SCOPE_ID = 'ef-111-legacy-seven-path';
const EXACT_LEGACY_PATHS = [
  '.github/workflows/release-gate.yml', 'scripts/ef111-scope.manifest.json',
  'scripts/review-manifest.mjs', 'scripts/release-suite.manifest.json',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/ef111-review-manifest.test.mjs', 'docs/EF-94-ci-release-gate.md',
];
const EXACT_APPROVED_PROFILES = [{
  id: 'ef-118-pr-43-f35b3ca',
  pullRequestNumber: 43,
  baseRef: 'dev',
  headSha: 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3',
  allowedPaths: [
    '.github/workflows/deploy-dev.yml',
    'server/src/__tests__/ef118-runtime-audit.test.ts',
    'server/src/index.ts',
    'server/src/observability/ef118RuntimeAudit.ts',
    'server/src/routes/conversations.ts',
  ],
}];

function fail(message) { throw new Error(`EF-111 review manifest rejected: ${message}`); }
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a 40-character lowercase SHA`);
  return value;
}
function commandAt(root, args, execFile = execFileSync) {
  try { return String(execFile('git', ['-C', root, ...args], { encoding: 'utf8' })).trim(); }
  catch { fail(`git ${args.join(' ')} failed in ${path.basename(root) || 'workspace'}`); }
}
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed`);
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(`${label} is malformed`);
  }
}
function exactPathList(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length || new Set(value).size !== value.length) {
    fail(`${label} is malformed`);
  }
  const exact = new Set(expected);
  for (const entry of value) {
    if (typeof entry !== 'string' || !exact.has(entry) || entry.startsWith('/') || entry.endsWith('/')
      || entry.split('/').some(part => part === '.' || part === '..') || /[*?\[\]{}]/.test(entry)) {
      fail(`${label} contains an unapproved or non-exact path`);
    }
  }
}
function safeDirectory(target, label) {
  if (!existsSync(target)) fail(`${label} checkout is missing`);
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} checkout is unsafe`);
  const expected = path.resolve(target);
  const actual = realpathSync(target);
  if (actual !== expected) fail(`${label} checkout path is not canonical`);
  return actual;
}

export function resolveLayout(env = process.env, options = {}) {
  if (options.layout) return options.layout;
  const eventName = env.GITHUB_EVENT_NAME;
  const workspaceValue = env.GITHUB_WORKSPACE;
  if (typeof workspaceValue !== 'string' || workspaceValue.length === 0) fail('GITHUB_WORKSPACE is required');
  if (workspaceValue !== path.resolve(workspaceValue)) fail('GITHUB_WORKSPACE path is not canonical');
  const workspace = safeDirectory(workspaceValue, 'workspace');
  const scriptRoot = realpathSync(options.scriptRoot ?? SCRIPT_ROOT);
  if (eventName !== 'pull_request') {
    if (scriptRoot !== workspace) fail('non-PR gate must execute from the single checkout');
    return { mode: 'single', authorityRoot: workspace, candidateRoot: workspace };
  }

  const authorityPath = path.join(workspace, 'authority');
  const candidatePath = path.join(workspace, 'candidate');
  const authorityExists = existsSync(authorityPath);
  const candidateExists = existsSync(candidatePath);
  if (authorityExists !== candidateExists) fail('partial authority/candidate checkout layout');
  if (!authorityExists) fail('pull request requires fixed authority and candidate checkouts');

  const authorityRoot = safeDirectory(authorityPath, 'authority');
  const candidateRoot = safeDirectory(candidatePath, 'candidate');
  if (authorityRoot === candidateRoot) fail('authority and candidate checkouts must be distinct');
  if (scriptRoot !== authorityRoot) fail('PR gate policy must execute from authority checkout');
  return { mode: 'dual', authorityRoot, candidateRoot };
}

export async function loadScope(read = readFile) {
  let parsed;
  try { parsed = JSON.parse(await read(SCOPE_PATH, 'utf8')); } catch { fail('scope manifest is unreadable'); }
  exactKeys(parsed, ['schemaVersion', 'legacyAllowedPaths', 'approvedProfiles'], 'scope manifest');
  if (parsed.schemaVersion !== 3) fail('scope manifest is malformed');
  exactPathList(parsed.legacyAllowedPaths, EXACT_LEGACY_PATHS, 'legacy scope');
  if (!Array.isArray(parsed.approvedProfiles)
    || parsed.approvedProfiles.length !== EXACT_APPROVED_PROFILES.length) fail('approved profiles are malformed');
  const profiles = new Map();
  for (let index = 0; index < EXACT_APPROVED_PROFILES.length; index += 1) {
    const actual = parsed.approvedProfiles[index];
    const expected = EXACT_APPROVED_PROFILES[index];
    exactKeys(actual, ['id', 'pullRequestNumber', 'baseRef', 'headSha', 'allowedPaths'], 'approved profile');
    if (actual.id !== expected.id || actual.pullRequestNumber !== expected.pullRequestNumber
      || actual.baseRef !== expected.baseRef || actual.headSha !== expected.headSha || profiles.has(actual.id)) {
      fail('approved profile identity is malformed');
    }
    sha(actual.headSha, 'approved profile headSha');
    exactPathList(actual.allowedPaths, expected.allowedPaths, 'approved profile paths');
    profiles.set(actual.id, { ...actual, allowedPaths: new Set(actual.allowedPaths) });
  }
  return { legacyAllowedPaths: new Set(parsed.legacyAllowedPaths), profiles };
}

export function declaredScopeId(body) {
  if (body === null || body === undefined || body === '') return null;
  if (typeof body !== 'string') fail('pull request body is malformed');
  const candidates = body.split(/\r?\n/).filter(line => DECLARATION_PREFIX.test(line));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) fail('scope declaration must appear exactly once');
  const match = candidates[0].match(DECLARATION);
  if (!match) fail('scope declaration is malformed');
  return match[1];
}

function changedPaths(baseSha, headSha, candidateRoot, git) {
  git(candidateRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
  const mergeBaseSha = sha(git(candidateRoot, ['merge-base', baseSha, headSha]), 'merge-base SHA');
  const changed = git(candidateRoot, ['diff', '--name-only', `${baseSha}...${headSha}`]).split('\n').filter(Boolean);
  if (changed.length === 0) fail('pull request candidate has no changed paths');
  return { changed, mergeBaseSha };
}
function verifyAllowedPaths(changed, allowedPaths) {
  for (const entry of changed) if (!allowedPaths.has(entry)) fail(`out-of-scope path: ${entry}`);
}
export async function createReviewManifest(env = process.env, options = {}) {
  const eventName = env.GITHUB_EVENT_NAME;
  const layout = resolveLayout(env, options);
  const git = options.git ?? ((root, args) => commandAt(root, args, options.execFile));
  const checkedOutSha = sha(git(layout.candidateRoot, ['rev-parse', 'HEAD']), 'checked-out SHA');

  if (eventName === 'pull_request') {
    if (layout.mode === 'dual' && layout.authorityRoot === layout.candidateRoot) {
      fail('authority and candidate checkouts must be distinct');
    }
    if (!env.GITHUB_EVENT_PATH) fail('GITHUB_EVENT_PATH is required for pull_request');
    let event;
    try { event = JSON.parse(await (options.read ?? readFile)(env.GITHUB_EVENT_PATH, 'utf8')); } catch { fail('pull request event payload is unreadable'); }
    const prNumber = event?.pull_request?.number ?? event?.number;
    const baseRef = event?.pull_request?.base?.ref;
    const baseSha = sha(event?.pull_request?.base?.sha, 'pull_request.base.sha');
    const headSha = sha(event?.pull_request?.head?.sha, 'pull_request.head.sha');
    if (!Number.isInteger(prNumber) || prNumber < 1) fail('pull_request.number must be a positive integer');
    if (baseRef !== 'dev') fail('pull request base ref must be dev');
    if (headSha !== checkedOutSha) fail('pull request head SHA does not match the candidate checkout');
    const { changed, mergeBaseSha } = changedPaths(baseSha, headSha, layout.candidateRoot, git);

    if (layout.mode !== 'dual' || !layout.authorityRoot) fail('pull request requires dual checkout authority');
    const authoritySha = sha(git(layout.authorityRoot, ['rev-parse', 'HEAD']), 'authority SHA');
    if (authoritySha !== baseSha) fail('authority checkout does not match pull_request.base.sha');

    const scope = await loadScope(options.read ?? readFile);
    const requestedScopeId = declaredScopeId(event?.pull_request?.body);
    let scopeId = LEGACY_SCOPE_ID;
    let allowedPaths = scope.legacyAllowedPaths;
    if (requestedScopeId !== null) {
      const profile = scope.profiles.get(requestedScopeId);
      if (!profile) fail(`unknown scope declaration: ${requestedScopeId}`);
      if (profile.pullRequestNumber !== prNumber || profile.baseRef !== baseRef
        || profile.headSha !== headSha || profile.headSha !== checkedOutSha) {
        fail('approved profile does not match PR identity');
      }
      scopeId = profile.id;
      allowedPaths = profile.allowedPaths;
    }
    verifyAllowedPaths(changed, allowedPaths);
    return {
      schemaVersion: 3, eventName, mode: 'authority-candidate', authoritySha,
      checkedOutSha, baseSha, headSha, mergeBaseSha,
      prNumber, scopeId, changedPaths: changed,
    };
  }

  if (eventName === 'push' || eventName === 'workflow_dispatch') {
    if (layout.mode !== 'single' || layout.authorityRoot !== layout.candidateRoot) {
      fail('non-PR event requires one checkout');
    }
    const githubSha = sha(env.GITHUB_SHA, 'GITHUB_SHA');
    if (checkedOutSha !== githubSha) fail('checked-out SHA does not match GITHUB_SHA');
    return {
      schemaVersion: 3, eventName, mode: 'single', authoritySha: checkedOutSha,
      checkedOutSha, baseSha: null, headSha: githubSha,
      mergeBaseSha: null, prNumber: null, scopeId: null, changedPaths: null,
    };
  }
  fail(`unsupported event: ${String(eventName)}`);
}

async function main() {
  const index = process.argv.indexOf('--output');
  if (index === -1 || !process.argv[index + 1] || process.argv.length !== 4) fail('usage: --output <path>');
  const manifest = await createReviewManifest();
  await writeFile(path.resolve(process.argv[index + 1]), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
