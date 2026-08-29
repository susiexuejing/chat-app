import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE_PATH = path.join(REPO_ROOT, 'scripts/ef111-scope.manifest.json');
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
function command(args, execFile = execFileSync) {
  try { return String(execFile('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })).trim(); }
  catch { fail(`git ${args.join(' ')} failed`); }
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

export async function loadScope(read = readFile) {
  let parsed;
  try { parsed = JSON.parse(await read(SCOPE_PATH, 'utf8')); } catch { fail('scope manifest is unreadable'); }
  exactKeys(parsed, ['schemaVersion', 'legacyAllowedPaths', 'approvedProfiles'], 'scope manifest');
  if (parsed.schemaVersion !== 2) fail('scope manifest is malformed');
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

export function verifyPrScope(baseSha, headSha, allowedPaths, execFile = execFileSync) {
  const changed = command(['diff', '--name-only', `${baseSha}...${headSha}`], execFile).split('\n').filter(Boolean);
  if (changed.length === 0) fail('pull request candidate has no changed paths');
  for (const entry of changed) if (!allowedPaths.has(entry)) fail(`out-of-scope path: ${entry}`);
  return changed;
}

export async function createReviewManifest(env = process.env, options = {}) {
  const eventName = env.GITHUB_EVENT_NAME;
  const checkedOutSha = sha(options.git?.(['rev-parse', 'HEAD']) ?? command(['rev-parse', 'HEAD'], options.execFile), 'checked-out SHA');
  if (eventName === 'pull_request') {
    if (!env.GITHUB_EVENT_PATH) fail('GITHUB_EVENT_PATH is required for pull_request');
    let event;
    try { event = JSON.parse(await (options.read ?? readFile)(env.GITHUB_EVENT_PATH, 'utf8')); } catch { fail('pull request event payload is unreadable'); }
    const prNumber = event?.pull_request?.number ?? event?.number;
    const baseRef = event?.pull_request?.base?.ref;
    const baseSha = sha(event?.pull_request?.base?.sha, 'pull_request.base.sha');
    const headSha = sha(event?.pull_request?.head?.sha, 'pull_request.head.sha');
    if (!Number.isInteger(prNumber) || prNumber < 1) fail('pull_request.number must be a positive integer');
    if (baseRef !== 'dev') fail('pull request base ref must be dev');
    if (headSha !== checkedOutSha) fail('pull request head SHA does not match the checked-out candidate');
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
    const changedPaths = verifyPrScope(baseSha, headSha, allowedPaths, options.execFile);
    return { schemaVersion: 2, eventName, checkedOutSha, baseSha, headSha, prNumber, scopeId, changedPaths };
  }
  if (eventName === 'push' || eventName === 'workflow_dispatch') {
    const githubSha = sha(env.GITHUB_SHA, 'GITHUB_SHA');
    if (checkedOutSha !== githubSha) fail('checked-out SHA does not match GITHUB_SHA');
    return { schemaVersion: 2, eventName, checkedOutSha, baseSha: null, headSha: githubSha, prNumber: null, scopeId: null, changedPaths: null };
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
