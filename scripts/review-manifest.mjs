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
const LOW_RISK_PROFILE_ID = 'r0-chat-ui-visual-v1';
const DEFAULT_TARGETED_REGRESSION_IDS = ['review-manifest-contract', 'release-gate-contract'];
const LOW_RISK_TARGET_IDS = ['chat-ui-jest-path'];
const LOW_RISK_UI_ENTRY_PATHS = ['client/screens/chat/index.tsx'];
const LOW_RISK_UI_COMPONENT_ROOT = 'client/screens/chat/components';
const LOW_RISK_TEST_ROOT = 'client/screens/chat/__tests__';
const R1_FRONTEND_PROFILE_ID = 'r1-chat-ui-affected-v1';
const R1_FRONTEND_TARGET_IDS = ['chat-ui-jest-path'];
const R1_FRONTEND_UI_ENTRY_PATHS = [
  'client/screens/chat/index.tsx',
  'client/screens/chat/SelectCounselorScreen.tsx',
];
const R1_FRONTEND_UI_COMPONENT_ROOT = 'client/screens/chat/components';
const R1_FRONTEND_TEST_ROOT = 'client/screens/chat/__tests__';
const R1_FRONTEND_MAX_UI_PATHS = 2;
const R1_FRONTEND_MAX_TEST_PATHS = 3;
const EXACT_LEGACY_PATHS = [
  '.github/workflows/release-gate.yml', 'scripts/ef111-scope.manifest.json',
  'scripts/review-manifest.mjs', 'scripts/release-suite.manifest.json',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/ef111-review-manifest.test.mjs',
  'scripts/__tests__/run-approved-targeted-regressions.test.mjs',
  'scripts/run-approved-targeted-regressions.mjs', 'docs/EF-94-ci-release-gate.md',
];
const EXACT_APPROVED_PROFILES = [{
  id: 'ef-118-pr-43-f35b3ca-clean-merge',
  kind: 'exact-clean-merge',
  pullRequestNumber: 43,
  baseRef: 'dev',
  approvedFirstParentSha: 'f35b3ca99fd498b13b530c6c2eed305c5f7688c3',
  allowedPaths: [
    '.github/workflows/deploy-dev.yml',
    'server/src/__tests__/ef118-runtime-audit.test.ts',
    'server/src/index.ts',
    'server/src/observability/ef118RuntimeAudit.ts',
    'server/src/routes/conversations.ts',
  ],
}, {
  id: 'ef-110-pr-48-b0a5c6f-clean-merge',
  kind: 'exact-clean-merge',
  pullRequestNumber: 48,
  baseRef: 'dev',
  approvedFirstParentSha: 'b0a5c6f377e9a45b6c5a5b6cf8811ff6487f0874',
  allowedPaths: [
    'server/src/index.ts',
    'server/src/routes/conversations.ts',
    'server/src/__tests__/ef110-index-runtime-sanitization.test.ts',
    'server/src/__tests__/ef110-security-sanitization.test.ts',
  ],
}, {
  id: 'ef-75-pr-52-b651b05-clean-merge',
  kind: 'exact-clean-merge',
  pullRequestNumber: 52,
  baseRef: 'dev',
  approvedFirstParentSha: 'b651b0505b236c20e2c32f8d7dadc444865b66a7',
  allowedPaths: [
    'client/app.config.ts',
    'client/package.json',
    'client/screens/chat/__tests__/chatStart.test.ts',
    'client/screens/chat/__tests__/ef102-rn-terminal-close.test.ts',
    'client/screens/chat/__tests__/ef103-streaming-compatibility.test.ts',
    'client/screens/chat/__tests__/ef105-api-identity.test.ts',
    'client/screens/chat/__tests__/ef38-retry-transport-diagnostics.test.ts',
    'client/screens/chat/__tests__/ef75-native-secure-session.test.ts',
    'client/screens/chat/__tests__/ef75-ownership-production-path.test.tsx',
    'client/screens/chat/__tests__/ef75-web-cookie-session.test.ts',
    'client/screens/chat/api/cozeApi.ts',
    'client/screens/chat/contexts/ChatContext.tsx',
    'client/screens/chat/stores/anonymousSession.ts',
    'client/screens/chat/stores/sessionStore.ts',
    'pnpm-lock.yaml',
    'server/src/__tests__/ef110-index-runtime-sanitization.test.ts',
    'server/src/__tests__/ef110-security-sanitization.test.ts',
    'server/src/__tests__/ef75-anonymous-session.test.ts',
    'server/src/__tests__/ef75-chat-ownership.test.ts',
    'server/src/__tests__/ef75-conversation-ownership.test.ts',
    'server/src/__tests__/ef75-web-session-security.test.ts',
    'server/src/index.ts',
    'server/src/routes/anonymousSessions.ts',
    'server/src/routes/conversations.ts',
    'server/src/security/anonymousSession.ts',
    'server/src/storage/database/migrations/003_create_anonymous_sessions.sql',
    'server/src/storage/database/shared/schema.ts',
  ],
}, {
  id: 'ef-146-pr-54-docs-only',
  kind: 'exact-docs-paths',
  pullRequestNumber: 54,
  baseRef: 'dev',
  approvedHeadSha: '5130611c32d51017ab2d8ec4b5f5447452bd9b4f',
  allowedPaths: ['docs/EF-146-ownership-boundary-contract.md'],
}];

function fail(message) { throw new Error(`EF-111 review manifest rejected: ${message}`); }
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a 40-character lowercase SHA`);
  return value;
}
function commandAt(root, args, execFile = execFileSync) {
  try {
    return String(execFile('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    })).trim();
  }
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
function lowRiskProfile(value) {
  exactKeys(value, ['id', 'kind', 'baseRef', 'uiEntryPaths', 'uiComponentRoot', 'testRoot', 'targetIds'], 'low-risk frontend profile');
  if (value.id !== LOW_RISK_PROFILE_ID || value.kind !== 'r0-ui-category' || value.baseRef !== 'dev') {
    fail('low-risk frontend profile identity is malformed');
  }
  exactPathList(value.uiEntryPaths, LOW_RISK_UI_ENTRY_PATHS, 'low-risk frontend entry paths');
  if (value.uiComponentRoot !== LOW_RISK_UI_COMPONENT_ROOT || value.testRoot !== LOW_RISK_TEST_ROOT
    || /[*?\[\]{}]/.test(value.uiComponentRoot) || /[*?\[\]{}]/.test(value.testRoot)) {
    fail('low-risk frontend profile path class is malformed');
  }
  if (!Array.isArray(value.targetIds) || value.targetIds.length !== 1 || value.targetIds[0] !== LOW_RISK_TARGET_IDS[0]) fail('low-risk frontend profile targets are malformed');
  return { ...value, uiEntryPaths: new Set(value.uiEntryPaths), targetIds: [...value.targetIds] };
}

function r1FrontendProfile(value) {
  exactKeys(value, ['id', 'kind', 'baseRef', 'uiEntryPaths', 'uiComponentRoot', 'testRoot', 'targetIds', 'maxUiPaths', 'maxTestPaths'], 'R1 frontend profile');
  if (value.id !== R1_FRONTEND_PROFILE_ID || value.kind !== 'r1-frontend-category' || value.baseRef !== 'dev') {
    fail('R1 frontend profile identity is malformed');
  }
  exactPathList(value.uiEntryPaths, R1_FRONTEND_UI_ENTRY_PATHS, 'R1 frontend entry paths');
  if (value.uiComponentRoot !== R1_FRONTEND_UI_COMPONENT_ROOT || value.testRoot !== R1_FRONTEND_TEST_ROOT
    || value.maxUiPaths !== R1_FRONTEND_MAX_UI_PATHS || value.maxTestPaths !== R1_FRONTEND_MAX_TEST_PATHS
    || /[*?\[\]{}]/.test(value.uiComponentRoot) || /[*?\[\]{}]/.test(value.testRoot)) {
    fail('R1 frontend profile path class is malformed');
  }
  if (!Array.isArray(value.targetIds) || value.targetIds.length !== 1 || value.targetIds[0] !== R1_FRONTEND_TARGET_IDS[0]) fail('R1 frontend profile targets are malformed');
  return { ...value, uiEntryPaths: new Set(value.uiEntryPaths), targetIds: [...value.targetIds] };
}

function directChildOf(value, root, suffix) {
  if (typeof value !== 'string' || !value.startsWith(`${root}/`) || !value.endsWith(suffix)
    || /[*?\[\]{}]/.test(value) || value.split('/').some(part => part === '.' || part === '..')) return false;
  const child = value.slice(root.length + 1);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(child) && !child.includes('/');
}

function verifyLowRiskCategoryPaths(changed, profile) {
  const ui = changed.filter(entry => profile.uiEntryPaths.has(entry)
    || directChildOf(entry, profile.uiComponentRoot, '.tsx'));
  const tests = changed.filter(entry => directChildOf(entry, profile.testRoot, '.test.tsx'));
  if (changed.length !== 2 || ui.length !== 1 || tests.length !== 1
    || new Set(changed).size !== changed.length) {
    fail('low-risk UI category requires exactly one closed UI path and one closed test path');
  }
  return { uiPath: ui[0], targetedTestPath: tests[0] };
}

function verifyR1FrontendCategoryPaths(changed, profile) {
  const ui = changed.filter(entry => profile.uiEntryPaths.has(entry)
    || directChildOf(entry, profile.uiComponentRoot, '.tsx'));
  const tests = changed.filter(entry => directChildOf(entry, profile.testRoot, '.test.tsx'));
  if (changed.length !== ui.length + tests.length || ui.length === 0 || ui.length > profile.maxUiPaths
    || tests.length === 0 || tests.length > profile.maxTestPaths || new Set(changed).size !== changed.length) {
    fail('R1 frontend category requires only closed UI paths and one to three direct test paths');
  }
  return { uiPaths: ui, affectedTestPaths: tests };
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
  exactKeys(parsed, ['schemaVersion', 'legacyAllowedPaths', 'approvedProfiles', 'lowRiskFrontendProfiles', 'r1FrontendProfiles'], 'scope manifest');
  if (parsed.schemaVersion !== 5) fail('scope manifest is malformed');
  exactPathList(parsed.legacyAllowedPaths, EXACT_LEGACY_PATHS, 'legacy scope');
  if (!Array.isArray(parsed.lowRiskFrontendProfiles) || parsed.lowRiskFrontendProfiles.length > 1) fail('low-risk frontend profiles are malformed');
  const lowRiskProfiles = new Map();
  for (const entry of parsed.lowRiskFrontendProfiles) {
    const profile = lowRiskProfile(entry);
    if (lowRiskProfiles.has(profile.id)) fail('low-risk frontend profile is duplicated');
    lowRiskProfiles.set(profile.id, profile);
  }
  if (!Array.isArray(parsed.r1FrontendProfiles) || parsed.r1FrontendProfiles.length !== 1) fail('R1 frontend profiles are malformed');
  const r1FrontendProfiles = new Map();
  for (const entry of parsed.r1FrontendProfiles) {
    const profile = r1FrontendProfile(entry);
    if (r1FrontendProfiles.has(profile.id)) fail('R1 frontend profile is duplicated');
    r1FrontendProfiles.set(profile.id, profile);
  }
  if (!Array.isArray(parsed.approvedProfiles)
    || parsed.approvedProfiles.length !== EXACT_APPROVED_PROFILES.length) fail('approved profiles are malformed');
  const profiles = new Map();
  for (let index = 0; index < EXACT_APPROVED_PROFILES.length; index += 1) {
    const actual = parsed.approvedProfiles[index];
    const expected = EXACT_APPROVED_PROFILES[index];
    const profileKeys = expected.kind === 'exact-clean-merge'
      ? ['id', 'kind', 'pullRequestNumber', 'baseRef', 'approvedFirstParentSha', 'allowedPaths']
      : ['id', 'kind', 'pullRequestNumber', 'baseRef', 'approvedHeadSha', 'allowedPaths'];
    exactKeys(actual, profileKeys, 'approved profile');
    if (actual.id !== expected.id || actual.pullRequestNumber !== expected.pullRequestNumber
      || actual.kind !== expected.kind || actual.baseRef !== expected.baseRef
      || (expected.kind === 'exact-clean-merge'
        && actual.approvedFirstParentSha !== expected.approvedFirstParentSha)
      || (expected.kind === 'exact-docs-paths' && actual.approvedHeadSha !== expected.approvedHeadSha)
      || profiles.has(actual.id)) {
      fail('approved profile identity is malformed');
    }
    if (expected.kind === 'exact-clean-merge') sha(actual.approvedFirstParentSha, 'approved profile first parent SHA');
    if (expected.kind === 'exact-docs-paths') sha(actual.approvedHeadSha, 'approved profile head SHA');
    exactPathList(actual.allowedPaths, expected.allowedPaths, 'approved profile paths');
    profiles.set(actual.id, { ...actual, allowedPaths: new Set(actual.allowedPaths) });
  }
  return { legacyAllowedPaths: new Set(parsed.legacyAllowedPaths), profiles, lowRiskProfiles, r1FrontendProfiles };
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
function verifyExactPaths(changed, allowedPaths) {
  if (changed.length !== allowedPaths.size || new Set(changed).size !== changed.length
    || changed.some(entry => !allowedPaths.has(entry))) {
    fail('structural profile requires the exact approved path set');
  }
}
function rawCommitIdentity(raw, headSha) {
  const lines = raw.split('\n');
  const treeLines = lines.filter(line => line.startsWith('tree '));
  const parentLines = lines.filter(line => line.startsWith('parent '));
  if (treeLines.length !== 1 || parentLines.length !== 2) {
    fail('structural candidate must contain exactly one tree and two parents');
  }
  return {
    treeSha: sha(treeLines[0].slice(5), `${headSha} tree SHA`),
    parents: parentLines.map((line, index) => sha(line.slice(7), `${headSha} parent ${index + 1}`)),
  };
}
function verifyStructuralProfile({ profile, baseSha, headSha, mergeBaseSha, changed, candidateRoot, git }) {
  if (profile.kind !== 'exact-clean-merge') fail('approved profile kind is unsupported');
  if (git(candidateRoot, ['rev-parse', '--show-object-format']) !== 'sha1') {
    fail('structural profile requires the repository sha1 object format');
  }
  if (git(candidateRoot, ['replace', '-l']) !== '') fail('replacement refs are forbidden');
  git(candidateRoot, ['cat-file', '-e', `${profile.approvedFirstParentSha}^{commit}`]);

  const graph = git(candidateRoot, ['rev-list', '--parents', '-n', '1', headSha]).split(/\s+/);
  if (graph.length !== 3 || graph[0] !== headSha
    || graph[1] !== profile.approvedFirstParentSha || graph[2] !== baseSha) {
    fail('structural candidate must have the exact ordered first parent and event-base second parent');
  }
  const raw = rawCommitIdentity(git(candidateRoot, ['cat-file', '-p', headSha]), headSha);
  if (raw.parents[0] !== profile.approvedFirstParentSha || raw.parents[1] !== baseSha) {
    fail('raw candidate parents do not match the approved structural graph');
  }
  if (mergeBaseSha !== baseSha) fail('structural candidate merge-base must equal the event base');

  const candidateTreeSha = sha(git(candidateRoot, ['rev-parse', `${headSha}^{tree}`]), 'candidate tree SHA');
  if (candidateTreeSha !== raw.treeSha) fail('raw candidate tree does not match the candidate commit');
  const recomputedTreeSha = sha(
    git(candidateRoot, ['merge-tree', '--write-tree', profile.approvedFirstParentSha, baseSha]),
    'recomputed merge tree SHA',
  );
  if (git(candidateRoot, ['cat-file', '-t', recomputedTreeSha]) !== 'tree') {
    fail('recomputed merge object is not a tree');
  }
  if (candidateTreeSha !== recomputedTreeSha) fail('candidate tree does not equal the clean recomputed merge tree');
  verifyExactPaths(changed, profile.allowedPaths);
  return {
    kind: profile.kind,
    approvedFirstParentSha: profile.approvedFirstParentSha,
    eventBaseSecondParentSha: baseSha,
    candidateTreeSha,
    recomputedTreeSha,
  };
}
function verifyProfile({ profile, baseSha, headSha, mergeBaseSha, changed, candidateRoot, git }) {
  if (profile.kind === 'exact-clean-merge') {
    return verifyStructuralProfile({ profile, baseSha, headSha, mergeBaseSha, changed, candidateRoot, git });
  }
  if (profile.kind === 'exact-docs-paths') {
    if (headSha !== profile.approvedHeadSha) fail('documentation profile head SHA is not approved');
    verifyExactPaths(changed, profile.allowedPaths);
    return {
      kind: profile.kind,
      approvedPaths: [...profile.allowedPaths],
      baseSha, approvedHeadSha: profile.approvedHeadSha,
    };
  }
  fail('approved profile kind is unsupported');
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
    let structuralProof = null;
    let targetedRegressionIds = scopeId === LEGACY_SCOPE_ID ? [...DEFAULT_TARGETED_REGRESSION_IDS] : null;
    let targetedTestPath = null;
    let affectedTestPaths = null;
    if (requestedScopeId !== null) {
      const profile = scope.profiles.get(requestedScopeId)
        ?? scope.lowRiskProfiles.get(requestedScopeId)
        ?? scope.r1FrontendProfiles.get(requestedScopeId);
      if (!profile) fail(`unknown scope declaration: ${requestedScopeId}`);
      if (profile.baseRef !== baseRef || (!scope.lowRiskProfiles.has(requestedScopeId)
        && !scope.r1FrontendProfiles.has(requestedScopeId) && profile.pullRequestNumber !== prNumber)) {
        fail('approved profile does not match PR identity');
      }
      scopeId = profile.id;
      if (scope.lowRiskProfiles.has(requestedScopeId)) {
        const categoryPaths = verifyLowRiskCategoryPaths(changed, profile);
        structuralProof = {
          kind: 'trusted-r0-ui-category',
          authoritySha,
          uiPath: categoryPaths.uiPath,
          targetedTestPath: categoryPaths.targetedTestPath,
        };
        targetedRegressionIds = profile.targetIds;
        targetedTestPath = categoryPaths.targetedTestPath;
      } else if (scope.r1FrontendProfiles.has(requestedScopeId)) {
        const categoryPaths = verifyR1FrontendCategoryPaths(changed, profile);
        structuralProof = {
          kind: 'trusted-r1-frontend-category',
          authoritySha,
          uiPaths: categoryPaths.uiPaths,
          affectedTestPaths: categoryPaths.affectedTestPaths,
        };
        targetedRegressionIds = profile.targetIds;
        affectedTestPaths = categoryPaths.affectedTestPaths;
      } else {
        allowedPaths = profile.allowedPaths;
        structuralProof = verifyProfile({
          profile, baseSha, headSha, mergeBaseSha, changed, candidateRoot: layout.candidateRoot, git,
        });
      }
    }
    if (structuralProof === null) verifyAllowedPaths(changed, allowedPaths);
    return {
      schemaVersion: 5, eventName, mode: 'authority-candidate', authoritySha,
      checkedOutSha, baseSha, headSha, mergeBaseSha,
      prNumber, scopeId, changedPaths: changed, structuralProof, targetedRegressionIds,
      targetedTestPath, affectedTestPaths,
    };
  }

  if (eventName === 'push' || eventName === 'workflow_dispatch') {
    if (layout.mode !== 'single' || layout.authorityRoot !== layout.candidateRoot) {
      fail('non-PR event requires one checkout');
    }
    const githubSha = sha(env.GITHUB_SHA, 'GITHUB_SHA');
    if (checkedOutSha !== githubSha) fail('checked-out SHA does not match GITHUB_SHA');
    return {
      schemaVersion: 5, eventName, mode: 'single', authoritySha: checkedOutSha,
      checkedOutSha, baseSha: null, headSha: githubSha,
      mergeBaseSha: null, prNumber: null, scopeId: null, changedPaths: null,
      targetedRegressionIds: [...DEFAULT_TARGETED_REGRESSION_IDS], targetedTestPath: null, affectedTestPaths: null,
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
